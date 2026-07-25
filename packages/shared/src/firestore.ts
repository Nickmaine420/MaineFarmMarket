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
} as const;

export const producerOrderPath = (producerId: string, orderId: string) =>
  `${FIRESTORE_COLLECTIONS.producerOrders}/${producerId}/orders/${orderId}`;

