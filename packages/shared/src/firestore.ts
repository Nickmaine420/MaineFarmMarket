export const FIRESTORE_COLLECTIONS = {
  users: "users",
  farms: "farms",
  products: "products",
  carts: "carts",
  orders: "orders",
  producerOrders: "producerOrders",
  checkoutIntents: "checkout_intents",
  orderIntents: "order_intents",
  stripeEvents: "stripe_events",
  disputes: "disputes",
  refunds: "refunds",
  refundRequests: "refund_requests",
  orderRateLimits: "order_rate_limits",
  events: "events",
  promotions: "promotions",
  producerRecommendations: "producerRecommendations",
  producerPartnerships: "producerPartnerships",
} as const;

export const producerOrderPath = (producerId: string, orderId: string) =>
  `${FIRESTORE_COLLECTIONS.producerOrders}/${producerId}/orders/${orderId}`;

export const producerPartnershipId = (firstProducerId: string, secondProducerId: string) =>
  [firstProducerId, secondProducerId].sort().join("__");
