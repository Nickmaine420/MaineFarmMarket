/* eslint-disable */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function withStripeEventIdempotency(event, handler) {
  const eventId = event.id;
  const ref = db.collection("stripe_events").doc(eventId);

  const alreadyProcessed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get("status") === "processed") {
      return true;
    }
    tx.set(
      ref,
      {
        id: eventId,
        type: event.type,
        created: event.created,
        livemode: !!event.livemode,
        status: "processing",
        processedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return false;
  });

  if (alreadyProcessed) {
    return true;
  }

  try {
    await handler();
    await ref.set(
      {
        status: "processed",
        processedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return false;
  } catch (e) {
    await ref.set(
      {
        status: "failed",
        error: e && e.message ? e.message : String(e),
        processedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    throw e;
  }
}

// Secrets (set with: firebase functions:secrets:set ...)
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

// LIVE producer subscription price ID:
const PRODUCER_PRICE_ID = "price_1T3Jap1SYqHEo1MCwtv3riOT";
const PRODUCER_TERMS_VERSION = "2026-07-25";

// Safe APP_URL fallback (prevents deploy-time crashes)
function getAppUrl() {
  return process.env.APP_URL || "https://mainefarmmarket.web.app";
}

function getStripe() {
  const stripeKey = STRIPE_SECRET_KEY.value();
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY secret is missing");
  const Stripe = require("stripe");
  return new Stripe(stripeKey, { apiVersion: "2024-06-20" });
}

async function getUserOrThrow(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "User profile missing");
  }
  return snap.data();
}

function assertRole(user, allowedRoles) {
  if (!allowedRoles.includes(user.role)) {
    throw new HttpsError("permission-denied", "Insufficient role");
  }
}

async function resolveProductsAndPricing(itemsInput) {
  if (!Array.isArray(itemsInput) || !itemsInput.length) {
    throw new HttpsError("invalid-argument", "Cart is empty.");
  }

  const productRefs = itemsInput.map((i) => db.collection("products").doc(String(i.productId)));
  const productSnaps = await db.getAll(...productRefs);

  let subtotalCents = 0;
  const resolvedItems = itemsInput.map((item, idx) => {
    const snap = productSnaps[idx];
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", "Product not found");
    }
    const p = snap.data() || {};
    const qty = Math.max(1, Number(item.qty || 1));
    const price = Number(p.price || 0);
    const priceCents = Math.round(price * 100);
    const lineSubtotal = priceCents * qty;
    subtotalCents += lineSubtotal;
    return {
      productId: snap.id,
      name: String(p.name || p.title || "Item"),
      unit: String(p.unit || "each"),
      qty,
      priceCents,
      lineSubtotal,
      producerId: (p.producerId || p.producerUid) ? String(p.producerId || p.producerUid) : "",
      producerName: p.producerName ? String(p.producerName) : "",
      imageUrl: p.photoUrl || p.imageUrl || p.image || "",
    };
  });

  const FEE_RATE = 0.029;
  const FEE_FIXED = 30;
  const processingFeeCents = Math.round(subtotalCents * FEE_RATE) + FEE_FIXED;
  const totalCents = subtotalCents + processingFeeCents;

  const producersMap = {};
  resolvedItems.forEach((it) => {
    const pid = it.producerId || "unknown";
    if (!producersMap[pid]) producersMap[pid] = { subtotalCents: 0 };
    producersMap[pid].subtotalCents += it.lineSubtotal;
  });
  const producers = Object.entries(producersMap).map(([producerId, v]) => ({
    producerId,
    subtotalCents: v.subtotalCents,
  }));

  return { resolvedItems, subtotalCents, processingFeeCents, totalCents, producers };
}

function buildPerProducerSnapshot(producerIds, perProducerInput) {
  const producerIdsFromPayload = new Set(Object.keys(perProducerInput || {}));
  if (
    producerIds.size !== producerIdsFromPayload.size ||
    [...producerIds].some((id) => !producerIdsFromPayload.has(id))
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Fulfillment selections are required for every producer in the cart."
    );
  }

  const perProducer = {};
  producerIds.forEach((producerId) => {
    const selection = perProducerInput[producerId] || {};
    const fulfillmentMethod =
      selection.fulfillmentMethod === "delivery" ? "delivery" : "pickup";
    perProducer[producerId] = {
      fulfillmentMethod,
      window: {
        id: String(selection.selectedWindowId || "default"),
        days: [],
        startTime: "",
        endTime: "",
        timezone: "America/New_York",
        label: "",
      },
    };
  });
  return perProducer;
}

async function getProducerPaymentRouting(stripe, producerIds) {
  const ids = [...producerIds];
  const farmRefs = ids.map((id) => db.collection("farms").doc(id));
  const userRefs = ids.map((id) => db.collection("users").doc(id));
  const [farmSnaps, userSnaps] = await Promise.all([
    db.getAll(...farmRefs),
    db.getAll(...userRefs),
  ]);

  const routing = {};
  await Promise.all(
    ids.map(async (producerId, index) => {
      const farm = farmSnaps[index].exists ? farmSnaps[index].data() || {} : {};
      const user = userSnaps[index].exists ? userSnaps[index].data() || {} : {};
      const accountId = user.stripeConnectAccountId || user.stripeAccountId || "";
      const optedIn =
        farm.acceptsStripePayments === true &&
        farm.paymentPreference === "stripe" &&
        String(accountId).startsWith("acct_");

      if (!optedIn) {
        routing[producerId] = { mode: "direct" };
        return;
      }

      try {
        const account = await stripe.accounts.retrieve(accountId);
        const ready =
          account.details_submitted === true &&
          account.charges_enabled === true &&
          account.payouts_enabled === true;
        routing[producerId] = ready
          ? { mode: "stripe", destination: accountId }
          : { mode: "direct" };
      } catch (error) {
        console.warn("[getProducerPaymentRouting] Connect account unavailable", {
          producerId,
          message: error?.message || String(error),
        });
        routing[producerId] = { mode: "direct" };
      }
    })
  );

  return routing;
}

async function createDirectMarketplaceOrder({
  uid,
  idempotencyKey,
  resolvedItems,
  subtotalCents,
  producers,
  perProducer,
  deliveryMethod,
  scheduledAt,
  notes,
  cartVersion,
}) {
  const intentRef = db.collection("direct_order_intents").doc(`${uid}_${idempotencyKey}`);
  const orderRef = db.collection("orders").doc();
  const user = await getUserOrThrow(uid);
  const buyerName = user.displayName || user.email || "Buyer";
  const buyerEmail = user.email || "";

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(intentRef);
    if (existing.exists) {
      const data = existing.data() || {};
      return { orderId: data.orderId, paymentMode: "direct" };
    }

    tx.set(intentRef, {
      uid,
      orderId: orderRef.id,
      cartVersion,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(orderRef, {
      buyerId: uid,
      status: "awaiting_payment",
      paymentMode: "direct",
      paymentStatus: "arrange_with_producer",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      itemsSnapshot: resolvedItems,
      pricing: {
        source: "server",
        currency: "usd",
        subtotalCents,
        processingFeeCents: 0,
        totalCents: subtotalCents,
        computedAt: FieldValue.serverTimestamp(),
      },
      producers,
      perProducer,
      deliveryMethod,
      scheduledAt: scheduledAt || null,
      notes: notes || "",
    });

    for (const producer of producers) {
      const producerId = producer.producerId;
      const producerItems = resolvedItems.filter((item) => item.producerId === producerId);
      const fulfillment = perProducer[producerId] || {};
      const producerOrderRef = db
        .collection("producerOrders")
        .doc(producerId)
        .collection("orders")
        .doc(orderRef.id);
      tx.set(producerOrderRef, {
        orderId: orderRef.id,
        buyerId: uid,
        buyerName,
        buyerEmail,
        items: producerItems,
        status: "awaiting_payment",
        paymentMode: "direct",
        paymentStatus: "arrange_with_buyer",
        totalCents: producer.subtotalCents || 0,
        fulfillment: {
          method: fulfillment.fulfillmentMethod || deliveryMethod,
          fulfillmentMethod: fulfillment.fulfillmentMethod || deliveryMethod,
          window: fulfillment.window || null,
          scheduledAt: scheduledAt || null,
          notes: notes || "",
        },
        scheduledAt: scheduledAt || null,
        notes: notes || "",
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(
      db.collection("carts").doc(uid),
      {
        items: [],
        cartVersion: cartVersion + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { orderId: orderRef.id, paymentMode: "direct" };
  });
}

// ---------------------------
// createCheckoutSession (producer subscriptions only)
// NEW FLOW: always success -> /#/subscribe-success
// cancel -> /#/ (landing)
// ---------------------------
exports.createCheckoutSession = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    try {
      const stripe = getStripe();

      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

      const { role } = request.data || {};
      if (role !== "producer") {
        throw new HttpsError(
          "failed-precondition",
          "Buyer access is free and does not use subscription checkout."
        );
      }

      const producer = await getUserOrThrow(uid);
      assertRole(producer, ["producer"]);
      const acceptedTerms =
        producer.producerTerms?.accepted === true &&
        producer.producerTerms?.version === PRODUCER_TERMS_VERSION;
      if (!acceptedTerms) {
        throw new HttpsError(
          "failed-precondition",
          "Accept the current producer terms before subscribing."
        );
      }
      if (producer.producerOnboarding?.completed !== true) {
        throw new HttpsError(
          "failed-precondition",
          "Complete producer account setup before subscribing."
        );
      }

      const appUrl = getAppUrl();

      // ✅ NEW: always go to subscribe-success, then app routes to dashboard
      const successUrl = `${appUrl}/#/subscribe-success`;

      // ✅ NEW: cancel goes back to landing page (subscription page removed)
      const cancelUrl = `${appUrl}/#/`;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: PRODUCER_PRICE_ID, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { uid, role: "producer", type: "producer_subscription" },
        subscription_data: {
          metadata: { uid, role: "producer", type: "producer_subscription" },
        },
      });

      return { url: session.url };
    } catch (e) {
      console.error("createCheckoutSession error:", e);
      throw e instanceof HttpsError
        ? e
        : new HttpsError("internal", e.message || "createCheckoutSession failed");
    }
  }
);

// ---------------------------
// ✅ createCartCheckoutSession (ONE-TIME cart order checkout)
// This matches CartPage.tsx calling httpsCallable(functions, "createCartCheckoutSession")
// ---------------------------
exports.createCartCheckoutSession = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    try {
      const stripe = getStripe();

      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
      const user = await getUserOrThrow(uid);
      assertRole(user, ["buyer"]);

      const data = request.data || {};
      const items = Array.isArray(data.items) ? data.items : [];

      if (!items.length) {
        throw new HttpsError("invalid-argument", "Cart is empty.");
      }

      // Validate + compute total
      let totalCents = 0;
      const safeItems = items.map((it) => {
        const name = String(it?.name || "Item");
        const unit = String(it?.unit || "");
        const qty = Math.max(1, Number(it?.qty || 1));
        const priceCents = Math.max(0, Number(it?.priceCents || 0));
        totalCents += qty * priceCents;

        return {
          id: String(it?.id || ""),
          productId: String(it?.productId || it?.id || ""),
          name,
          unit,
          qty,
          priceCents,
          producerId: String(it?.producerId || ""),
          producerName: String(it?.producerName || ""),
        };
      });

      const deliveryMethod = data.deliveryMethod === "delivery" ? "delivery" : "pickup";
      const scheduledAt = data.scheduledAt ? String(data.scheduledAt) : null;
      const notes = data.notes ? String(data.notes) : "";

      // Create an order doc first (status pending)
      const orderRef = db.collection("orders").doc();
      const orderId = orderRef.id;

      await orderRef.set(
        {
          buyerId: uid,
          status: "pending",
          createdAt: FieldValue.serverTimestamp(),
          deliveryMethod,
          scheduledAt,
          notes,
          totalCents,
          items: safeItems,
        },
        { merge: true }
      );

      const appUrl = getAppUrl();

      const successUrl = `${appUrl}/#/order-success?orderId=${orderId}`;
      const cancelUrl = `${appUrl}/#/cart`;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: safeItems.map((it) => ({
          price_data: {
            currency: "usd",
            product_data: {
              name: it.unit ? `${it.name} (${it.unit})` : it.name,
            },
            unit_amount: it.priceCents,
          },
          quantity: it.qty,
        })),
        success_url: successUrl,
        cancel_url: cancelUrl,

        // These are used by your stripeWebhook to find the order
        metadata: {
          orderId,
          uid,
          type: "order_checkout",
        },
        payment_intent_data: {
          metadata: {
            orderId,
            uid,
            type: "order_payment",
          },
        },
      });

      return { url: session.url, orderId };
    } catch (e) {
      console.error("createCartCheckoutSession error:", e);
      throw e instanceof HttpsError
        ? e
        : new HttpsError("internal", e.message || "createCartCheckoutSession failed");
    }
  }
);

// ---------------------------
// createCartCheckoutSessionV2 (server-authoritative pricing + idempotent)
// ---------------------------
exports.createCartCheckoutSessionV2 = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    try {
      const stripe = getStripe();

      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

      const data = request.data || {};
      const idempotencyKey = String(data.idempotencyKey || "").trim();
      if (!idempotencyKey) {
        throw new HttpsError("invalid-argument", "idempotencyKey is required");
      }

      const itemsInput = Array.isArray(data.items) ? data.items : [];
      const perProducerInput = data.perProducer || {};

      const user = await getUserOrThrow(uid);
      assertRole(user, ["buyer"]);

      const cartRef = db.collection("carts").doc(uid);
      const cartSnap = await cartRef.get();
      const cartData = (cartSnap.exists ? cartSnap.data() : {}) || {};
      const cartVersion =
        typeof cartData.cartVersion === "number" && Number.isFinite(cartData.cartVersion)
          ? cartData.cartVersion
          : 0;

      const { resolvedItems, subtotalCents, processingFeeCents, totalCents, producers } =
        await resolveProductsAndPricing(
          itemsInput.map((it) => ({
            productId: it.productId || it.id,
            qty: it.qty,
          }))
        );

      const producerIdsFromItems = new Set(
        resolvedItems.map((it) => (it.producerId ? it.producerId : "unknown"))
      );
      if (producerIdsFromItems.has("unknown")) {
        throw new HttpsError(
          "failed-precondition",
          "Every cart item must belong to a producer."
        );
      }
      const perProducer = buildPerProducerSnapshot(
        producerIdsFromItems,
        perProducerInput
      );
      const deliveryMethod =
        data.deliveryMethod === "delivery" ? "delivery" : "pickup";
      const scheduledAt = String(data.scheduledAt || "").trim();
      const notes = String(data.notes || "").trim().slice(0, 2000);
      const paymentRouting = await getProducerPaymentRouting(
        stripe,
        producerIdsFromItems
      );
      const allProducersUseStripe = [...producerIdsFromItems].every(
        (producerId) => paymentRouting[producerId]?.mode === "stripe"
      );

      if (!allProducersUseStripe) {
        return await createDirectMarketplaceOrder({
          uid,
          idempotencyKey,
          resolvedItems,
          subtotalCents,
          producers,
          perProducer,
          deliveryMethod,
          scheduledAt,
          notes,
          cartVersion,
        });
      }

      const payoutDestinations = {};
      producerIdsFromItems.forEach((producerId) => {
        payoutDestinations[producerId] = paymentRouting[producerId].destination;
      });

      const intentId = `${uid}_${idempotencyKey}`;
      const intentRef = db.collection("checkout_intents").doc(intentId);
      const orderIntents = db.collection("order_intents");
      const orders = db.collection("orders");
      const nowMs = Date.now();
      const TTL_MS = 10 * 60 * 1000;

      const transferGroupBase = "order";

      const intentResult = await db.runTransaction(async (tx) => {
        const snap = await tx.get(intentRef);
        if (snap.exists) {
          const intent = snap.data() || {};
          const createdAt = intent.createdAt?.toMillis ? intent.createdAt.toMillis() : 0;
          const fresh = nowMs - createdAt <= TTL_MS;
          if (fresh && intent.cartVersion === cartVersion) {
            return { kind: "existing", intent };
          }
          throw new HttpsError(
            "failed-precondition",
            "Idempotency key no longer valid for current cart; please retry with a new key."
          );
        }

        const orderRef = orders.doc();
        const orderId = orderRef.id;
        const transferGroup = `${transferGroupBase}_${orderId}`;

        tx.set(intentRef, {
          uid,
          idempotencyKey,
          cartVersion,
          orderId,
          transferGroup,
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.set(orderIntents.doc(orderId), {
          uid,
          itemsRequested: itemsInput,
          itemsSnapshot: resolvedItems,
          subtotalCents,
          processingFeeCents,
          totalCents,
          perProducer,
          payoutDestinations,
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.set(
          orderRef,
          {
            buyerId: uid,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            itemsSnapshot: resolvedItems,
            pricing: {
              source: "server",
              currency: "usd",
              subtotalCents,
              processingFeeCents,
              totalCents,
              computedAt: FieldValue.serverTimestamp(),
            },
            producers,
            perProducer,
            transferGroup,
            paymentMode: "stripe",
            deliveryMethod,
            scheduledAt: scheduledAt || null,
            notes,
          },
          { merge: true }
        );

        return { kind: "new", orderId, transferGroup };
      });

      const appUrl = getAppUrl();
      let orderId;
      let transferGroup;
      let session;
      const stripeIdempotencyKey = intentId;

      if (intentResult.kind === "existing") {
        const intent = intentResult.intent;
        orderId = intent.orderId;
        transferGroup = intent.transferGroup || `${transferGroupBase}_${orderId}`;
        if (intent.sessionId && intent.sessionUrl) {
          return { url: intent.sessionUrl, orderId };
        }
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
              ...resolvedItems.map((it) => ({
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: it.unit ? `${it.name} (${it.unit})` : it.name,
                  },
                  unit_amount: it.priceCents,
                },
                quantity: it.qty,
              })),
              {
                price_data: {
                  currency: "usd",
                  product_data: { name: "Processing fee" },
                  unit_amount: processingFeeCents,
                },
                quantity: 1,
              },
            ],
            success_url: `${appUrl}/#/order-success?orderId=${orderId}`,
            cancel_url: `${appUrl}/#/cart`,
            metadata: {
              orderId,
              uid,
              type: "order_checkout_v2",
            },
            payment_intent_data: {
              metadata: {
                orderId,
                uid,
                type: "order_payment_v2",
              },
              transfer_group: transferGroup,
            },
          },
          { idempotencyKey: stripeIdempotencyKey }
        );
      } else {
        orderId = intentResult.orderId;
        transferGroup = intentResult.transferGroup;
        session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
              ...resolvedItems.map((it) => ({
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: it.unit ? `${it.name} (${it.unit})` : it.name,
                  },
                  unit_amount: it.priceCents,
                },
                quantity: it.qty,
              })),
              {
                price_data: {
                  currency: "usd",
                  product_data: { name: "Processing fee" },
                  unit_amount: processingFeeCents,
                },
                quantity: 1,
              },
            ],
            success_url: `${appUrl}/#/order-success?orderId=${orderId}`,
            cancel_url: `${appUrl}/#/cart`,
            metadata: {
              orderId,
              uid,
              type: "order_checkout_v2",
            },
            payment_intent_data: {
              metadata: {
                orderId,
                uid,
                type: "order_payment_v2",
              },
              transfer_group: transferGroup,
            },
          },
          { idempotencyKey: stripeIdempotencyKey }
        );
      }

      const sessionUrl = session.url;
      if (sessionUrl) {
        await Promise.all([
          db.collection("orders").doc(orderId).set(
            { stripe: { checkoutSessionId: session.id } },
            { merge: true }
          ),
          intentRef.set(
            { sessionId: session.id, sessionUrl, transferGroup },
            { merge: true }
          ),
        ]);
      }

      return { url: sessionUrl, orderId, paymentMode: "stripe" };
    } catch (e) {
      console.error("createCartCheckoutSessionV2 error:", e);
      throw e instanceof HttpsError
        ? e
        : new HttpsError("internal", e.message || "createCartCheckoutSessionV2 failed");
    }
  }
);

// ---------------------------
// createPortalSession (kept as-is)
// ---------------------------
exports.createPortalSession = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    try {
      const stripe = getStripe();

      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

      const userSnap = await db.collection("users").doc(uid).get();
      const stripeCustomerId = userSnap.exists
        ? userSnap.data().stripeCustomerId
        : null;

      if (!stripeCustomerId)
        throw new HttpsError("failed-precondition", "No stripeCustomerId for user");

      const appUrl = getAppUrl();

      const portal = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${appUrl}/#/dashboard`,
      });

      return { url: portal.url };
    } catch (e) {
      console.error("createPortalSession error:", e);
      throw e instanceof HttpsError
        ? e
        : new HttpsError("internal", e.message || "createPortalSession failed");
    }
  }
);

// ---------------------------
// Stripe Connect: producer onboarding (Express accounts)
// ---------------------------

exports.createProducerConnectAccount = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }

      const producerId = (request.data && request.data.producerId) || uid;
      if (producerId !== uid) {
        throw new HttpsError("permission-denied", "You can only create a Connect account for yourself.");
      }

      const userRef = db.collection("users").doc(producerId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("failed-precondition", "Producer profile not found. Please complete sign-up first.");
      }

      const userData = userSnap.data() || {};
      if (
        userData.role !== "producer" ||
        userData.producerTerms?.accepted !== true ||
        userData.producerTerms?.version !== PRODUCER_TERMS_VERSION
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Accept the current producer terms and complete producer signup first."
        );
      }
      const existingId = userData.stripeConnectAccountId || userData.stripeAccountId;
      if (existingId && String(existingId).startsWith("acct_")) {
        return { stripeAccountId: existingId };
      }

      const stripe = getStripe();
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
      });

      if (!account.id) {
        throw new HttpsError("internal", "Stripe Connect account creation failed. Please try again.");
      }

      await userRef.set(
        {
          stripeConnectAccountId: account.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { stripeAccountId: account.id };
    } catch (e) {
      console.error("createProducerConnectAccount error:", e);
      if (e instanceof HttpsError) throw e;
      const msg = e && e.message ? e.message : "Stripe Connect account creation failed. Please try again.";
      throw new HttpsError("internal", msg);
    }
  }
);

exports.createProducerOnboardingLink = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    try {
      const uid = request.auth?.uid;
      if (!uid) {
        throw new HttpsError("unauthenticated", "Please sign in first.");
      }

      const producerId = (request.data && request.data.producerId) || uid;
      if (producerId !== uid) {
        throw new HttpsError("permission-denied", "You can only create an onboarding link for yourself.");
      }

      const userSnap = await db.collection("users").doc(producerId).get();
      if (!userSnap.exists) {
        throw new HttpsError("failed-precondition", "Producer profile not found. Please complete sign-up first.");
      }

      const userData = userSnap.data() || {};
      const stripeConnectAccountId = userData.stripeConnectAccountId || userData.stripeAccountId;
      if (!stripeConnectAccountId || !String(stripeConnectAccountId).startsWith("acct_")) {
        throw new HttpsError(
          "failed-precondition",
          "No Connect account found. Please click Start onboarding again."
        );
      }

      const appUrl = getAppUrl();
      const returnUrl = `${appUrl}/#/producer/payouts?return=1`;
      const refreshUrl = `${appUrl}/#/producer/payouts?refresh=1`;

      const stripe = getStripe();
      const link = await stripe.accountLinks.create({
        account: stripeConnectAccountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });

      if (!link || !link.url) {
        throw new HttpsError("internal", "Could not create onboarding link. Please try again.");
      }

      return { url: link.url };
    } catch (e) {
      console.error("createProducerOnboardingLink error:", e);
      if (e instanceof HttpsError) throw e;
      const msg = e && e.message ? e.message : "Could not create onboarding link. Please try again.";
      throw new HttpsError("internal", msg);
    }
  }
);

// ---------------------------
// stripeWebhook
// ✅ FIX: handle subscription checkouts AND orders
// ---------------------------
exports.stripeWebhook = require("firebase-functions/v2/https").onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    try {
      const stripe = getStripe();
      const whsec = STRIPE_WEBHOOK_SECRET.value();
      if (!whsec) throw new Error("STRIPE_WEBHOOK_SECRET secret is missing");

      const sig = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, whsec);
      } catch (err) {
        console.error("Webhook signature verification failed.", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      const alreadyProcessed = await withStripeEventIdempotency(event, async () => {
        const type = event.type;

        if (type === "checkout.session.completed") {
          const session = event.data.object;

          const meta = session.metadata || {};
          const uid = meta.uid || null;
          const metaType = (meta.type || "").toString();

          if (metaType === "order_checkout_v2") {
            const orderId = meta.orderId || null;
            if (orderId) {
              if (session.payment_status !== "paid") {
                throw new Error(`Order ${orderId} checkout completed without paid status.`);
              }
              const orderRef = db.collection("orders").doc(orderId);
              const intentRef = db.collection("order_intents").doc(orderId);

              await db.runTransaction(async (tx) => {
                const [orderSnap, intentSnap] = await Promise.all([
                  tx.get(orderRef),
                  tx.get(intentRef),
                ]);
                if (!orderSnap.exists || !intentSnap.exists) {
                  return;
                }
                const orderData = orderSnap.data() || {};
                if (orderData.status === "paid") {
                  return;
                }
                const intentData = intentSnap.data() || {};
                const chargedTotal = session.amount_total || 0;
                const expectedTotal = intentData.totalCents || 0;
                if (chargedTotal !== expectedTotal) {
                  tx.set(
                    orderRef,
                    {
                      status: "payment_mismatch",
                      stripe: {
                        ...(orderData.stripe || {}),
                        paymentIntentId: session.payment_intent || null,
                        paymentStatus: session.payment_status,
                        amountTotal: chargedTotal,
                      },
                    },
                    { merge: true }
                  );
                  return;
                }
                tx.set(
                  orderRef,
                  {
                    status: "paid",
                    paidAt: FieldValue.serverTimestamp(),
                    stripe: {
                      ...(orderData.stripe || {}),
                      paymentIntentId: session.payment_intent || null,
                      paymentStatus: session.payment_status,
                      amountTotal: chargedTotal,
                    },
                  },
                  { merge: true }
                );
              });

              const orderSnapAfter = await db.collection("orders").doc(orderId).get();
              if (orderSnapAfter.exists) {
                const order = orderSnapAfter.data() || {};
                if (order.status !== "paid") {
                  return;
                }
                const itemsSnapshot = Array.isArray(order.itemsSnapshot) ? order.itemsSnapshot : [];
                const perProducer = order.perProducer || {};
                const producers = Array.isArray(order.producers) ? order.producers : [];
                const intentSnapAfter = await intentRef.get();
                const intent = intentSnapAfter.exists ? intentSnapAfter.data() || {} : {};
                const payoutDestinations = intent.payoutDestinations || {};
                const buyerId = order.buyerId || uid;
                let buyerName = "Buyer";
                let buyerEmail = "";
                if (buyerId) {
                  try {
                    const userSnap = await db.collection("users").doc(buyerId).get();
                    if (userSnap.exists) {
                      const u = userSnap.data() || {};
                      buyerName = u.displayName || u.email || buyerName;
                      buyerEmail = u.email || "";
                    }
                  } catch (_) {}
                }
                const paymentIntent =
                  typeof session.payment_intent === "string"
                    ? await stripe.paymentIntents.retrieve(session.payment_intent)
                    : session.payment_intent;
                const sourceCharge =
                  typeof paymentIntent?.latest_charge === "string"
                    ? paymentIntent.latest_charge
                    : paymentIntent?.latest_charge?.id || null;
                if (!sourceCharge) {
                  throw new Error(`Order ${orderId} is missing its Stripe source charge.`);
                }

                const stripeTransfers = [];
                for (const p of producers) {
                  const producerId = p.producerId;
                  const destination = payoutDestinations[producerId];
                  if (!destination || !String(destination).startsWith("acct_")) {
                    throw new Error(`Order ${orderId} has no payout destination for producer ${producerId}.`);
                  }
                  const transfer = await stripe.transfers.create(
                    {
                      amount: Number(p.subtotalCents || 0),
                      currency: "usd",
                      destination,
                      source_transaction: sourceCharge,
                      transfer_group: order.transferGroup,
                      metadata: {
                        orderId,
                        producerId,
                      },
                    },
                    {
                      idempotencyKey: `order_${orderId}_producer_${producerId}`,
                    }
                  );
                  stripeTransfers.push({
                    producerId,
                    transferId: transfer.id,
                    amountCents: Number(p.subtotalCents || 0),
                  });
                  const producerItems = itemsSnapshot.filter(
                    (it) => (it.producerId || "unknown") === producerId
                  );
                  const perProducerEntry = perProducer[producerId] || {};
                  const fulfillmentMethod = perProducerEntry.fulfillmentMethod === "delivery" ? "delivery" : "pickup";
                  const producerOrderRef = db
                    .collection("producerOrders")
                    .doc(producerId)
                    .collection("orders")
                    .doc(orderId);
                  const scheduleFromOrder = {
                    ...(order.scheduledAt != null && order.scheduledAt !== "" && { scheduledAt: order.scheduledAt }),
                    ...(order.pickupDate != null && order.pickupDate !== "" && { pickupDate: order.pickupDate }),
                    ...(order.pickupTime != null && order.pickupTime !== "" && { pickupTime: order.pickupTime }),
                    ...(order.deliveryDate != null && order.deliveryDate !== "" && { deliveryDate: order.deliveryDate }),
                    ...(order.deliveryTime != null && order.deliveryTime !== "" && { deliveryTime: order.deliveryTime }),
                  };
                  await producerOrderRef.set(
                    {
                      orderId,
                      buyerId: order.buyerId || null,
                      buyerName,
                      buyerEmail,
                      items: producerItems,
                      fulfillment: {
                        method: fulfillmentMethod,
                        fulfillmentMethod,
                        window: perProducerEntry.window || null,
                        ...scheduleFromOrder,
                      },
                      status: "paid",
                      paymentMode: "stripe",
                      paymentStatus: "paid",
                      totalCents: p.subtotalCents || 0,
                      payoutsStatus: "transferred",
                      stripeTransferId: transfer.id,
                      createdAt: order.createdAt || FieldValue.serverTimestamp(),
                      ...scheduleFromOrder,
                    },
                    { merge: true }
                  );
                }
                await orderRef.set(
                  {
                    payoutStatus: "transferred",
                    stripeTransfers,
                    updatedAt: FieldValue.serverTimestamp(),
                  },
                  { merge: true }
                );
                // Clear buyer cart only after confirmed payment (idempotent)
                if (uid) {
                  await db.collection("carts").doc(uid).set({ items: [] }, { merge: true });
                }
              }
            }
            return;
          }

          // ✅ 1) SUBSCRIPTION CHECKOUT HANDLING (NEW)
          if (uid && metaType.includes("subscription")) {
            const subId = session.subscription;

            let stripeSub = null;
            try {
              if (subId) stripeSub = await stripe.subscriptions.retrieve(subId);
            } catch (e) {
              console.warn("Could not retrieve Stripe subscription:", e.message);
            }

            const status = (stripeSub && stripeSub.status) ? stripeSub.status : "active";
            const currentPeriodEndSec = stripeSub?.current_period_end || 0;

            // Store role too (buyer/producer)
            const role = meta.role === "producer" || meta.role === "buyer" ? meta.role : null;

            await db.collection("users").doc(uid).set(
              {
                ...(role ? { role } : {}),
                stripeCustomerId: session.customer || null,
                subscription: {
                  status, // 'active', 'trialing', 'canceled', etc.
                  currentPeriodEnd: currentPeriodEndSec ? currentPeriodEndSec * 1000 : 0,
                  stripeSubscriptionId: subId || null,
                },
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            return res.json({ received: true, handled: "subscription" });
          }

          // ✅ 2) ORDER CHECKOUT HANDLING (your existing logic)
          const orderId =
            (session.metadata && session.metadata.orderId) ||
            (session.payment_intent &&
              (await stripe.paymentIntents.retrieve(session.payment_intent)).metadata.orderId);

          if (orderId) {
            const orderRef = db.collection("orders").doc(orderId);

            let lineItems = [];
            try {
              const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
              lineItems = li && li.data ? li.data : [];
            } catch (e) {
              console.warn("Could not list line items:", e.message);
            }

            const updatedItems = lineItems.map((li) => {
              const name = li.description || "Item";
              const qty = li.quantity || 1;
              const amountTotal = li.amount_total || 0;
              const amountSubtotal = li.amount_subtotal || 0;
              const unitAmount = li.price && li.price.unit_amount != null ? li.price.unit_amount : null;

              return {
                title: name,
                qty,
                priceCents: unitAmount != null ? unitAmount : qty ? Math.round(amountSubtotal / qty) : 0,
                lineTotalCents: amountTotal,
              };
            });

            await orderRef.set(
              {
                buyerId: uid || FieldValue.delete(),
                status: "paid",
                paidAt: FieldValue.serverTimestamp(),
                stripePaymentStatus: session.payment_status,
                stripePaymentIntent: session.payment_intent || null,
                totalCents: session.amount_total || 0,
                itemsPaidSnapshot: updatedItems,
              },
              { merge: true }
            );

            // Mirror to producerOrders so producers can query their orders (V1 path)
            const orderSnap = await orderRef.get();
            if (orderSnap.exists && uid) {
              const orderData = orderSnap.data() || {};
              const orderItems = Array.isArray(orderData.items) ? orderData.items : [];
              const deliveryMethod = orderData.deliveryMethod === "delivery" ? "delivery" : "pickup";
              const scheduledAt = orderData.scheduledAt || null;
              const notes = orderData.notes || "";

              let buyerName = "Buyer";
              let buyerEmail = "";
              try {
                const userSnap = await db.collection("users").doc(uid).get();
                if (userSnap.exists) {
                  const u = userSnap.data() || {};
                  buyerName = u.displayName || u.email || buyerName;
                  buyerEmail = u.email || "";
                }
              } catch (_) {}

              const byProducer = {};
              orderItems.forEach((it) => {
                const pid = it.producerId || "unknown";
                if (!byProducer[pid]) byProducer[pid] = { items: [], totalCents: 0 };
                const priceCents = Number(it.priceCents || 0);
                const qty = Math.max(1, Number(it.qty || 1));
                byProducer[pid].items.push({
                  title: it.name || "Item",
                  price: priceCents / 100,
                  unit: it.unit || "each",
                  qty,
                });
                byProducer[pid].totalCents += priceCents * qty;
              });

              for (const [producerId, v] of Object.entries(byProducer)) {
                const producerOrderRef = db
                  .collection("producerOrders")
                  .doc(producerId)
                  .collection("orders")
                  .doc(orderId);
                await producerOrderRef.set(
                  {
                    orderId,
                    buyerId: uid,
                    buyerName,
                    buyerEmail,
                    items: v.items,
                    status: "paid",
                    totalCents: v.totalCents,
                    deliveryMethod,
                    scheduledAt,
                    notes,
                    fulfillment: { method: deliveryMethod, notes: notes || undefined },
                    createdAt: orderData.createdAt || FieldValue.serverTimestamp(),
                  },
                  { merge: true }
                );
              }
            }

            // Clear buyer cart only after confirmed payment (idempotent)
            if (uid) {
              await db.collection("carts").doc(uid).set({ items: [] }, { merge: true });
            }
          }
        }
      });

      if (!res.headersSent) {
        res.json({ received: true });
      }
    } catch (e) {
      console.error("stripeWebhook error:", e);
      res.status(500).send("Webhook handler failed");
    }
  }
);
