import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
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
});
