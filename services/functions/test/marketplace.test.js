"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertProducerStatusTransition,
  deriveBuyerOrderStatus,
  normalizeRequestedItems,
  validateScheduledAt,
} = require("../marketplace");

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
