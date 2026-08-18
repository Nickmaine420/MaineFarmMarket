"use strict";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
    "Refusing to seed data unless both Firestore and Auth emulators are active."
  );
}

process.env.GCLOUD_PROJECT ||= "mainefarmmarket";

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp({ projectId: process.env.GCLOUD_PROJECT });

const db = getFirestore();
const auth = getAuth();
const now = Timestamp.now();
const password = "MfmEmulatorTest2026!";
const buyerIncomplete = process.argv.includes("--buyer-incomplete");

async function resetFirestoreEmulator() {
  const projectId = process.env.GCLOUD_PROJECT;
  const endpoint = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`;
  const response = await fetch(endpoint, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Could not reset the Firestore emulator (${response.status}).`);
  }
}

async function upsertAuthUser({ uid, email, displayName }) {
  try {
    await auth.updateUser(uid, { email, displayName, password, emailVerified: true });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await auth.createUser({ uid, email, displayName, password, emailVerified: true });
  }
}

async function main() {
  await resetFirestoreEmulator();

  const producerUid = "emulator-producer";
  const partnerProducerUid = "emulator-partner-producer";
  const buyerUid = "emulator-buyer";
  const testOrderId = "test-order-direct-001";
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const reservationExpiresAt = Timestamp.fromMillis(Date.now() + 90 * 60 * 1000);
  const testOrderItems = [
    {
      productId: "test-product-blueberries",
      name: "TEST PRODUCT — Maine Blueberries",
      title: "TEST PRODUCT — Maine Blueberries",
      unit: "pint",
      price: 5,
      priceCents: 500,
      qty: 1,
      lineSubtotal: 500,
      producerId: producerUid,
      producerName: "Test Pine Farm",
      producerTown: "Waterville, ME",
      producerPhone: "207-555-0100",
    },
  ];

  await Promise.all([
    upsertAuthUser({
      uid: producerUid,
      email: "producer-test@mainefarmmarket.local",
      displayName: "Test Pine Farm",
    }),
    upsertAuthUser({
      uid: partnerProducerUid,
      email: "partner-test@mainefarmmarket.local",
      displayName: "Test River Farm",
    }),
    upsertAuthUser({
      uid: buyerUid,
      email: "buyer-test@mainefarmmarket.local",
      displayName: "Test Maine Buyer",
    }),
  ]);

  const batch = db.batch();
  batch.set(db.collection("users").doc(producerUid), {
    role: "producer",
    displayName: "Test Pine Farm",
    email: "producer-test@mainefarmmarket.local",
    producerTerms: {
      accepted: true,
      version: "2026-07-25",
      acceptedAt: now,
      acceptedByUid: producerUid,
    },
    producerOnboarding: {
      completed: true,
      completedAt: now,
      paymentPreference: "direct",
    },
    subscription: {
      provider: "emulator",
      status: "active",
      testData: true,
    },
    updatedAt: now,
  });
  batch.set(db.collection("users").doc(buyerUid), {
    role: "buyer",
    displayName: "Test Maine Buyer",
    email: "buyer-test@mainefarmmarket.local",
    buyerProfileComplete: !buyerIncomplete,
    buyerAddress: buyerIncomplete ? "" : "1 Test Lane",
    buyerCity: buyerIncomplete ? "" : "Waterville",
    buyerState: "ME",
    buyerZip: buyerIncomplete ? "" : "04901",
    acceptedUserAgreement: true,
    acceptedUserAgreementAt: now,
    userAgreementAcceptedAt: now,
    updatedAt: now,
  });
  batch.set(db.collection("users").doc(partnerProducerUid), {
    role: "producer",
    displayName: "Test River Farm",
    email: "partner-test@mainefarmmarket.local",
    producerTerms: { accepted: true, version: "2026-07-25", acceptedAt: now },
    producerOnboarding: { completed: true, completedAt: now, paymentPreference: "direct" },
    subscription: { provider: "emulator", status: "active", testData: true },
    updatedAt: now,
  });
  batch.set(db.collection("farms").doc(producerUid), {
    producerUid,
    farmName: "Test Pine Farm",
    phone: "207-555-0100",
    city: "Waterville",
    state: "ME",
    zip: "04901",
    description: "Emulator-only farm used for Maine Farm Market testing.",
    promoPageEnabled: true,
    promoHeadline: "Test Pine seasonal specials",
    promoDescription: "Emulator-only promotion content.",
    photos: [],
    archivedPhotos: [],
    paymentPreference: "direct",
    acceptsStripePayments: false,
    pickupAvailable: true,
    deliveryAvailable: true,
    deliveryNotes: "Test delivery only. No real order will be fulfilled.",
    lat: 44.552,
    lng: -69.632,
    testData: true,
    updatedAt: now,
  });
  batch.set(db.collection("farms").doc(partnerProducerUid), {
    producerUid: partnerProducerUid,
    farmName: "Test River Farm",
    phone: "207-555-0102",
    city: "Augusta",
    state: "ME",
    zip: "04330",
    description: "Emulator-only partner producer.",
    pickupAvailable: true,
    deliveryAvailable: true,
    lat: 44.31,
    lng: -69.78,
    testData: true,
    updatedAt: now,
  });
  batch.set(db.collection("products").doc("test-product-blueberries"), {
    title: "TEST PRODUCT — Maine Blueberries",
    description:
      "Emulator-only product for buyer and producer flow testing. Do not fulfill.",
    department: "Produce",
    category: "Fruit",
    tags: ["test", "blueberries"],
    unit: "pint",
    price: 4,
    priceCents: 400,
    originalPrice: 5,
    originalPriceCents: 500,
    discountLabel: "TEST HARVEST DEAL",
    discountEndsAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
    quantityAvailable: 12,
    inStock: true,
    archived: false,
    producerUid,
    producerId: producerUid,
    ownerId: producerUid,
    producerName: "Test Pine Farm",
    producerTown: "Waterville, ME",
    producerPhone: "207-555-0100",
    imageUrl: "",
    testData: true,
    createdAt: now,
    updatedAt: now,
  });
  const eventStart = Timestamp.fromMillis(Date.now() + 2 * 86_400_000);
  const eventEnd = Timestamp.fromMillis(Date.now() + 2 * 86_400_000 + 3 * 60 * 60 * 1000);
  batch.set(db.collection("events").doc("test-harvest-event"), {
    hostProducerId: producerUid,
    title: "TEST EVENT — Harvest Market",
    description: "Emulator-only event for calendar and producer attendance testing.",
    venueName: "Test Town Green",
    address: "1 Test Square",
    city: "Waterville",
    state: "ME",
    zip: "04901",
    lat: 44.552,
    lng: -69.632,
    categories: ["Produce", "Honey"],
    startAt: eventStart,
    endAt: eventEnd,
    status: "published",
    testData: true,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(db.collection("events").doc("test-harvest-event").collection("attendees").doc(producerUid), {
    producerId: producerUid,
    farmName: "Test Pine Farm",
    joinedAt: now,
  });
  batch.set(db.collection("events").doc("test-harvest-event").collection("attendees").doc(partnerProducerUid), {
    producerId: partnerProducerUid,
    farmName: "Test River Farm",
    joinedAt: now,
  });
  batch.set(db.collection("promotions").doc("test-weekend-deal"), {
    producerId: producerUid,
    title: "TEST DEAL — Weekend farm box",
    description: "Emulator-only custom promotion.",
    kind: "deal",
    startsAt: Timestamp.fromMillis(Date.now() - 60_000),
    endsAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
    active: true,
    testData: true,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(db.collection("producerRecommendations").doc(`${producerUid}__${partnerProducerUid}`), {
    producerId: producerUid,
    recommendedProducerId: partnerProducerUid,
    note: "A trusted emulator test neighbor.",
    testData: true,
    createdAt: now,
  });
  batch.set(db.collection("producerPartnerships").doc(`${partnerProducerUid}__${producerUid}`), {
    memberIds: [partnerProducerUid, producerUid].sort(),
    requestedBy: producerUid,
    status: "accepted",
    pickupEnabled: true,
    deliveryEnabled: true,
    publicNote: "Emulator-only shared pickup and delivery support.",
    testData: true,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(db.collection("carts").doc(buyerUid), {
    items: [],
    cartVersion: 0,
    testData: true,
    updatedAt: now,
  });
  batch.set(db.collection("orders").doc(testOrderId), {
    buyerId: buyerUid,
    status: "awaiting_payment",
    paymentMode: "direct",
    paymentStatus: "arrange_with_producer",
    producerStatuses: {
      [producerUid]: { status: "awaiting_payment" },
    },
    inventoryReservationStatus: "held",
    reservationExpiresAt,
    itemsSnapshot: testOrderItems,
    pricing: {
      source: "emulator",
      currency: "usd",
      subtotalCents: 500,
      processingFeeCents: 0,
      totalCents: 500,
      computedAt: now,
    },
    producers: [{ producerId: producerUid, subtotalCents: 500 }],
    perProducer: {
      [producerUid]: {
        fulfillmentMethod: "pickup",
        scheduledAt,
        window: {
          id: "emulator-test",
          label: "Emulator test pickup",
          timezone: "America/New_York",
        },
      },
    },
    deliveryMethod: "pickup",
    scheduledAt,
    notes: "Emulator-only order. Do not fulfill.",
    testData: true,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(
    db
      .collection("producerOrders")
      .doc(producerUid)
      .collection("orders")
      .doc(testOrderId),
    {
      orderId: testOrderId,
      buyerId: buyerUid,
      buyerName: "Test Maine Buyer",
      buyerEmail: "buyer-test@mainefarmmarket.local",
      items: testOrderItems,
      status: "awaiting_payment",
      paymentMode: "direct",
      paymentStatus: "arrange_with_buyer",
      reservationExpiresAt,
      totalCents: 500,
      fulfillment: {
        method: "pickup",
        fulfillmentMethod: "pickup",
        scheduledAt,
        notes: "Emulator-only order. Do not fulfill.",
      },
      scheduledAt,
      notes: "Emulator-only order. Do not fulfill.",
      testData: true,
      createdAt: now,
    }
  );

  await batch.commit();
  console.log(
    `Seeded emulator ${buyerIncomplete ? "first-time " : ""}buyer, producer, farm, listing, cart, and direct-payment order.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
