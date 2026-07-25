# Architecture

## Runtime boundaries

```text
Web app ───────┐
               ├── Firebase Authentication
Android app ───┤
               ├── Cloud Firestore (real-time shared data)
               ├── Firebase Storage
               └── Cloud Functions ── Stripe
```

- `apps/web` contains the existing React/Vite website.
- `apps/mobile/android` contains the Capacitor Android client distributed through
  Google Play under `com.mainefarmmarket.app`.
- `services/functions` is the trusted server boundary for checkout, subscriptions, Stripe Connect, webhooks, and privileged writes.
- `packages/shared` contains platform-neutral contracts only.
- `firebase/firestore.rules` protects the same Firestore database used by both clients.

## Current Firestore collections

The recovered code references:

- `users`
- `farms`
- `products`
- `carts`
- `orders`
- `producerOrders/{producerId}/orders`
- `checkout_intents`
- `order_intents`
- `stripe_events`
- `direct_order_intents`

The website already uses Firestore snapshot listeners for products, carts, orders, and producer views. A mobile client connected to the same Firebase project can observe the same data in real time.

## Security boundary

Client applications may use Firebase's public client configuration. Stripe secret keys, webhook secrets, Firebase Admin credentials, and trusted pricing/order logic must stay in Cloud Functions or managed secret storage.

## Marketplace payments

Stripe continues to bill buyer and producer access subscriptions on the website.
Stripe Connect is optional for product sales. An order uses online Stripe checkout
only when every producer in that cart has opted in and has an active Connect account.
The backend transfers each producer's item subtotal to that producer. Otherwise, the
order is recorded without an online charge and the buyer arranges payment directly
with each producer.

## Google Play preparation

The Android app targets API 36 and uses a private upload key stored outside version
control. Its native subscription screen is consumption-only and does not launch
Stripe subscription enrollment.
