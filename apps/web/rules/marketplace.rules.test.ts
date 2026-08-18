import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";

const projectId = "mainefarmmarket";
let environment: RulesTestEnvironment;

const producerProfile = {
  role: "producer",
  producerTerms: { accepted: true, version: "2026-07-25" },
  producerOnboarding: { completed: true },
  subscription: { status: "active", provider: "emulator" },
};

const validProduct = {
  title: "Test carrots",
  price: 4.5,
  priceCents: 450,
  quantityAvailable: 10,
  inStock: true,
  producerUid: "producer-1",
  producerId: "producer-1",
  ownerId: "producer-1",
};

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), "../../firebase/firestore.rules"), "utf8"),
    },
    storage: {
      rules: readFileSync(resolve(process.cwd(), "../../firebase/storage.rules"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users/producer-1"), producerProfile),
      setDoc(doc(database, "users/buyer-1"), {
        role: "buyer",
        buyerProfileComplete: true,
      }),
      setDoc(doc(database, "users/producer-inactive"), {
        ...producerProfile,
        subscription: { status: "inactive", provider: "emulator" },
      }),
      setDoc(doc(database, "users/producer-2"), producerProfile),
      setDoc(doc(database, "farms/producer-1"), {
        producerUid: "producer-1",
        farmName: "First Farm",
        city: "Waterville",
        state: "ME",
        zip: "04901",
        phone: "207-555-0101",
        pickupAvailable: true,
        deliveryAvailable: false,
      }),
      setDoc(doc(database, "farms/producer-2"), {
        producerUid: "producer-2",
        farmName: "Second Farm",
        city: "Augusta",
        state: "ME",
        zip: "04330",
        phone: "207-555-0102",
        pickupAvailable: true,
        deliveryAvailable: true,
      }),
    ]);
  });
});

afterAll(async () => {
  if (environment) await environment.cleanup();
});

describe("marketplace Firestore rules", () => {
  test("an active producer can create a correctly priced listing", async () => {
    const database = environment.authenticatedContext("producer-1").firestore();
    await assertSucceeds(setDoc(doc(database, "products/product-1"), validProduct));
  });

  test("a listing with mismatched dollar and cent prices is rejected", async () => {
    const database = environment.authenticatedContext("producer-1").firestore();
    await assertFails(
      setDoc(doc(database, "products/product-1"), {
        ...validProduct,
        priceCents: 999,
      })
    );
  });

  test("valid marketing discounts preserve a higher regular price", async () => {
    const database = environment.authenticatedContext("producer-1").firestore();
    await assertSucceeds(setDoc(doc(database, "products/discounted"), {
      ...validProduct,
      price: 3.6,
      priceCents: 360,
      originalPrice: 4.5,
      originalPriceCents: 450,
      discountLabel: "Harvest deal",
      discountEndsAt: Timestamp.fromDate(new Date(Date.now() + 86_400_000)),
    }));
    await assertFails(setDoc(doc(database, "products/fake-discount"), {
      ...validProduct,
      originalPrice: 4,
      originalPriceCents: 400,
    }));
  });

  test("an inactive producer cannot create a listing", async () => {
    const database = environment.authenticatedContext("producer-inactive").firestore();
    await assertFails(
      setDoc(doc(database, "products/inactive-product"), {
        ...validProduct,
        producerUid: "producer-inactive",
        producerId: "producer-inactive",
        ownerId: "producer-inactive",
      })
    );
  });

  test("members cannot grant themselves a legacy subscription status", async () => {
    const database = environment.authenticatedContext("buyer-1").firestore();
    await assertFails(
      setDoc(
        doc(database, "users/buyer-1"),
        { role: "buyer", subscriptionStatus: "active" },
        { merge: true }
      )
    );
  });

  test("buyers can read public farms but not private producer profiles", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "farms/producer-1"), {
        producerUid: "producer-1",
        farmName: "Test Farm",
      });
    });
    const database = environment.authenticatedContext("buyer-1").firestore();
    await assertSucceeds(getDoc(doc(database, "farms/producer-1")));
    await assertFails(getDoc(doc(database, "users/producer-1")));
  });

  test("listing reports must identify the listing's actual producer", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "products/product-1"), validProduct);
    });
    const database = environment.authenticatedContext("buyer-1").firestore();
    const report = {
      reporterId: "buyer-1",
      type: "listing",
      listingId: "product-1",
      reportedUserId: "producer-1",
      reason: "This listing needs a safety review.",
      status: "open",
      createdAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(database, "reports/valid"), report));
    await assertFails(
      setDoc(doc(database, "reports/spoofed"), {
        ...report,
        reportedUserId: "unrelated-user",
      })
    );
  });

  test("clients cannot create orders, disputes, refunds, or rate-limit records", async () => {
    const database = environment.authenticatedContext("buyer-1").firestore();
    await Promise.all([
      assertFails(setDoc(doc(database, "orders/fake"), { buyerId: "buyer-1" })),
      assertFails(setDoc(doc(database, "disputes/fake"), { orderId: "fake" })),
      assertFails(setDoc(doc(database, "refunds/fake"), { orderId: "fake" })),
      assertFails(setDoc(doc(database, "refund_requests/fake"), { orderId: "fake" })),
      assertFails(setDoc(doc(database, "order_rate_limits/fake"), { count: 0 })),
    ]);
  });

  test("producers control events and only producers can assign their own attendance", async () => {
    const producer = environment.authenticatedContext("producer-1").firestore();
    const secondProducer = environment.authenticatedContext("producer-2").firestore();
    const buyer = environment.authenticatedContext("buyer-1").firestore();
    const eventData = {
      hostProducerId: "producer-1",
      title: "Harvest market",
      description: "A community market.",
      venueName: "Town green",
      address: "1 Main Street",
      city: "Waterville",
      state: "ME",
      zip: "04901",
      lat: 44.55,
      lng: -69.63,
      categories: ["Produce"],
      startAt: Timestamp.fromDate(new Date(Date.now() + 86_400_000)),
      endAt: Timestamp.fromDate(new Date(Date.now() + 90_000_000)),
      status: "published",
    };
    await assertSucceeds(setDoc(doc(producer, "events/event-1"), eventData));
    await assertSucceeds(getDoc(doc(buyer, "events/event-1")));
    await assertFails(setDoc(doc(buyer, "events/fake"), { ...eventData, hostProducerId: "buyer-1" }));
    await assertFails(setDoc(doc(producer, "events/invalid-location"), { ...eventData, lat: 144.55 }));
    await assertSucceeds(setDoc(doc(secondProducer, "events/event-1/attendees/producer-2"), {
      producerId: "producer-2",
      farmName: "Second Farm",
    }));
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(buyer, "attendees"),
          where("producerId", "==", "producer-2")
        )
      )
    );
    await assertFails(setDoc(doc(producer, "events/event-1/attendees/producer-2"), {
      producerId: "producer-2",
      farmName: "Second Farm",
    }));
  });

  test("promotion and recommendation ownership cannot be spoofed", async () => {
    const producer = environment.authenticatedContext("producer-1").firestore();
    const buyer = environment.authenticatedContext("buyer-1").firestore();
    const promotion = {
      producerId: "producer-1",
      title: "Weekend deal",
      description: "Save on a seasonal box.",
      kind: "deal",
      startsAt: Timestamp.fromDate(new Date()),
      endsAt: Timestamp.fromDate(new Date(Date.now() + 86_400_000)),
      active: true,
    };
    await assertSucceeds(setDoc(doc(producer, "promotions/deal-1"), promotion));
    await assertSucceeds(getDoc(doc(buyer, "promotions/deal-1")));
    await assertSucceeds(updateDoc(doc(producer, "promotions/deal-1"), { active: false }));
    await assertFails(getDoc(doc(buyer, "promotions/deal-1")));
    await assertSucceeds(getDoc(doc(producer, "promotions/deal-1")));
    await assertFails(setDoc(doc(buyer, "promotions/fake"), { ...promotion, producerId: "buyer-1" }));
    await assertSucceeds(setDoc(doc(producer, "producerRecommendations/recommendation-1"), {
      producerId: "producer-1",
      recommendedProducerId: "producer-2",
      note: "A trusted neighbor.",
    }));
    await assertFails(setDoc(doc(producer, "producerRecommendations/self"), {
      producerId: "producer-1",
      recommendedProducerId: "producer-1",
      note: "Self endorsement",
    }));
  });

  test("partnerships require acceptance by the other producer", async () => {
    const producer = environment.authenticatedContext("producer-1").firestore();
    const secondProducer = environment.authenticatedContext("producer-2").firestore();
    const buyer = environment.authenticatedContext("buyer-1").firestore();
    const partnership = {
      memberIds: ["producer-1", "producer-2"],
      requestedBy: "producer-1",
      status: "pending",
      pickupEnabled: true,
      deliveryEnabled: false,
      publicNote: "Shared Saturday pickup.",
    };
    await assertSucceeds(setDoc(doc(producer, "producerPartnerships/producer-1__producer-2"), partnership));
    await assertFails(getDoc(doc(buyer, "producerPartnerships/producer-1__producer-2")));
    await assertFails(updateDoc(doc(producer, "producerPartnerships/producer-1__producer-2"), { status: "accepted" }));
    await assertSucceeds(updateDoc(doc(secondProducer, "producerPartnerships/producer-1__producer-2"), { status: "accepted" }));
    await assertSucceeds(getDoc(doc(buyer, "producerPartnerships/producer-1__producer-2")));
  });
});

describe("marketplace Storage rules", () => {
  test("buyers cannot upload product photos", async () => {
    const storage = environment.authenticatedContext("buyer-1").storage();
    await assertFails(
      uploadBytes(ref(storage, "products/buyer-1/photo.png"), new Uint8Array([1, 2, 3]), {
        contentType: "image/png",
      })
    );
  });

  test("active producers can upload supported product photos", async () => {
    const storage = environment.authenticatedContext("producer-1").storage();
    await assertSucceeds(
      uploadBytes(
        ref(storage, "products/producer-1/photo.png"),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/png" }
      )
    );
  });

  test("inactive producers cannot upload product photos", async () => {
    const storage = environment.authenticatedContext("producer-inactive").storage();
    await assertFails(
      uploadBytes(
        ref(storage, "products/producer-inactive/photo.png"),
        new Uint8Array([1, 2, 3]),
        { contentType: "image/png" }
      )
    );
  });

  test("active producers can upload public profile photos but buyers cannot", async () => {
    const producerStorage = environment.authenticatedContext("producer-1").storage();
    const buyerStorage = environment.authenticatedContext("buyer-1").storage();
    const bytes = new Uint8Array([1, 2, 3]);
    await assertSucceeds(uploadBytes(ref(producerStorage, "producerProfiles/producer-1/farm.png"), bytes, { contentType: "image/png" }));
    await assertFails(uploadBytes(ref(buyerStorage, "producerProfiles/buyer-1/farm.png"), bytes, { contentType: "image/png" }));
  });
});
