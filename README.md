# Maine Farm Market

Maine Farm Market is a marketplace for Maine farmers, homesteaders, and producers to sell goods to local buyers.

This repository is intentionally separate from `CAC-USA`.

## Project layout

```text
apps/
  web/                 Existing React + Vite website
  mobile/              Capacitor Android application for Google Play
packages/
  shared/              Platform-neutral Firebase data contracts
services/
  functions/           Firebase Cloud Functions and Stripe operations
firebase/
  firestore.rules      Shared Firestore security rules
docs/                  Architecture and migration records
archive/               Retained legacy logs/configuration
backups/               Untouched original source archive
```

The website and future mobile app will use the same Firebase project, Authentication users, Firestore collections, Storage bucket, and Cloud Functions. Firestore snapshot listeners provide real-time updates between the clients.

## Current web app

```powershell
npm --prefix apps/web install
npm run web:dev
```

Create `apps/web/.env.local` from `apps/web/.env.example` when setting up a new machine. The recovered local environment file is present in this working copy but is ignored by Git.

## Firebase backend

```powershell
npm --prefix services/functions install
npm run functions:serve
```

Firebase deployment paths are configured from the repository root in `firebase.json`.

## Mobile app

The Android client lives at `apps/mobile/android`, uses application ID
`com.mainefarmmarket.app`, and packages the same React client as the website. Both
clients connect to the `mainefarmmarket` Firebase project and therefore share
authentication and Firestore data in real time.

```powershell
npm run mobile:sync
npm run mobile:bundle
```

Buyer access and ordering are free. Producer subscriptions use Google Play Billing in
the Android app and Stripe on the website. Both providers write verified entitlement
state through trusted Cloud Functions so the shared account works across both clients.
Product orders may use optional Stripe Connect only when every producer in the cart
has opted in and completed payout setup; otherwise buyers arrange payment directly
with the producers.

## Recovery

The complete original ZIP, including generated dependencies and historical files, is preserved under `backups/`. It is excluded from Git and must not be modified during normal development.
