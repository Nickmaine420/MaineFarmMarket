/* eslint-disable */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const {
  FieldValue,
  Timestamp,
  getFirestore,
} = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");
const { GoogleAuth } = require("google-auth-library");
const {
  allocateRefundAcrossTransfers,
  assertProducerStatusTransition,
  buildGooglePlayProducerMonthlyBasePlan,
  canBuyerCancelDirectOrder,
  directOrderInventoryState,
  directOrderReservationExpiry,
  deriveBuyerOrderStatus,
  effectiveProductPriceCents,
  normalizeRequestedItems,
  normalizeListingReportReason,
  pendingDirectProducerIds,
  validateScheduledAt,
} = require("./marketplace");

initializeApp();
const db = getFirestore();

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
const GOOGLE_PLAY_PACKAGE_NAME = "com.mainefarmmarket.app";
const GOOGLE_PLAY_PRODUCER_PRODUCT_ID = "producer_monthly";
const GOOGLE_PLAY_PRODUCER_BASE_PLAN_ID = "monthly";
const DIRECT_ORDER_MAX_PER_HOUR = 5;
const DIRECT_ORDER_MAX_PER_DAY = 20;
const LISTING_REPORT_MAX_PER_HOUR = 3;
const LISTING_REPORT_MAX_PER_DAY = 10;
const ADMIN_EMAILS = new Set(["contactacontractorllc@gmail.com"]);
const googlePlayAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});

function normalizedAuthEmail(request) {
  return String(request.auth?.token?.email || "").trim().toLowerCase();
}

function assertVerifiedAccount(request) {
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Verify your email address before placing marketplace orders."
    );
  }
}

function assertAdmin(request) {
  const email = normalizedAuthEmail(request);
  if (
    !request.auth?.uid ||
    request.auth?.token?.email_verified !== true ||
    (request.auth?.token?.admin !== true && !ADMIN_EMAILS.has(email))
  ) {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
  return email;
}

function rateLimitRefs(uid, nowMs) {
  const hourBucket = Math.floor(nowMs / (60 * 60 * 1000));
  const dayBucket = Math.floor(nowMs / (24 * 60 * 60 * 1000));
  return {
    hourly: db.collection("order_rate_limits").doc(`${uid}_hour_${hourBucket}`),
    daily: db.collection("order_rate_limits").doc(`${uid}_day_${dayBucket}`),
  };
}

function enforceOrderRateLimitInTransaction(tx, uid, snapshots, refs, nowMs) {
  const checks = [
    { snapshot: snapshots.hourly, ref: refs.hourly, limit: DIRECT_ORDER_MAX_PER_HOUR },
    { snapshot: snapshots.daily, ref: refs.daily, limit: DIRECT_ORDER_MAX_PER_DAY },
  ];
  checks.forEach(({ snapshot, ref, limit }) => {
    const count = Number(snapshot.exists ? snapshot.get("count") : 0) || 0;
    if (count >= limit) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many orders were placed from this account. Please wait and try again."
      );
    }
    tx.set(
      ref,
      {
        uid,
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(nowMs + 48 * 60 * 60 * 1000),
      },
      { merge: true }
    );
  });
}

function listingReportRateLimitRefs(uid, listingId, nowMs) {
  const hourBucket = Math.floor(nowMs / (60 * 60 * 1000));
  const dayBucket = Math.floor(nowMs / (24 * 60 * 60 * 1000));
  const dedupeId = createHash("sha256")
    .update(`${uid}:${listingId}:${dayBucket}`)
    .digest("hex");
  return {
    hourly: db.collection("report_rate_limits").doc(`${uid}_hour_${hourBucket}`),
    daily: db.collection("report_rate_limits").doc(`${uid}_day_${dayBucket}`),
    duplicate: db.collection("report_dedupes").doc(dedupeId),
  };
}

function enforceListingReportRateLimitInTransaction(
  tx,
  uid,
  snapshots,
  refs,
  nowMs
) {
  if (snapshots.duplicate.exists) {
    throw new HttpsError(
      "already-exists",
      "You already reported this listing recently. Our team will review it."
    );
  }
  [
    { snapshot: snapshots.hourly, ref: refs.hourly, limit: LISTING_REPORT_MAX_PER_HOUR },
    { snapshot: snapshots.daily, ref: refs.daily, limit: LISTING_REPORT_MAX_PER_DAY },
  ].forEach(({ snapshot, ref, limit }) => {
    const count = Number(snapshot.exists ? snapshot.get("count") : 0) || 0;
    if (count >= limit) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many reports were submitted from this account. Please wait before reporting again."
      );
    }
    tx.set(
      ref,
      {
        uid,
        count: count + 1,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(nowMs + 48 * 60 * 60 * 1000),
      },
      { merge: true }
    );
  });
}

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

function accountDeletionRecordId(uid) {
  return createHash("sha256").update(uid).digest("hex");
}

async function accountDeletionIsPendingOrComplete(uid) {
  const snapshot = await db
    .collection("account_deletion_records")
    .doc(accountDeletionRecordId(uid))
    .get();
  if (!snapshot.exists) return false;
  return ["pending", "completed"].includes(snapshot.get("status"));
}

async function getUserOrThrow(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "User profile missing");
  }
  return snap.data();
}

async function syncStripeSubscriptionRecord(subscription, eventType) {
  const subscriptionId = subscription?.id || null;
  const customerId =
    typeof subscription?.customer === "string"
      ? subscription.customer
      : subscription?.customer?.id || null;
  let uid = subscription?.metadata?.uid || null;

  if (!uid && subscriptionId) {
    const bySubscription = await db
      .collection("users")
      .where("subscription.stripeSubscriptionId", "==", subscriptionId)
      .limit(1)
      .get();
    if (!bySubscription.empty) uid = bySubscription.docs[0].id;
  }
  if (!uid && customerId) {
    const byCustomer = await db
      .collection("users")
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();
    if (!byCustomer.empty) uid = byCustomer.docs[0].id;
  }
  if (!uid) {
    console.warn("[syncStripeSubscriptionRecord] No matching user", {
      subscriptionId,
      eventType,
    });
    return;
  }
  if (await accountDeletionIsPendingOrComplete(uid)) {
    console.info("[syncStripeSubscriptionRecord] Ignoring deleted account", { uid });
    return;
  }

  const status =
    eventType === "customer.subscription.deleted"
      ? "canceled"
      : String(subscription?.status || "inactive");
  const currentPeriodEndSec = Number(subscription?.current_period_end || 0);
  const canceledAtSec = Number(subscription?.canceled_at || 0);

  await db.collection("users").doc(uid).set(
    {
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      subscription: {
        status,
        provider: "stripe",
        currentPeriodEnd: currentPeriodEndSec ? currentPeriodEndSec * 1000 : 0,
        stripeSubscriptionId: subscriptionId,
        cancelAtPeriodEnd: subscription?.cancel_at_period_end === true,
        ...(status === "canceled"
          ? {
              canceledAt: canceledAtSec
                ? canceledAtSec * 1000
                : Date.now(),
            }
          : {}),
      },
      subscriptionStatus: ["active", "trialing"].includes(status)
        ? "active"
        : "inactive",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function googlePlayPurchaseRecordId(purchaseToken) {
  return createHash("sha256").update(purchaseToken).digest("hex");
}

function googlePlayAccountId(uid) {
  return createHash("sha256").update(uid).digest("hex");
}

async function googlePlayRequest(options) {
  const client = await googlePlayAuth.getClient();
  return client.request(options);
}

function googlePlaySubscriptionProductUrl() {
  return (
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    `${GOOGLE_PLAY_PACKAGE_NAME}/subscriptions/${GOOGLE_PLAY_PRODUCER_PRODUCT_ID}`
  );
}

async function activateGooglePlayProducerBasePlan(productUrl) {
  await googlePlayRequest({
    method: "POST",
    url:
      `${productUrl}/basePlans/` +
      `${GOOGLE_PLAY_PRODUCER_BASE_PLAN_ID}:activate`,
    data: {},
  });
  const verificationResponse = await googlePlayRequest({
    method: "GET",
    url: productUrl,
  });
  const verifiedPlan = (verificationResponse.data?.basePlans || []).find(
    (plan) => plan?.basePlanId === GOOGLE_PLAY_PRODUCER_BASE_PLAN_ID
  );
  if (verifiedPlan?.state !== "ACTIVE") {
    throw new Error("Google Play created the producer base plan but did not activate it.");
  }
  return verifiedPlan;
}

async function ensureGooglePlayProducerBasePlan() {
  const productUrl = googlePlaySubscriptionProductUrl();
  const existingResponse = await googlePlayRequest({ method: "GET", url: productUrl });
  const subscription = existingResponse.data || {};
  const basePlans = Array.isArray(subscription.basePlans)
    ? subscription.basePlans
    : [];
  const existingPlan = basePlans.find(
    (plan) => plan?.basePlanId === GOOGLE_PLAY_PRODUCER_BASE_PLAN_ID
  );

  if (existingPlan) {
    let state = existingPlan.state || "STATE_UNSPECIFIED";
    let activated = false;
    if (state === "DRAFT") {
      const activatedPlan = await activateGooglePlayProducerBasePlan(productUrl);
      state = activatedPlan.state;
      activated = true;
    }
    return {
      basePlanId: GOOGLE_PLAY_PRODUCER_BASE_PLAN_ID,
      state,
      created: false,
      activated,
    };
  }
  if (basePlans.length > 0) {
    throw new Error(
      "A different Google Play base plan already exists; refusing to replace it automatically."
    );
  }

  const convertedPricesResponse = await googlePlayRequest({
    method: "POST",
    url:
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
      `${GOOGLE_PLAY_PACKAGE_NAME}/pricing:convertRegionPrices`,
    data: {
      price: {
        currencyCode: "USD",
        units: "29",
        nanos: 990000000,
      },
    },
  });
  const conversion = convertedPricesResponse.data || {};
  const regionsVersion = String(conversion.regionVersion?.version || "").trim();
  const unitedStatesPrice = conversion.convertedRegionPrices?.US?.price;
  if (!regionsVersion || !unitedStatesPrice) {
    throw new Error("Google Play did not return a current United States regional price.");
  }

  const basePlan = buildGooglePlayProducerMonthlyBasePlan(unitedStatesPrice);
  const patchResponse = await googlePlayRequest({
    method: "PATCH",
    url: productUrl,
    params: {
      updateMask: "basePlans",
      "regionsVersion.version": regionsVersion,
    },
    data: {
      packageName: GOOGLE_PLAY_PACKAGE_NAME,
      productId: GOOGLE_PLAY_PRODUCER_PRODUCT_ID,
      basePlans: [basePlan],
    },
  });
  const createdPlan = (patchResponse.data?.basePlans || []).find(
    (plan) => plan?.basePlanId === GOOGLE_PLAY_PRODUCER_BASE_PLAN_ID
  );
  if (!createdPlan) {
    throw new Error("Google Play did not return the newly created producer base plan.");
  }

  let finalState = createdPlan.state || "STATE_UNSPECIFIED";
  let activated = false;
  if (finalState !== "ACTIVE") {
    const activatedPlan = await activateGooglePlayProducerBasePlan(productUrl);
    finalState = activatedPlan.state;
    activated = true;
  }

  return {
    basePlanId: GOOGLE_PLAY_PRODUCER_BASE_PLAN_ID,
    state: finalState,
    created: true,
    activated,
  };
}

exports.ensureGooglePlayProducerBasePlan = onCall(
  { timeoutSeconds: 120 },
  async (request) => {
    assertAdmin(request);
    return ensureGooglePlayProducerBasePlan();
  }
);

exports.ensureGooglePlayProducerBasePlanScheduled = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/New_York",
    timeoutSeconds: 120,
  },
  async () => {
    const result = await ensureGooglePlayProducerBasePlan();
    console.info("[ensureGooglePlayProducerBasePlanScheduled]", result);
    return result;
  }
);

async function fetchGooglePlaySubscription(purchaseToken) {
  const encodedToken = encodeURIComponent(purchaseToken);
  const response = await googlePlayRequest({
    method: "GET",
    url:
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
      `${GOOGLE_PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodedToken}`,
  });
  return response.data || {};
}

async function acknowledgeGooglePlaySubscription(purchaseToken, productId) {
  const encodedToken = encodeURIComponent(purchaseToken);
  const encodedProductId = encodeURIComponent(productId);
  await googlePlayRequest({
    method: "POST",
    url:
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
      `${GOOGLE_PLAY_PACKAGE_NAME}/purchases/subscriptions/${encodedProductId}/tokens/` +
      `${encodedToken}:acknowledge`,
    data: {},
  });
}

async function cancelGooglePlaySubscription(purchaseToken) {
  const encodedToken = encodeURIComponent(purchaseToken);
  await googlePlayRequest({
    method: "POST",
    url:
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
      `${GOOGLE_PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodedToken}:cancel`,
    data: {
      cancellationContext: {
        cancellationType: "USER_REQUESTED_STOP_RENEWALS",
      },
    },
  });
}

function googlePlaySubscriptionSummary(resource) {
  const lineItems = Array.isArray(resource.lineItems) ? resource.lineItems : [];
  const producerItems = lineItems.filter(
    (item) => item?.productId === GOOGLE_PLAY_PRODUCER_PRODUCT_ID
  );
  if (!producerItems.length) {
    throw new HttpsError(
      "failed-precondition",
      "This Google Play purchase is not the Maine Farm Market producer subscription."
    );
  }

  const currentPeriodEnd = Math.max(
    ...producerItems.map((item) => Date.parse(item?.expiryTime || "") || 0)
  );
  const subscriptionState = String(
    resource.subscriptionState || "SUBSCRIPTION_STATE_UNSPECIFIED"
  );
  const entitlementStates = new Set([
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
    "SUBSCRIPTION_STATE_CANCELED",
  ]);
  const active =
    currentPeriodEnd > Date.now() && entitlementStates.has(subscriptionState);

  return {
    active,
    status: active ? "active" : "inactive",
    subscriptionState,
    currentPeriodEnd,
    autoRenewing: producerItems.some(
      (item) => item?.autoRenewingPlan?.autoRenewEnabled === true
    ),
    basePlanId: producerItems[0]?.offerDetails?.basePlanId || null,
    latestOrderId:
      producerItems[0]?.latestSuccessfulOrderId || resource.latestOrderId || null,
    acknowledgementState: resource.acknowledgementState || null,
    testPurchase: Boolean(resource.testPurchase),
  };
}

async function syncGooglePlaySubscriptionForUser(uid, purchaseToken) {
  if (
    typeof purchaseToken !== "string" ||
    purchaseToken.length < 10 ||
    purchaseToken.length > 4096
  ) {
    throw new HttpsError("invalid-argument", "A valid Google Play purchase token is required.");
  }

  const resource = await fetchGooglePlaySubscription(purchaseToken);
  const summary = googlePlaySubscriptionSummary(resource);
  const expectedAccountId = googlePlayAccountId(uid);
  const purchaseAccountId =
    resource.externalAccountIdentifiers?.obfuscatedExternalAccountId ||
    resource.outOfAppPurchaseContext?.expiredExternalAccountIdentifiers
      ?.obfuscatedExternalAccountId ||
    null;
  if (purchaseAccountId !== expectedAccountId) {
    throw new HttpsError(
      "permission-denied",
      "This Google Play purchase belongs to a different Maine Farm Market account."
    );
  }

  const purchaseRecordId = googlePlayPurchaseRecordId(purchaseToken);
  const purchaseRef = db.collection("google_play_purchases").doc(purchaseRecordId);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(purchaseRef);
    if (existing.exists && existing.get("uid") !== uid) {
      throw new HttpsError(
        "permission-denied",
        "This Google Play purchase is already linked to another account."
      );
    }
    transaction.set(
      purchaseRef,
      {
        uid,
        provider: "google_play",
        packageName: GOOGLE_PLAY_PACKAGE_NAME,
        productId: GOOGLE_PLAY_PRODUCER_PRODUCT_ID,
        purchaseToken,
        purchaseTokenHash: purchaseRecordId,
        ...summary,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );
  });

  if (
    summary.active &&
    summary.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING"
  ) {
    await acknowledgeGooglePlaySubscription(
      purchaseToken,
      GOOGLE_PLAY_PRODUCER_PRODUCT_ID
    );
    await purchaseRef.set(
      {
        acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
        acknowledgedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  const userRef = db.collection("users").doc(uid);
  await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "User profile missing");
    }
    const currentSubscription = userSnapshot.get("subscription") || {};
    if (
      !summary.active &&
      !(
        currentSubscription.provider === "google_play" &&
        currentSubscription.purchaseTokenHash === purchaseRecordId
      )
    ) {
      return;
    }
    transaction.set(
      userRef,
      {
        subscription: {
          status: summary.status,
          provider: "google_play",
          productId: GOOGLE_PLAY_PRODUCER_PRODUCT_ID,
          purchaseTokenHash: purchaseRecordId,
          currentPeriodEnd: summary.currentPeriodEnd,
          autoRenewing: summary.autoRenewing,
          subscriptionState: summary.subscriptionState,
          basePlanId: summary.basePlanId,
          latestOrderId: summary.latestOrderId,
        },
        subscriptionStatus: summary.status,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return summary;
}

exports.verifyGooglePlaySubscription = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

  const user = await getUserOrThrow(uid);
  assertRole(user, ["producer"]);
  if (
    user.producerTerms?.accepted !== true ||
    user.producerTerms?.version !== PRODUCER_TERMS_VERSION ||
    user.producerOnboarding?.completed !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Accept the current producer terms and finish setup before subscribing."
    );
  }

  try {
    return await syncGooglePlaySubscriptionForUser(
      uid,
      request.data?.purchaseToken
    );
  } catch (error) {
    console.error("verifyGooglePlaySubscription error:", {
      uid,
      message: error?.message || String(error),
      status: error?.response?.status || null,
    });
    throw error instanceof HttpsError
      ? error
      : new HttpsError(
          "failed-precondition",
          "Google Play could not verify this subscription. Please try again."
        );
  }
});

exports.refreshGooglePlaySubscription = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

  const user = await getUserOrThrow(uid);
  if (
    user.subscription?.provider !== "google_play" ||
    !user.subscription?.purchaseTokenHash
  ) {
    return { active: false, status: "none" };
  }
  const purchaseSnapshot = await db
    .collection("google_play_purchases")
    .doc(user.subscription.purchaseTokenHash)
    .get();
  if (!purchaseSnapshot.exists || purchaseSnapshot.get("uid") !== uid) {
    return { active: false, status: "none" };
  }

  try {
    return await syncGooglePlaySubscriptionForUser(
      uid,
      purchaseSnapshot.get("purchaseToken")
    );
  } catch (error) {
    console.error("refreshGooglePlaySubscription error:", {
      uid,
      message: error?.message || String(error),
      status: error?.response?.status || null,
    });
    throw new HttpsError(
      "unavailable",
      "Google Play could not refresh this subscription. Please try again."
    );
  }
});

exports.refreshGooglePlaySubscriptions = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/New_York",
    timeoutSeconds: 540,
  },
  async () => {
    const snapshot = await db.collection("google_play_purchases").get();
    for (const purchase of snapshot.docs) {
      const data = purchase.data();
      if (!data.uid || !data.purchaseToken || data.accountDeleted === true) continue;
      try {
        await syncGooglePlaySubscriptionForUser(data.uid, data.purchaseToken);
      } catch (error) {
        console.error("Scheduled Google Play subscription refresh failed:", {
          purchaseTokenHash: purchase.id,
          uid: data.uid,
          message: error?.message || String(error),
          status: error?.response?.status || null,
        });
      }
    }
  }
);

function assertRole(user, allowedRoles) {
  if (!allowedRoles.includes(user.role)) {
    throw new HttpsError("permission-denied", "Insufficient role");
  }
}

async function resolveProductsAndPricing(itemsInput) {
  let normalizedItems;
  try {
    normalizedItems = normalizeRequestedItems(itemsInput);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message);
  }

  const productRefs = normalizedItems.map((i) =>
    db.collection("products").doc(i.productId)
  );
  const productSnaps = await db.getAll(...productRefs);

  let subtotalCents = 0;
  let resolvedItems = normalizedItems.map((item, idx) => {
    const snap = productSnaps[idx];
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", "A product in your cart is no longer available.");
    }
    const p = snap.data() || {};
    const qty = item.qty;
    // Expired discounts revert to the regular price on the trusted server even
    // if a client has an older product snapshot in its cart.
    const priceCents = effectiveProductPriceCents(p);
    const quantityAvailable = Number(p.quantityAvailable);
    const producerId = (p.producerId || p.producerUid)
      ? String(p.producerId || p.producerUid)
      : "";
    if (!producerId) {
      throw new HttpsError(
        "failed-precondition",
        `${String(p.name || p.title || "This product")} is missing its producer.`
      );
    }
    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      throw new HttpsError(
        "failed-precondition",
        `${String(p.name || p.title || "This product")} has an invalid price.`
      );
    }
    if (
      p.inStock === false ||
      !Number.isInteger(quantityAvailable) ||
      quantityAvailable < qty
    ) {
      throw new HttpsError(
        "failed-precondition",
        `${String(p.name || p.title || "This product")} does not have enough stock.`
      );
    }
    const lineSubtotal = priceCents * qty;
    subtotalCents += lineSubtotal;
    return {
      productId: snap.id,
      name: String(p.name || p.title || "Item"),
      unit: String(p.unit || "each"),
      qty,
      priceCents,
      lineSubtotal,
      producerId,
      producerName: p.producerName ? String(p.producerName) : "",
      imageUrl: p.photoUrl || p.imageUrl || p.image || "",
    };
  });

  const producerIds = [...new Set(resolvedItems.map((item) => item.producerId))];
  const farmSnapshots = producerIds.length
    ? await db.getAll(...producerIds.map((producerId) => db.collection("farms").doc(producerId)))
    : [];
  const publicProducerDetails = new Map(
    farmSnapshots.map((snapshot) => {
      const farm = snapshot.exists ? snapshot.data() || {} : {};
      return [
        snapshot.id,
        {
          producerName: String(farm.farmName || farm.name || "").trim(),
          producerTown: [farm.city, farm.state].filter(Boolean).join(", "),
          producerPhone: String(farm.phone || "").trim(),
        },
      ];
    })
  );
  resolvedItems = resolvedItems.map((item) => ({
    ...item,
    ...(publicProducerDetails.get(item.producerId) || {}),
    producerName:
      publicProducerDetails.get(item.producerId)?.producerName || item.producerName,
  }));

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

async function reserveInventoryInTransaction(tx, resolvedItems) {
  const refs = resolvedItems.map((item) =>
    db.collection("products").doc(item.productId)
  );
  const snapshots = [];
  for (const ref of refs) snapshots.push(await tx.get(ref));

  snapshots.forEach((snapshot, index) => {
    const item = resolvedItems[index];
    if (!snapshot.exists) {
      throw new HttpsError("failed-precondition", `${item.name} is no longer available.`);
    }
    const product = snapshot.data() || {};
    const available = Number(product.quantityAvailable);
    if (
      product.inStock === false ||
      !Number.isInteger(available) ||
      available < item.qty
    ) {
      throw new HttpsError(
        "failed-precondition",
        `${item.name} does not have enough stock.`
      );
    }
    const remaining = available - item.qty;
    tx.update(snapshot.ref, {
      quantityAvailable: remaining,
      inStock: remaining > 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
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
      pickupPartnerId:
        fulfillmentMethod === "pickup"
          ? String(selection.pickupPartnerId || "").trim().slice(0, 128)
          : "",
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

async function validateProducerFulfillment(producerIds, perProducer, scheduledAtInput) {
  const ids = [...producerIds];
  const farmRefs = ids.map((id) => db.collection("farms").doc(id));
  const farmSnapshots = await db.getAll(...farmRefs);
  let canonicalScheduledAt = null;

  for (let index = 0; index < ids.length; index += 1) {
    const producerId = ids[index];
    const farm = farmSnapshots[index].exists ? farmSnapshots[index].data() || {} : {};
    const method = perProducer[producerId]?.fulfillmentMethod || "pickup";
    const pickupPartnerId = String(perProducer[producerId]?.pickupPartnerId || "");
    if (method === "delivery" && farm.deliveryAvailable !== true) {
      throw new HttpsError(
        "failed-precondition",
        `${String(farm.farmName || "A producer")} does not offer delivery.`
      );
    }
    let pickupPartner = null;
    if (method === "pickup" && pickupPartnerId) {
      if (pickupPartnerId === producerId) {
        throw new HttpsError("invalid-argument", "A producer cannot be their own pickup partner.");
      }
      const partnershipId = [producerId, pickupPartnerId].sort().join("__");
      const [partnershipSnapshot, partnerFarmSnapshot] = await Promise.all([
        db.collection("producerPartnerships").doc(partnershipId).get(),
        db.collection("farms").doc(pickupPartnerId).get(),
      ]);
      const partnership = partnershipSnapshot.exists ? partnershipSnapshot.data() || {} : {};
      const partnerFarm = partnerFarmSnapshot.exists ? partnerFarmSnapshot.data() || {} : {};
      if (
        partnership.status !== "accepted" ||
        partnership.pickupEnabled !== true ||
        !Array.isArray(partnership.memberIds) ||
        !partnership.memberIds.includes(producerId) ||
        !partnership.memberIds.includes(pickupPartnerId) ||
        partnerFarm.pickupAvailable === false
      ) {
        throw new HttpsError("failed-precondition", "The selected partner pickup location is no longer available.");
      }
      pickupPartner = {
        producerId: pickupPartnerId,
        farmName: String(partnerFarm.farmName || "Producer partner"),
        city: String(partnerFarm.city || ""),
        state: String(partnerFarm.state || "ME"),
        phone: String(partnerFarm.phone || ""),
        hours: String(partnerFarm.hours || ""),
      };
    } else if (method === "pickup" && farm.pickupAvailable === false) {
      throw new HttpsError(
        "failed-precondition",
        `${String(farm.farmName || "A producer")} does not offer pickup.`
      );
    }
    try {
      canonicalScheduledAt = validateScheduledAt(scheduledAtInput, method);
    } catch (error) {
      throw new HttpsError("invalid-argument", error.message);
    }
    perProducer[producerId] = {
      ...perProducer[producerId],
      scheduledAt: canonicalScheduledAt,
      pickupPartner,
      fulfillmentNotes:
        method === "delivery" ? String(farm.deliveryNotes || "").slice(0, 500) : "",
    };
  }

  return { perProducer, scheduledAt: canonicalScheduledAt };
}

async function getProducerPaymentRouting(producerIds) {
  const ids = [...producerIds];
  const farmRefs = ids.map((id) => db.collection("farms").doc(id));
  const userRefs = ids.map((id) => db.collection("users").doc(id));
  const [farmSnaps, userSnaps] = await Promise.all([
    db.getAll(...farmRefs),
    db.getAll(...userRefs),
  ]);

  const routing = {};
  let stripe = null;
  for (let index = 0; index < ids.length; index += 1) {
      const producerId = ids[index];
      const farm = farmSnaps[index].exists ? farmSnaps[index].data() || {} : {};
      const user = userSnaps[index].exists ? userSnaps[index].data() || {} : {};
      const accountId = user.stripeConnectAccountId || user.stripeAccountId || "";
      const optedIn =
        farm.acceptsStripePayments === true &&
        farm.paymentPreference === "stripe" &&
        String(accountId).startsWith("acct_");

      if (!optedIn) {
        routing[producerId] = { mode: "direct" };
        continue;
      }

      try {
        stripe ||= getStripe();
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
  }

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
  const nowMs = Date.now();
  const reservationExpiresAt = Timestamp.fromMillis(
    directOrderReservationExpiry(scheduledAt, nowMs)
  );
  const limits = rateLimitRefs(uid, nowMs);

  return db.runTransaction(async (tx) => {
    const [existing, hourlyLimit, dailyLimit] = await Promise.all([
      tx.get(intentRef),
      tx.get(limits.hourly),
      tx.get(limits.daily),
    ]);
    if (existing.exists) {
      const data = existing.data() || {};
      return { orderId: data.orderId, paymentMode: "direct" };
    }

    await reserveInventoryInTransaction(tx, resolvedItems);
    enforceOrderRateLimitInTransaction(
      tx,
      uid,
      { hourly: hourlyLimit, daily: dailyLimit },
      limits,
      nowMs
    );
    const producerStatuses = Object.fromEntries(
      producers.map((producer) => [
        producer.producerId,
        { status: "awaiting_payment" },
      ])
    );

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
      producerStatuses,
      inventoryReservationStatus: "held",
      reservationExpiresAt,
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
        reservationExpiresAt,
        totalCents: producer.subtotalCents || 0,
        fulfillment: {
          method: fulfillment.fulfillmentMethod || deliveryMethod,
          fulfillmentMethod: fulfillment.fulfillmentMethod || deliveryMethod,
          window: fulfillment.window || null,
          scheduledAt: scheduledAt || null,
          notes: notes || "",
          pickupPartner: fulfillment.pickupPartner || null,
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

async function releaseHeldOrderInventory(orderId, finalStatus = "cancelled") {
  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnapshot = await tx.get(orderRef);
    if (!orderSnapshot.exists) return false;
    const order = orderSnapshot.data() || {};
    if (order.inventoryReservationStatus !== "held") return false;

    const allItems = Array.isArray(order.itemsSnapshot) ? order.itemsSnapshot : [];
    const producerIds = Array.isArray(order.producers)
      ? order.producers
          .map((producer) => String(producer?.producerId || ""))
          .filter(Boolean)
      : [];
    const currentProducerStatuses = order.producerStatuses || {};
    const producerIdsToRelease =
      order.paymentMode === "direct"
        ? pendingDirectProducerIds(producerIds, currentProducerStatuses)
        : producerIds;
    const producerIdSet = new Set(producerIdsToRelease);
    const items =
      order.paymentMode === "direct"
        ? allItems.filter((item) => producerIdSet.has(String(item.producerId || "")))
        : allItems;
    const productRefs = items.map((item) =>
      db.collection("products").doc(String(item.productId))
    );
    const productSnapshots = [];
    for (const productRef of productRefs) {
      productSnapshots.push(await tx.get(productRef));
    }

    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const item = items[index];
      const current = Number(snapshot.get("quantityAvailable"));
      const restored = (Number.isInteger(current) ? current : 0) + Number(item.qty || 0);
      tx.update(snapshot.ref, {
        quantityAvailable: restored,
        inStock: restored > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    const producerStatuses = { ...currentProducerStatuses };
    if (order.paymentMode === "direct") {
      producerIdsToRelease.forEach((producerId) => {
        producerStatuses[producerId] = {
          status: "cancelled",
          updatedAt: FieldValue.serverTimestamp(),
        };
        tx.set(
          db.collection("producerOrders").doc(producerId).collection("orders").doc(orderId),
          {
            status: "cancelled",
            paymentStatus: "expired",
            inventoryReleasedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    }
    const directInventoryStatus =
      order.paymentMode === "direct"
        ? directOrderInventoryState(producerIds, producerStatuses)
        : "released";
    const directBuyerStatus =
      order.paymentMode === "direct"
        ? deriveBuyerOrderStatus(producerIds, producerStatuses, finalStatus)
        : finalStatus;
    const hasCommittedDirectSegments =
      order.paymentMode === "direct" && directInventoryStatus === "committed";
    tx.set(
      orderRef,
      {
        status: hasCommittedDirectSegments ? directBuyerStatus : finalStatus,
        paymentStatus: hasCommittedDirectSegments
          ? "partially_expired"
          : finalStatus === "expired"
            ? "expired"
            : "cancelled",
        ...(producerStatuses ? { producerStatuses } : {}),
        inventoryReservationStatus: directInventoryStatus,
        inventoryReleasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
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
// Legacy checkout entrypoint retained only to give outdated clients a safe,
// explicit upgrade error. All current clients use createCartCheckoutSessionV2.
// ---------------------------
exports.createCartCheckoutSession = onCall(
  {},
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    throw new HttpsError(
      "failed-precondition",
      "This retired checkout version is disabled. Refresh Maine Farm Market and try again."
    );
  }
);

// ---------------------------
// createCartCheckoutSessionV2 (server-authoritative pricing + idempotent)
// ---------------------------
exports.createCartCheckoutSessionV2 = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    try {
      const uid = request.auth?.uid;
      if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
      assertVerifiedAccount(request);

      const data = request.data || {};
      const idempotencyKey = String(data.idempotencyKey || "").trim();
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
        throw new HttpsError("invalid-argument", "A valid idempotency key is required.");
      }

      const itemsInput = Array.isArray(data.items) ? data.items : [];
      const perProducerInput = data.perProducer || {};

      const user = await getUserOrThrow(uid);
      assertRole(user, ["buyer"]);
      const acceptedBuyerAgreement =
        user.userAgreementAcceptedAt ||
        user.acceptedUserAgreementAt ||
        user.acceptedUserAgreement === true;
      if (!acceptedBuyerAgreement || user.buyerProfileComplete !== true) {
        throw new HttpsError(
          "failed-precondition",
          "Accept the buyer agreement and finish your Maine buyer profile before ordering."
        );
      }

      const cartRef = db.collection("carts").doc(uid);
      const cartSnap = await cartRef.get();
      const cartData = (cartSnap.exists ? cartSnap.data() : {}) || {};
      const cartVersion =
        typeof cartData.cartVersion === "number" && Number.isFinite(cartData.cartVersion)
          ? cartData.cartVersion
          : 0;

      const { resolvedItems, subtotalCents, processingFeeCents, totalCents, producers } =
        await resolveProductsAndPricing(itemsInput);

      const producerIdsFromItems = new Set(
        resolvedItems.map((it) => (it.producerId ? it.producerId : "unknown"))
      );
      if (producerIdsFromItems.has("unknown")) {
        throw new HttpsError(
          "failed-precondition",
          "Every cart item must belong to a producer."
        );
      }
      const perProducerDraft = buildPerProducerSnapshot(
        producerIdsFromItems,
        perProducerInput
      );
      const deliveryMethod =
        data.deliveryMethod === "delivery" ? "delivery" : "pickup";
      const fulfillmentResult = await validateProducerFulfillment(
        producerIdsFromItems,
        perProducerDraft,
        data.scheduledAt
      );
      const perProducer = fulfillmentResult.perProducer;
      const scheduledAt = fulfillmentResult.scheduledAt;
      const notes = String(data.notes || "").trim().slice(0, 2000);
      const paymentRouting = await getProducerPaymentRouting(producerIdsFromItems);
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

      const stripe = getStripe();
      const payoutDestinations = {};
      producerIdsFromItems.forEach((producerId) => {
        payoutDestinations[producerId] = paymentRouting[producerId].destination;
      });

      const intentId = `${uid}_${idempotencyKey}`;
      const intentRef = db.collection("checkout_intents").doc(intentId);
      const orderIntents = db.collection("order_intents");
      const orders = db.collection("orders");
      const nowMs = Date.now();
      // Stripe Checkout requires an expiry at least 30 minutes in the future.
      const TTL_MS = 30 * 60 * 1000;
      const RESERVATION_RELEASE_GRACE_MS = 15 * 60 * 1000;

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
        const reservationExpiresAt = Timestamp.fromMillis(
          nowMs + TTL_MS + RESERVATION_RELEASE_GRACE_MS
        );
        await reserveInventoryInTransaction(tx, resolvedItems);
        const producerStatuses = Object.fromEntries(
          producers.map((producer) => [
            producer.producerId,
            { status: "pending_payment" },
          ])
        );

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
            status: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
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
            paymentStatus: "pending",
            producerStatuses,
            inventoryReservationStatus: "held",
            reservationExpiresAt,
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
            expires_at: Math.floor((Date.now() + TTL_MS) / 1000),
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
            expires_at: Math.floor((Date.now() + TTL_MS) / 1000),
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

exports.cancelBuyerDirectOrder = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  assertVerifiedAccount(request);
  const orderId = String(request.data?.orderId || "").trim();
  if (!orderId || orderId.length > 128) {
    throw new HttpsError("invalid-argument", "A valid order ID is required.");
  }

  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnapshot = await tx.get(orderRef);
    if (!orderSnapshot.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnapshot.data() || {};
    if (order.buyerId !== uid) {
      throw new HttpsError("permission-denied", "This order does not belong to you.");
    }
    if (order.paymentMode !== "direct") {
      throw new HttpsError(
        "failed-precondition",
        "Paid card orders must be handled through the refund process."
      );
    }
    if (
      order.status === "cancelled" &&
      order.inventoryReservationStatus === "released"
    ) {
      return { orderId, status: "cancelled" };
    }
    if (!canBuyerCancelDirectOrder(order.producerStatuses)) {
      throw new HttpsError(
        "failed-precondition",
        "A producer has already accepted this order. Contact support if you need help."
      );
    }

    const allItems = Array.isArray(order.itemsSnapshot) ? order.itemsSnapshot : [];
    const producerIds = Array.isArray(order.producers)
      ? order.producers
          .map((producer) => String(producer?.producerId || ""))
          .filter(Boolean)
      : [];
    const producerIdsToRelease = pendingDirectProducerIds(
      producerIds,
      order.producerStatuses || {}
    );
    const producerIdSet = new Set(producerIdsToRelease);
    const items = allItems.filter((item) =>
      producerIdSet.has(String(item.producerId || ""))
    );
    const productRefs = items.map((item) =>
      db.collection("products").doc(String(item.productId || ""))
    );
    const productSnapshots = [];
    for (const productRef of productRefs) productSnapshots.push(await tx.get(productRef));

    if (["held", "committed"].includes(order.inventoryReservationStatus)) {
      productSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) return;
        const current = Number(snapshot.get("quantityAvailable"));
        const restored =
          (Number.isInteger(current) ? current : 0) + Number(items[index]?.qty || 0);
        tx.update(snapshot.ref, {
          quantityAvailable: restored,
          inStock: restored > 0,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    }

    const producerStatuses = Object.fromEntries(
      producerIds.map((producerId) => [
        producerId,
        { status: "cancelled", updatedAt: FieldValue.serverTimestamp() },
      ])
    );
    producerIds.forEach((producerId) => {
      tx.set(
        db.collection("producerOrders").doc(producerId).collection("orders").doc(orderId),
        {
          status: "cancelled",
          paymentStatus: "cancelled_by_buyer",
          inventoryReleasedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
    tx.set(
      orderRef,
      {
        status: "cancelled",
        paymentStatus: "cancelled_by_buyer",
        producerStatuses,
        inventoryReservationStatus: "released",
        inventoryReleasedAt: FieldValue.serverTimestamp(),
        cancelledBy: "buyer",
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { orderId, status: "cancelled" };
  });
});

exports.updateProducerOrderStatus = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

  const user = await getUserOrThrow(uid);
  assertRole(user, ["producer"]);
  const orderId = String(request.data?.orderId || "").trim();
  const requestedStatus = String(request.data?.status || "").trim().toLowerCase();
  if (!orderId || orderId.length > 128) {
    throw new HttpsError("invalid-argument", "A valid order ID is required.");
  }

  const mainOrderRef = db.collection("orders").doc(orderId);
  const producerOrderRef = db
    .collection("producerOrders")
    .doc(uid)
    .collection("orders")
    .doc(orderId);

  try {
    return await db.runTransaction(async (tx) => {
      const [mainSnapshot, producerSnapshot] = await Promise.all([
        tx.get(mainOrderRef),
        tx.get(producerOrderRef),
      ]);
      if (!mainSnapshot.exists || !producerSnapshot.exists) {
        throw new HttpsError("not-found", "Order not found.");
      }

      const mainOrder = mainSnapshot.data() || {};
      const producerOrder = producerSnapshot.data() || {};
      const producerIds = Array.isArray(mainOrder.producers)
        ? mainOrder.producers.map((producer) => String(producer.producerId || ""))
        : [];
      if (!producerIds.includes(uid)) {
        throw new HttpsError("permission-denied", "This order does not belong to you.");
      }

      let nextStatus;
      try {
        nextStatus = assertProducerStatusTransition(
          producerOrder.status,
          requestedStatus,
          producerOrder.paymentMode || mainOrder.paymentMode
        );
      } catch (error) {
        throw new HttpsError("failed-precondition", error.message);
      }

      const items =
        nextStatus === "cancelled" && producerOrder.paymentMode === "direct"
          ? Array.isArray(producerOrder.items)
            ? producerOrder.items
            : []
          : [];
      const productSnapshots = [];
      for (const item of items) {
        productSnapshots.push(
          await tx.get(db.collection("products").doc(String(item.productId)))
        );
      }

      if (nextStatus === "cancelled") {
        productSnapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) return;
          const current = Number(snapshot.get("quantityAvailable"));
          const restored =
            (Number.isInteger(current) ? current : 0) + Number(items[index].qty || 0);
          tx.update(snapshot.ref, {
            quantityAvailable: restored,
            inStock: restored > 0,
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      }

      const producerStatuses = {
        ...(mainOrder.producerStatuses || {}),
        [uid]: {
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
        },
      };
      const buyerStatus = deriveBuyerOrderStatus(
        producerIds,
        producerStatuses,
        mainOrder.status
      );
      const directInventoryStatus =
        producerOrder.paymentMode === "direct"
          ? directOrderInventoryState(producerIds, producerStatuses)
          : mainOrder.inventoryReservationStatus;

      tx.update(producerOrderRef, {
        status: nextStatus,
        ...(nextStatus === "cancelled"
          ? { inventoryReleasedAt: FieldValue.serverTimestamp() }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        mainOrderRef,
        {
          status: buyerStatus,
          producerStatuses,
          ...(directInventoryStatus
            ? { inventoryReservationStatus: directInventoryStatus }
            : {}),
          ...(directInventoryStatus === "committed" &&
          mainOrder.inventoryReservationStatus !== "committed"
            ? { inventoryCommittedAt: FieldValue.serverTimestamp() }
            : {}),
          ...(directInventoryStatus === "released"
            ? { inventoryReleasedAt: FieldValue.serverTimestamp() }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { orderId, producerStatus: nextStatus, orderStatus: buyerStatus };
    });
  } catch (error) {
    throw error instanceof HttpsError
      ? error
      : new HttpsError("internal", error.message || "Could not update order status.");
  }
});

exports.releaseExpiredCheckoutReservations = onSchedule(
  "every 15 minutes",
  async () => {
    const snapshot = await db
      .collection("orders")
      .where("inventoryReservationStatus", "==", "held")
      .where("reservationExpiresAt", "<=", Timestamp.now())
      .orderBy("reservationExpiresAt", "asc")
      .limit(200)
      .get();
    const nowMs = Date.now();
    for (const document of snapshot.docs) {
      const expiresAt = document.get("reservationExpiresAt");
      const expiresAtMs = expiresAt?.toMillis ? expiresAt.toMillis() : 0;
      if (expiresAtMs && expiresAtMs <= nowMs) {
        try {
          await releaseHeldOrderInventory(document.id, "expired");
        } catch (error) {
          console.error("Could not release expired inventory reservation", {
            orderId: document.id,
            message: error?.message || String(error),
          });
        }
      }
    }
    const expiredRateLimits = await db
      .collection("order_rate_limits")
      .where("expiresAt", "<=", Timestamp.now())
      .limit(500)
      .get();
    if (!expiredRateLimits.empty) {
      const batch = db.batch();
      expiredRateLimits.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
    for (const collectionName of ["report_rate_limits", "report_dedupes"]) {
      const expired = await db
        .collection(collectionName)
        .where("expiresAt", "<=", Timestamp.now())
        .limit(500)
        .get();
      if (!expired.empty) {
        const batch = db.batch();
        expired.docs.forEach((document) => batch.delete(document.ref));
        await batch.commit();
      }
    }
  }
);

exports.openOrderDispute = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  assertVerifiedAccount(request);
  const orderId = String(request.data?.orderId || "").trim();
  const reason = String(request.data?.reason || "").trim();
  if (!orderId || orderId.length > 128) {
    throw new HttpsError("invalid-argument", "A valid order ID is required.");
  }
  if (reason.length < 10 || reason.length > 2000) {
    throw new HttpsError(
      "invalid-argument",
      "Describe the order problem in 10 to 2,000 characters."
    );
  }

  const orderRef = db.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) throw new HttpsError("not-found", "Order not found.");
  const order = orderSnapshot.data() || {};
  const producerIds = Array.isArray(order.producers)
    ? order.producers.map((producer) => String(producer?.producerId || ""))
    : [];
  if (order.buyerId !== uid && !producerIds.includes(uid)) {
    throw new HttpsError("permission-denied", "This order does not belong to you.");
  }

  const disputeRef = db.collection("disputes").doc(`${orderId}_${uid}`);
  const existing = await disputeRef.get();
  if (existing.exists && existing.get("status") === "open") {
    await disputeRef.set(
      {
        reason,
        updateCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { disputeId: disputeRef.id, status: "open" };
  }
  await Promise.all([
    disputeRef.set(
      {
        orderId,
        openedByUid: uid,
        openedByRole: order.buyerId === uid ? "buyer" : "producer",
        reason,
        status: "open",
        reopenCount: FieldValue.increment(existing.exists ? 1 : 0),
        createdAt: existing.exists
          ? existing.get("createdAt") || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    orderRef.set(
      {
        disputeStatus: "open",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    order.buyerId !== uid
      ? db
          .collection("producerOrders")
          .doc(uid)
          .collection("orders")
          .doc(orderId)
          .set(
            { disputeStatus: "open", updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          )
      : Promise.resolve(),
  ]);
  return { disputeId: disputeRef.id, status: "open" };
});

exports.submitListingReport = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");
  assertVerifiedAccount(request);

  const listingId = String(request.data?.listingId || "").trim();
  if (!listingId || listingId.length > 128) {
    throw new HttpsError("invalid-argument", "A valid listing is required.");
  }

  let reason;
  try {
    reason = normalizeListingReportReason(request.data?.reason);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message);
  }

  const nowMs = Date.now();
  const listingRef = db.collection("products").doc(listingId);
  const reportRef = db.collection("reports").doc();
  const limits = listingReportRateLimitRefs(uid, listingId, nowMs);

  return db.runTransaction(async (tx) => {
    const [listing, hourly, daily, duplicate] = await Promise.all([
      tx.get(listingRef),
      tx.get(limits.hourly),
      tx.get(limits.daily),
      tx.get(limits.duplicate),
    ]);
    if (!listing.exists) {
      throw new HttpsError("not-found", "This listing is no longer available.");
    }
    const listingData = listing.data() || {};
    const reportedUserId = String(
      listingData.producerId || listingData.producerUid || ""
    );
    if (!reportedUserId) {
      throw new HttpsError("failed-precondition", "This listing cannot be reported right now.");
    }
    if (reportedUserId === uid) {
      throw new HttpsError("failed-precondition", "You cannot report your own listing.");
    }

    enforceListingReportRateLimitInTransaction(
      tx,
      uid,
      { hourly, daily, duplicate },
      limits,
      nowMs
    );
    tx.create(reportRef, {
      reporterId: uid,
      type: "listing",
      listingId,
      reportedUserId,
      reason,
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(limits.duplicate, {
      reporterId: uid,
      listingId,
      reportId: reportRef.id,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(nowMs + 25 * 60 * 60 * 1000),
    });
    return { reportId: reportRef.id, status: "open" };
  });
});

function serializeAdminDocument(document) {
  const data = document.data() || {};
  const serialized = {};
  Object.entries(data).forEach(([key, value]) => {
    serialized[key] = value?.toMillis ? value.toMillis() : value;
  });
  return { id: document.id, ...serialized };
}

exports.getAdminDashboard = onCall(async (request) => {
  assertAdmin(request);
  const [reportsSnapshot, disputesSnapshot, ordersSnapshot] = await Promise.all([
    db.collection("reports").orderBy("createdAt", "desc").limit(50).get(),
    db.collection("disputes").orderBy("updatedAt", "desc").limit(50).get(),
    db.collection("orders").orderBy("createdAt", "desc").limit(50).get(),
  ]);
  return {
    reports: reportsSnapshot.docs.map(serializeAdminDocument),
    disputes: disputesSnapshot.docs.map(serializeAdminDocument),
    orders: ordersSnapshot.docs.map((document) => {
      const order = serializeAdminDocument(document);
      const missingLegacyFields = ["status", "paymentMode", "paymentStatus"].filter(
        (field) => !order[field] || String(order[field]).toLowerCase() === "unknown"
      );
      return {
        id: order.id,
        status: order.status || null,
        paymentMode: order.paymentMode || null,
        paymentStatus: order.paymentStatus || null,
        missingLegacyFields,
        disputeStatus: order.disputeStatus || null,
        totalCents: Number(order.pricing?.totalCents || order.totalCents || 0),
        refundedCents: Number(order.refund?.refundedCents || 0),
        createdAt: order.createdAt || null,
      };
    }),
  };
});

exports.resolveAdminReport = onCall(async (request) => {
  const adminEmail = assertAdmin(request);
  const reportId = String(request.data?.reportId || "").trim();
  const status = String(request.data?.status || "").trim().toLowerCase();
  const resolution = String(request.data?.resolution || "").trim().slice(0, 2000);
  if (!reportId || !["resolved", "dismissed"].includes(status)) {
    throw new HttpsError("invalid-argument", "Choose a valid report resolution.");
  }
  await db.collection("reports").doc(reportId).set(
    {
      status,
      resolution,
      reviewedBy: adminEmail,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { reportId, status };
});

exports.resolveAdminDispute = onCall(async (request) => {
  const adminEmail = assertAdmin(request);
  const disputeId = String(request.data?.disputeId || "").trim();
  const status = String(request.data?.status || "").trim().toLowerCase();
  const resolution = String(request.data?.resolution || "").trim();
  if (!disputeId || !["resolved", "dismissed"].includes(status)) {
    throw new HttpsError("invalid-argument", "Choose a valid dispute resolution.");
  }
  if (resolution.length < 3 || resolution.length > 2000) {
    throw new HttpsError("invalid-argument", "Enter a brief resolution note.");
  }
  const disputeRef = db.collection("disputes").doc(disputeId);
  const snapshot = await disputeRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Dispute not found.");
  const orderId = String(snapshot.get("orderId") || "");
  await Promise.all([
    disputeRef.set(
      {
        status,
        resolution,
        reviewedBy: adminEmail,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    orderId
      ? db.collection("orders").doc(orderId).set(
          {
            disputeStatus: status,
            disputeResolution: resolution,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      : Promise.resolve(),
  ]);
  return { disputeId, status };
});

async function reconcileCanceledStripeProducerSubscriptions() {
  const stripe = getStripe();
  const producerSnapshot = await db.collection("users").where("role", "==", "producer").get();
  let inspected = 0;
  let updated = 0;
  for (const producer of producerSnapshot.docs) {
    const profile = producer.data() || {};
    const subscription = profile.subscription || {};
    const subscriptionId = String(
      subscription.stripeSubscriptionId || profile.stripeSubscriptionId || ""
    ).trim();
    if (!subscriptionId) continue;
    inspected += 1;
    try {
      const remote = await stripe.subscriptions.retrieve(subscriptionId);
      const canonicalStatus = String(remote.status || "canceled");
      const legacyStatus = ["active", "trialing"].includes(canonicalStatus)
        ? "active"
        : "inactive";
      if (
        subscription.status !== canonicalStatus ||
        subscription.provider !== "stripe" ||
        profile.subscriptionStatus !== legacyStatus
      ) {
        await producer.ref.set(
          {
            subscription: {
              ...subscription,
              provider: "stripe",
              status: canonicalStatus,
              stripeSubscriptionId: subscriptionId,
              currentPeriodEnd: Number(remote.current_period_end || 0) * 1000,
              cancelAtPeriodEnd: remote.cancel_at_period_end === true,
              reconciledAt: FieldValue.serverTimestamp(),
            },
            subscriptionStatus: legacyStatus,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        updated += 1;
      }
    } catch (error) {
      if (error?.code === "resource_missing") {
        await producer.ref.set(
          {
            subscription: {
              ...subscription,
              provider: "stripe",
              status: "canceled",
              stripeSubscriptionId: subscriptionId,
              reconciledAt: FieldValue.serverTimestamp(),
            },
            subscriptionStatus: "inactive",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        updated += 1;
        continue;
      }
      console.error("Could not reconcile producer Stripe subscription", {
        uid: producer.id,
        message: error?.message || String(error),
      });
    }
  }
  return { inspected, updated };
}

exports.reconcileProducerSubscriptions = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    assertAdmin(request);
    return reconcileCanceledStripeProducerSubscriptions();
  }
);

exports.reconcileProducerSubscriptionsScheduled = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/New_York",
    timeoutSeconds: 540,
    secrets: [STRIPE_SECRET_KEY],
  },
  reconcileCanceledStripeProducerSubscriptions
);

async function finalizeMarketplaceRefund(orderId, refund, amountCents, fullRefund) {
  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnapshot = await tx.get(orderRef);
    if (!orderSnapshot.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnapshot.data() || {};
    const appliedRefundIds = Array.isArray(order.refund?.appliedRefundIds)
      ? order.refund.appliedRefundIds.map(String)
      : [];
    if (appliedRefundIds.includes(refund.id)) {
      return {
        alreadyApplied: true,
        inventoryRestored: order.refund?.inventoryRestored === true,
      };
    }
    const producerStatuses = Object.values(order.producerStatuses || {}).map(
      (entry) => String(entry?.status || "").toLowerCase()
    );
    const shouldRestoreInventory =
      fullRefund &&
      order.inventoryReservationStatus === "committed" &&
      order.status !== "completed" &&
      !producerStatuses.includes("completed");
    const items =
      shouldRestoreInventory
        ? Array.isArray(order.itemsSnapshot)
          ? order.itemsSnapshot
          : []
        : [];
    const productSnapshots = [];
    for (const item of items) {
      productSnapshots.push(
        await tx.get(db.collection("products").doc(String(item.productId || "")))
      );
    }
    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const current = Number(snapshot.get("quantityAvailable"));
      const restored =
        (Number.isInteger(current) ? current : 0) + Number(items[index]?.qty || 0);
      tx.update(snapshot.ref, {
        quantityAvailable: restored,
        inStock: restored > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    const previousRefunded = Number(order.refund?.refundedCents || 0);
    const producers = Array.isArray(order.producers) ? order.producers : [];
    producers.forEach((producer) => {
      const producerId = String(producer?.producerId || "");
      if (!producerId) return;
      tx.set(
        db.collection("producerOrders").doc(producerId).collection("orders").doc(orderId),
        {
          ...(fullRefund ? { status: "refunded" } : {}),
          paymentStatus: fullRefund ? "refunded" : "partially_refunded",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
    tx.set(
      orderRef,
      {
        ...(fullRefund ? { status: "refunded" } : {}),
        ...(shouldRestoreInventory ? { inventoryReservationStatus: "released" } : {}),
        paymentStatus: fullRefund ? "refunded" : "partially_refunded",
        refund: {
          refundedCents: previousRefunded + amountCents,
          latestRefundId: refund.id,
          appliedRefundIds: [...appliedRefundIds, refund.id].slice(-100),
          status: refund.status || "pending",
          inventoryRestored: shouldRestoreInventory,
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      alreadyApplied: false,
      inventoryRestored: shouldRestoreInventory && items.length > 0,
    };
  });
}

async function applySucceededMarketplaceRefund(stripe, orderId, refund, reviewedBy) {
  const orderSnapshot = await db.collection("orders").doc(orderId).get();
  if (!orderSnapshot.exists) throw new HttpsError("not-found", "Order not found.");
  const order = orderSnapshot.data() || {};
  const amountCents = Number(refund.amount || 0);
  const totalCents = Number(order.pricing?.totalCents || order.totalCents || 0);
  const alreadyRefunded = Number(order.refund?.refundedCents || 0);
  const allocations = allocateRefundAcrossTransfers(
    order.stripeTransfers,
    amountCents,
    totalCents
  );
  const reversals = [];
  for (const allocation of allocations) {
    if (!allocation.reversalAmountCents) continue;
    const reversal = await stripe.transfers.createReversal(
      allocation.transferId,
      {
        amount: allocation.reversalAmountCents,
        metadata: { orderId, refundId: refund.id },
      },
      { idempotencyKey: `refund_${refund.id}_${allocation.transferId}` }
    );
    reversals.push({
      transferId: allocation.transferId,
      reversalId: reversal.id,
      amountCents: allocation.reversalAmountCents,
    });
  }
  const fullRefund = alreadyRefunded + amountCents >= totalCents;
  const finalized = await finalizeMarketplaceRefund(
    orderId,
    refund,
    amountCents,
    fullRefund
  );
  await db.collection("refunds").doc(refund.id).set(
    {
      orderId,
      amountCents,
      fullRefund,
      stripeRefundId: refund.id,
      status: refund.status,
      reversals,
      reviewedBy,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return {
    orderId,
    refundId: refund.id,
    amountCents,
    fullRefund,
    status: refund.status,
    inventoryRestored: finalized.inventoryRestored,
  };
}

exports.refundMarketplaceOrder = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const adminEmail = assertAdmin(request);
    const orderId = String(request.data?.orderId || "").trim();
    const requestId = String(request.data?.requestId || "").trim();
    if (!orderId || !requestId || requestId.length > 128) {
      throw new HttpsError("invalid-argument", "Order and refund request IDs are required.");
    }
    const refundRequestId = createHash("sha256")
      .update(`${orderId}\n${requestId}`)
      .digest("hex");
    const refundRequestRef = db.collection("refund_requests").doc(refundRequestId);
    const existingRequest = await refundRequestRef.get();
    if (existingRequest.exists && existingRequest.get("status") === "completed") {
      return existingRequest.get("result");
    }
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnapshot.data() || {};
    if (order.paymentMode !== "stripe" || order.paymentStatus === "pending") {
      throw new HttpsError("failed-precondition", "Only paid Stripe orders can be refunded.");
    }
    const totalCents = Number(order.pricing?.totalCents || order.totalCents || 0);
    const alreadyRefunded = Number(order.refund?.refundedCents || 0);
    const remaining = Math.max(0, totalCents - alreadyRefunded);
    const resumedAmount = Number(
      existingRequest.exists ? existingRequest.get("amountCents") || 0 : 0
    );
    const requestedAmount = resumedAmount || Number(request.data?.amountCents || remaining);
    if (
      !Number.isInteger(requestedAmount) ||
      requestedAmount < 1 ||
      (!existingRequest.exists && requestedAmount > remaining)
    ) {
      throw new HttpsError("invalid-argument", "Enter a refund amount within the remaining total.");
    }
    const paymentIntentId = String(
      order.stripe?.paymentIntentId || order.stripePaymentIntent || ""
    );
    if (!paymentIntentId.startsWith("pi_")) {
      throw new HttpsError("failed-precondition", "The Stripe payment reference is missing.");
    }

    await refundRequestRef.set(
      {
        orderId,
        amountCents: requestedAmount,
        status: "processing",
        reviewedBy: adminEmail,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existingRequest.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    const stripe = getStripe();
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: requestedAmount,
        metadata: { orderId, reviewedBy: adminEmail, refundRequestId },
      },
      { idempotencyKey: `admin_refund_${refundRequestId}` }
    );
    if (refund.status !== "succeeded") {
      const result = {
        orderId,
        refundId: refund.id,
        amountCents: requestedAmount,
        fullRefund: false,
        status: refund.status || "pending",
        inventoryRestored: false,
      };
      await Promise.all([
        db.collection("refunds").doc(refund.id).set(
          {
            orderId,
            amountCents: requestedAmount,
            stripeRefundId: refund.id,
            status: refund.status || "pending",
            reviewedBy: adminEmail,
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
        refundRequestRef.set(
          {
            status: refund.status || "pending",
            result,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
      ]);
      return result;
    }
    const result = await applySucceededMarketplaceRefund(
      stripe,
      orderId,
      refund,
      adminEmail
    );
    await refundRequestRef.set(
      {
        status: "completed",
        result,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return result;
  }
);

async function deleteMatchingDocuments(query) {
  while (true) {
    const snapshot = await query.limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    if (snapshot.size < 400) return;
  }
}

async function recursiveDeleteMatchingDocuments(query) {
  const snapshot = await query.get();
  await Promise.all(snapshot.docs.map((document) => db.recursiveDelete(document.ref)));
}

async function anonymizeMatchingDocuments(query) {
  while (true) {
    const snapshot = await query.limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => {
      batch.update(document.ref, {
        buyerId: FieldValue.delete(),
        buyerUid: FieldValue.delete(),
        buyerName: "Deleted user",
        buyerEmail: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    if (snapshot.size < 400) return;
  }
}

// Permanently removes a signed-in account while retaining only transaction,
// safety, tax, and legal records that may still be required.
exports.deleteMyAccount = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

    const userRef = db.collection("users").doc(uid);
    const userSnapshot = await userRef.get();
    const user = userSnapshot.exists ? userSnapshot.data() || {} : {};
    let googlePlaySubscriptionCanceled = false;
    const deletionRecordRef = db
      .collection("account_deletion_records")
      .doc(accountDeletionRecordId(uid));

    try {
      await deletionRecordRef.set(
        {
          requestedAt: FieldValue.serverTimestamp(),
          status: "pending",
          role: user.role || null,
          retentionPolicy: "transaction-safety-tax-legal-up-to-7-years",
        },
        { merge: true }
      );

      if (user.stripeCustomerId) {
        const stripe = getStripe();
        const subscriptions = await stripe.subscriptions.list({
          customer: user.stripeCustomerId,
          status: "all",
          limit: 100,
        });
        for (const subscription of subscriptions.data) {
          if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
            await stripe.subscriptions.cancel(subscription.id);
          }
        }
      }

      if (
        user.subscription?.provider === "google_play" &&
        user.subscription?.purchaseTokenHash
      ) {
        const purchaseRef = db
          .collection("google_play_purchases")
          .doc(user.subscription.purchaseTokenHash);
        const purchaseSnapshot = await purchaseRef.get();
        const purchaseToken = purchaseSnapshot.get("purchaseToken");
        if (purchaseSnapshot.exists && purchaseToken) {
          await cancelGooglePlaySubscription(purchaseToken);
          googlePlaySubscriptionCanceled = true;
          await purchaseRef.set(
            {
              accountDeleted: true,
              canceledForAccountDeletionAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      await Promise.all([
        anonymizeMatchingDocuments(
          db.collection("orders").where("buyerId", "==", uid)
        ),
        anonymizeMatchingDocuments(
          db.collectionGroup("orders").where("buyerId", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collection("products").where("producerUid", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collection("products").where("producerId", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collectionGroup("blocked").where("blockedUserId", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collection("promotions").where("producerId", "==", uid)
        ),
        recursiveDeleteMatchingDocuments(
          db.collection("events").where("hostProducerId", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collectionGroup("attendees").where("producerId", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collection("producerRecommendations").where("producerId", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collection("producerRecommendations").where("recommendedProducerId", "==", uid)
        ),
        deleteMatchingDocuments(
          db.collection("producerPartnerships").where("memberIds", "array-contains", uid)
        ),
      ]);

      const reportSnapshot = await db
        .collection("reports")
        .where("reporterId", "==", uid)
        .get();
      if (!reportSnapshot.empty) {
        const reportBatch = db.batch();
        reportSnapshot.docs.forEach((report) => {
          reportBatch.update(report.ref, {
            reporterId: FieldValue.delete(),
            reporterDeleted: true,
          });
        });
        await reportBatch.commit();
      }

      await Promise.all([
        db.collection("carts").doc(uid).delete(),
        db.collection("farms").doc(uid).delete(),
        admin
          .storage()
          .bucket()
          .deleteFiles({ prefix: `products/${uid}/` })
          .catch((error) => {
            console.warn("Could not remove all listing images during account deletion", {
              uid,
              message: error?.message || String(error),
            });
          }),
        admin
          .storage()
          .bucket()
          .deleteFiles({ prefix: `producerProfiles/${uid}/` })
          .catch((error) => {
            console.warn("Could not remove producer profile images during account deletion", {
              uid,
              message: error?.message || String(error),
            });
          }),
      ]);

      await db.recursiveDelete(userRef);

      await deletionRecordRef.set(
        {
          deletedAt: FieldValue.serverTimestamp(),
          status: "completed",
          role: user.role || null,
          subscriptionCanceled:
            Boolean(user.stripeCustomerId) || googlePlaySubscriptionCanceled,
          retentionPolicy: "transaction-safety-tax-legal-up-to-7-years",
        },
        { merge: true }
      );

      try {
        await getAuth().deleteUser(uid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") throw error;
      }

      return { deleted: true };
    } catch (error) {
      console.error("deleteMyAccount error:", { uid, error });
      await deletionRecordRef
        .set(
          {
            status: "failed",
            failedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        .catch(() => undefined);
      throw error instanceof HttpsError
        ? error
        : new HttpsError(
            "internal",
            "Account deletion could not be completed. Please try again or contact support."
          );
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

// Returns the producer's optional Stripe Connect readiness without exposing
// account credentials or granting access. Keeping this function in source
// removes drift from the older deployed-only implementation.
exports.getProducerPayoutStatus = onCall(
  { secrets: [STRIPE_SECRET_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in first.");

    const producer = await getUserOrThrow(uid);
    assertRole(producer, ["producer"]);
    const accountId =
      producer.stripeConnectAccountId || producer.stripeAccountId || "";

    if (!String(accountId).startsWith("acct_")) {
      return {
        configured: false,
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        ready: false,
      };
    }

    try {
      const account = await getStripe().accounts.retrieve(accountId);
      const detailsSubmitted = account.details_submitted === true;
      const chargesEnabled = account.charges_enabled === true;
      const payoutsEnabled = account.payouts_enabled === true;
      return {
        configured: true,
        detailsSubmitted,
        chargesEnabled,
        payoutsEnabled,
        ready: detailsSubmitted && chargesEnabled && payoutsEnabled,
      };
    } catch (error) {
      console.error("getProducerPayoutStatus error:", {
        uid,
        message: error?.message || String(error),
      });
      throw new HttpsError(
        "unavailable",
        "Stripe payout status is temporarily unavailable."
      );
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

        if (
          type === "customer.subscription.updated" ||
          type === "customer.subscription.deleted"
        ) {
          await syncStripeSubscriptionRecord(event.data.object, type);
          return;
        }

        if (
          [
            "refund.created",
            "refund.updated",
            "refund.failed",
            "charge.refund.updated",
          ].includes(type)
        ) {
          const refund = event.data.object || {};
          const orderId = String(refund.metadata?.orderId || "");
          if (!orderId || !String(refund.id || "").startsWith("re_")) return;
          const reviewedBy = String(refund.metadata?.reviewedBy || "stripe_webhook");
          const refundRequestId = String(refund.metadata?.refundRequestId || "");
          await db.collection("refunds").doc(refund.id).set(
            {
              orderId,
              amountCents: Number(refund.amount || 0),
              stripeRefundId: refund.id,
              status: refund.status || "pending",
              failureReason: refund.failure_reason || null,
              reviewedBy,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          if (refund.status === "succeeded") {
            const result = await applySucceededMarketplaceRefund(
              stripe,
              orderId,
              refund,
              reviewedBy
            );
            if (refundRequestId) {
              await db.collection("refund_requests").doc(refundRequestId).set(
                {
                  status: "completed",
                  result,
                  completedAt: FieldValue.serverTimestamp(),
                  updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            }
          } else if (["failed", "canceled"].includes(refund.status)) {
            if (refundRequestId) {
              await db.collection("refund_requests").doc(refundRequestId).set(
                {
                  status: "failed",
                  failureReason: refund.failure_reason || "Refund failed",
                  updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            }
            await db.collection("orders").doc(orderId).set(
              {
                refund: {
                  latestRefundId: refund.id,
                  status: refund.status,
                  failureReason: refund.failure_reason || "Refund failed",
                  updatedAt: FieldValue.serverTimestamp(),
                },
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
          return;
        }

        if (type === "checkout.session.expired") {
          const session = event.data.object;
          const metadata = session.metadata || {};
          if (metadata.type === "order_checkout_v2" && metadata.orderId) {
            await releaseHeldOrderInventory(metadata.orderId, "expired");
          }
          return;
        }

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
                const producerStatuses = Object.fromEntries(
                  (Array.isArray(orderData.producers) ? orderData.producers : []).map(
                    (producer) => [
                      String(producer.producerId || ""),
                      { status: "paid", updatedAt: FieldValue.serverTimestamp() },
                    ]
                  )
                );
                tx.set(
                  orderRef,
                  {
                    status: "paid",
                    paymentStatus: "paid",
                    producerStatuses,
                    inventoryReservationStatus: "committed",
                    paidAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
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
                        pickupPartner: perProducerEntry.pickupPartner || null,
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
            if (await accountDeletionIsPendingOrComplete(uid)) {
              console.info("Ignoring subscription checkout for deleted account", { uid });
              return;
            }
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
                  provider: "stripe",
                  currentPeriodEnd: currentPeriodEndSec ? currentPeriodEndSec * 1000 : 0,
                  stripeSubscriptionId: subId || null,
                },
                subscriptionStatus: ["active", "trialing"].includes(status)
                  ? "active"
                  : "inactive",
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
