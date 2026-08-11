"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allocateRefundAcrossTransfers,
  assertProducerStatusTransition,
  buildGooglePlayProducerMonthlyBasePlan,
  canBuyerCancelDirectOrder,
  directOrderInventoryState,
  directOrderReservationExpiry,
  deriveBuyerOrderStatus,
  normalizeRequestedItems,
  pendingDirectProducerIds,
  validateScheduledAt,
} = require("../marketplace");

test("Google Play producer plan is monthly, US-only, and $29.99 compatible", () => {
  const plan = buildGooglePlayProducerMonthlyBasePlan({
    currencyCode: "USD",
    units: "29",
    nanos: 990000000,
  });
  assert.equal(plan.basePlanId, "monthly");
  assert.deepEqual(plan.regionalConfigs, [
    {
      regionCode: "US",
      newSubscriberAvailability: true,
      price: { currencyCode: "USD", units: "29", nanos: 990000000 },
    },
  ]);
  assert.equal(plan.autoRenewingBasePlanType.billingPeriodDuration, "P1M");
  assert.equal(plan.autoRenewingBasePlanType.gracePeriodDuration, "P7D");
  assert.equal(plan.autoRenewingBasePlanType.accountHoldDuration, "P53D");
  assert.equal(
    plan.autoRenewingBasePlanType.resubscribeState,
    "RESUBSCRIBE_STATE_ACTIVE"
  );
});

test("Google Play producer plan rejects malformed regional prices", () => {
  assert.throws(
    () =>
      buildGooglePlayProducerMonthlyBasePlan({
        currencyCode: "EUR",
        units: "29",
        nanos: 990000000,
      }),
    /invalid United States price/
  );
});

test("cart quantities are whole, positive, bounded, and merged by product", () => {
  assert.deepEqual(
    normalizeRequestedItems([
      { productId: "tomatoes", qty: 2 },
      { productId: "tomatoes", qty: 3 },
      { productId: "eggs", qty: 1 },
    ]),
    [
      { productId: "tomatoes", qty: 5 },
      { productId: "eggs", qty: 1 },
    ]
  );
  assert.throws(
    () => normalizeRequestedItems([{ productId: "eggs", qty: 1.5 }]),
    /whole number/
  );
  assert.throws(
    () => normalizeRequestedItems([{ productId: "eggs", qty: 1000 }]),
    /whole number/
  );
});

test("pickup and delivery lead times are enforced", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  assert.equal(
    validateScheduledAt("2026-07-26T14:00:00.000Z", "pickup", now),
    "2026-07-26T14:00:00.000Z"
  );
  assert.throws(
    () => validateScheduledAt("2026-07-26T12:30:00.000Z", "pickup", now),
    /1 hour/
  );
  assert.throws(
    () => validateScheduledAt("2026-07-27T11:00:00.000Z", "delivery", now),
    /24 hours/
  );
});

test("producer order transitions follow the supported workflow", () => {
  assert.equal(assertProducerStatusTransition("paid", "accepted", "stripe"), "accepted");
  assert.equal(assertProducerStatusTransition("new", "accepted", "direct"), "accepted");
  assert.equal(assertProducerStatusTransition("accepted", "ready", "direct"), "ready");
  assert.throws(
    () => assertProducerStatusTransition("completed", "ready", "direct"),
    /cannot move/
  );
  assert.throws(
    () => assertProducerStatusTransition("ready", "cancelled", "stripe"),
    /refund workflow/
  );
});

test("buyer status summarizes all producer statuses", () => {
  const ids = ["farm-a", "farm-b"];
  assert.equal(
    deriveBuyerOrderStatus(
      ids,
      { "farm-a": { status: "accepted" }, "farm-b": { status: "ready" } },
      "paid"
    ),
    "ready"
  );
  assert.equal(
    deriveBuyerOrderStatus(
      ids,
      { "farm-a": { status: "completed" }, "farm-b": { status: "cancelled" } },
      "paid"
    ),
    "partially_completed"
  );
});

test("buyers may only cancel direct orders before a producer accepts", () => {
  assert.equal(
    canBuyerCancelDirectOrder({ p1: { status: "awaiting_payment" } }),
    true
  );
  assert.equal(
    canBuyerCancelDirectOrder({
      p1: { status: "awaiting_payment" },
      p2: { status: "cancelled" },
    }),
    true
  );
  assert.equal(canBuyerCancelDirectOrder({ p1: { status: "accepted" } }), false);
});

test("multi-producer inventory remains held only for unanswered segments", () => {
  const ids = ["p1", "p2", "p3"];
  const statuses = {
    p1: { status: "accepted" },
    p2: { status: "cancelled" },
    p3: { status: "awaiting_payment" },
  };
  assert.equal(directOrderInventoryState(ids, statuses), "held");
  assert.deepEqual(pendingDirectProducerIds(ids, statuses), ["p3"]);
  assert.equal(
    directOrderInventoryState(ids, {
      p1: { status: "accepted" },
      p2: { status: "cancelled" },
      p3: { status: "cancelled" },
    }),
    "committed"
  );
});

test("direct-order holds expire before fulfillment and never exceed 24 hours", () => {
  const now = Date.parse("2026-08-11T12:00:00.000Z");
  assert.equal(
    directOrderReservationExpiry("2026-08-11T14:00:00.000Z", now),
    Date.parse("2026-08-11T13:30:00.000Z")
  );
  assert.equal(
    directOrderReservationExpiry("2026-08-14T12:00:00.000Z", now),
    Date.parse("2026-08-12T12:00:00.000Z")
  );
});

test("partial refunds reverse producer transfers proportionally", () => {
  assert.deepEqual(
    allocateRefundAcrossTransfers(
      [
        { transferId: "tr_1", amountCents: 6000 },
        { transferId: "tr_2", amountCents: 3000 },
      ],
      5000,
      10000
    ).map(({ transferId, reversalAmountCents }) => ({ transferId, reversalAmountCents })),
    [
      { transferId: "tr_1", reversalAmountCents: 3000 },
      { transferId: "tr_2", reversalAmountCents: 1500 },
    ]
  );
});
