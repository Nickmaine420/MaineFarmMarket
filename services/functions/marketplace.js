"use strict";

const MAX_CART_ITEMS = 100;
const MAX_ITEM_QUANTITY = 999;
const PICKUP_MIN_LEAD_MS = 60 * 60 * 1000;
const DELIVERY_MIN_LEAD_MS = 24 * 60 * 60 * 1000;
const DIRECT_ORDER_MAX_HOLD_MS = 24 * 60 * 60 * 1000;
const DIRECT_ORDER_MIN_HOLD_MS = 30 * 60 * 1000;
const DIRECT_ORDER_SCHEDULE_BUFFER_MS = 30 * 60 * 1000;

function buildGooglePlayProducerMonthlyBasePlan(price) {
  const currencyCode = String(price?.currencyCode || "").trim().toUpperCase();
  const units = String(price?.units ?? "").trim();
  const nanos = Number(price?.nanos || 0);
  if (
    currencyCode !== "USD" ||
    !/^\d+$/.test(units) ||
    !Number.isInteger(nanos) ||
    nanos < 0 ||
    nanos >= 1_000_000_000
  ) {
    throw new Error("Google Play returned an invalid United States price.");
  }

  return {
    basePlanId: "monthly",
    regionalConfigs: [
      {
        regionCode: "US",
        newSubscriberAvailability: true,
        price: { currencyCode, units, nanos },
      },
    ],
    offerTags: [],
    autoRenewingBasePlanType: {
      billingPeriodDuration: "P1M",
      gracePeriodDuration: "P7D",
      accountHoldDuration: "P53D",
      resubscribeState: "RESUBSCRIBE_STATE_ACTIVE",
      prorationMode: "SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE",
      legacyCompatible: true,
    },
  };
}

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

function canBuyerCancelDirectOrder(producerStatuses) {
  const statuses = Object.values(producerStatuses || {})
    .map((entry) => String(entry?.status || "").toLowerCase())
    .filter(Boolean);
  if (!statuses.length) return true;
  return statuses.every((status) =>
    ["awaiting_payment", "pending", "pending_payment", "new", "cancelled"].includes(
      status
    )
  );
}

function directProducerStatus(value) {
  return String(value?.status || value || "awaiting_payment").toLowerCase();
}

function directOrderInventoryState(producerIds, producerStatuses) {
  const statuses = producerIds.map((producerId) =>
    directProducerStatus(producerStatuses?.[producerId])
  );
  if (
    statuses.some((status) =>
      ["awaiting_payment", "pending", "pending_payment", "new"].includes(status)
    )
  ) {
    return "held";
  }
  if (statuses.some((status) => ["accepted", "ready", "completed"].includes(status))) {
    return "committed";
  }
  return "released";
}

function pendingDirectProducerIds(producerIds, producerStatuses) {
  return producerIds.filter((producerId) =>
    ["awaiting_payment", "pending", "pending_payment", "new"].includes(
      directProducerStatus(producerStatuses?.[producerId])
    )
  );
}

function directOrderReservationExpiry(scheduledAt, nowMs = Date.now()) {
  const maximum = nowMs + DIRECT_ORDER_MAX_HOLD_MS;
  const scheduledMs = Date.parse(String(scheduledAt || ""));
  const beforeFulfillment = Number.isFinite(scheduledMs)
    ? scheduledMs - DIRECT_ORDER_SCHEDULE_BUFFER_MS
    : maximum;
  return Math.max(
    nowMs + DIRECT_ORDER_MIN_HOLD_MS,
    Math.min(maximum, beforeFulfillment)
  );
}

function allocateRefundAcrossTransfers(transfers, refundAmountCents, orderTotalCents) {
  const normalized = (Array.isArray(transfers) ? transfers : [])
    .map((transfer) => ({
      ...transfer,
      amountCents: Math.max(0, Math.trunc(Number(transfer?.amountCents || 0))),
    }))
    .filter((transfer) => transfer.transferId && transfer.amountCents > 0);
  const refund = Math.max(0, Math.trunc(Number(refundAmountCents || 0)));
  const total = Math.max(0, Math.trunc(Number(orderTotalCents || 0)));
  if (!normalized.length || !refund || !total) return [];

  const ratio = Math.min(1, refund / total);
  let remaining = Math.min(
    normalized.reduce((sum, transfer) => sum + transfer.amountCents, 0),
    Math.round(normalized.reduce((sum, transfer) => sum + transfer.amountCents, 0) * ratio)
  );
  return normalized.map((transfer, index) => {
    const amountCents =
      index === normalized.length - 1
        ? remaining
        : Math.min(remaining, Math.round(transfer.amountCents * ratio));
    remaining -= amountCents;
    return { ...transfer, reversalAmountCents: amountCents };
  });
}

module.exports = {
  DIRECT_ORDER_MAX_HOLD_MS,
  DIRECT_ORDER_MIN_HOLD_MS,
  DELIVERY_MIN_LEAD_MS,
  MAX_CART_ITEMS,
  MAX_ITEM_QUANTITY,
  PICKUP_MIN_LEAD_MS,
  buildGooglePlayProducerMonthlyBasePlan,
  allocateRefundAcrossTransfers,
  assertProducerStatusTransition,
  canBuyerCancelDirectOrder,
  directOrderInventoryState,
  directOrderReservationExpiry,
  deriveBuyerOrderStatus,
  normalizeRequestedItems,
  pendingDirectProducerIds,
  validateScheduledAt,
};
