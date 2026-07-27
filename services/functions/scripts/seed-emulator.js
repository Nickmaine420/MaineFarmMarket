"use strict";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
    "Refusing to seed data unless both Firestore and Auth emulators are active."
  );
}

process.env.GCLOUD_PROJECT ||= "maine-farm-market";

const admin = require("firebase-admin");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });

const db = admin.firestore();
const auth = admin.auth();
const now = admin.firestore.Timestamp.now();
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

  await batch.commit();
  console.log("Seeded emulator buyer, producer, farm, and direct-payment test product.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
