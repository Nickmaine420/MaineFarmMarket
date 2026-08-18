const MARKETPLACE_LABELS: Record<string, string> = {
  awaiting_payment: "Awaiting producer response",
  pending_payment: "Payment pending",
  pending: "Pending",
  new: "New",
  paid: "Paid",
  accepted: "Accepted",
  ready: "Ready for pickup or delivery",
  completed: "Completed",
  partially_completed: "Partially completed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  cancelled_by_buyer: "Cancelled by buyer",
  cancelled_by_producer: "Cancelled by producer",
  arrange_with_producer: "Arrange payment with producer",
  direct: "Pay producer directly",
  stripe: "Paid online",
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
  published: "Published",
  draft: "Draft",
  declined: "Declined",
};

export function formatMarketplaceLabel(
  value: unknown,
  fallback = "Not recorded"
): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "legacy") {
    return fallback;
  }
  if (MARKETPLACE_LABELS[normalized]) return MARKETPLACE_LABELS[normalized];
  return normalized
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
