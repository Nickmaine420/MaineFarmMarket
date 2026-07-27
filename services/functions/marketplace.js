"use strict";

const MAX_CART_ITEMS = 100;
const MAX_ITEM_QUANTITY = 999;
const PICKUP_MIN_LEAD_MS = 60 * 60 * 1000;
const DELIVERY_MIN_LEAD_MS = 24 * 60 * 60 * 1000;

function normalizeRequestedItems(itemsInput) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new Error("Cart is empty.");
  }
  if (itemsInput.length > MAX_CART_ITEMS) {
    throw new Error(`A cart may contain at most ${MAX_CART_ITEMS} items.`);
  }

  const merged = new Map();
  for (const item of itemsInput) {
    const productId = String(item?.productId || item?.id || "").trim();
    if (!productId) throw new Error("Every cart item must have a product ID.");

    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QUANTITY) {
      throw new Error(
        `Quantity for ${productId} must be a whole number between 1 and ${MAX_ITEM_QUANTITY}.`
      );
    }
    const nextQty = (merged.get(productId) || 0) + qty;
    if (nextQty > MAX_ITEM_QUANTITY) {
      throw new Error(
        `Quantity for ${productId} must not exceed ${MAX_ITEM_QUANTITY}.`
      );
    }
    merged.set(productId, nextQty);
  }

  return [...merged.entries()].map(([productId, qty]) => ({ productId, qty }));
}

function validateScheduledAt(value, fulfillmentMethod, nowMs = Date.now()) {
  const scheduledAt = String(value || "").trim();
  const scheduledMs = Date.parse(scheduledAt);
  if (!scheduledAt || !Number.isFinite(scheduledMs)) {
    throw new Error("Choose a valid pickup or delivery date and time.");
  }
  const minimumLeadMs =
    fulfillmentMethod === "delivery" ? DELIVERY_MIN_LEAD_MS : PICKUP_MIN_LEAD_MS;
  if (scheduledMs < nowMs + minimumLeadMs) {
    throw new Error(
      fulfillmentMethod === "delivery"
        ? "Delivery must be scheduled at least 24 hours in advance."
        : "Pickup must be scheduled at least 1 hour in advance."
    );
  }
  return new Date(scheduledMs).toISOString();
}

function assertProducerStatusTransition(currentStatus, nextStatus, paymentMode) {
  const current = String(currentStatus || "").toLowerCase();
  const next = String(nextStatus || "").toLowerCase();
  const allowed = {
    awaiting_payment: ["accepted", "cancelled"],
    paid: ["accepted"],
    pending: ["accepted"],
    new: ["accepted"],
    accepted: ["ready", "cancelled"],
    ready: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  };
  if (!Object.prototype.hasOwnProperty.call(allowed, current)) {
    throw new Error(`Order status "${current || "unknown"}" cannot be changed.`);
  }
  if (!allowed[current].includes(next)) {
    throw new Error(`Order cannot move from ${current} to ${next}.`);
  }
  if (next === "cancelled" && paymentMode === "stripe") {
    throw new Error(
      "Paid card orders require a refund workflow before cancellation. Contact support."
    );
  }
  return next;
}

function deriveBuyerOrderStatus(producerIds, producerStatuses, fallbackStatus) {
  const statuses = producerIds
    .map((producerId) => producerStatuses?.[producerId]?.status)
    .filter(Boolean);
  if (!statuses.length) return fallbackStatus || "pending";
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.every((status) => ["completed", "cancelled"].includes(status))) {
    return "partially_completed";
  }
  if (statuses.some((status) => status === "ready")) return "ready";
  if (statuses.some((status) => status === "accepted")) return "accepted";
  return fallbackStatus || "pending";
}

module.exports = {
  DELIVERY_MIN_LEAD_MS,
  MAX_CART_ITEMS,
  MAX_ITEM_QUANTITY,
  PICKUP_MIN_LEAD_MS,
  assertProducerStatusTransition,
  deriveBuyerOrderStatus,
  normalizeRequestedItems,
  validateScheduledAt,
};
