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

async function upsertAuthUser({ uid, email, displayName }) {
  try {
    await auth.updateUser(uid, { email, displayName, password });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await auth.createUser({ uid, email, displayName, password });
  }
}

async function main() {
  const producerUid = "emulator-producer";
  const buyerUid = "emulator-buyer";
  const testOrderId = "test-order-direct-001";
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
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
    buyerProfileComplete: true,
    buyerAddress: "1 Test Lane",
    buyerCity: "Waterville",
    buyerState: "ME",
    buyerZip: "04901",
    acceptedUserAgreement: true,
    acceptedUserAgreementAt: now,
    userAgreementAcceptedAt: now,
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
  batch.set(db.collection("products").doc("test-product-blueberries"), {
    title: "TEST PRODUCT — Maine Blueberries",
    description:
      "Emulator-only product for buyer and producer flow testing. Do not fulfill.",
    department: "Produce",
    category: "Fruit",
    tags: ["test", "blueberries"],
    unit: "pint",
    price: 5,
    priceCents: 500,
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
    inventoryReservationStatus: "committed",
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
    "Seeded emulator buyer, producer, farm, listing, cart, and direct-payment order."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
