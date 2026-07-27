# Known issues

Recorded during project organization on 2026-07-25:

- The Google Play client has been generated under `apps/mobile/android`.
- Firebase Cloud Functions were migrated to Node.js 22, Firebase Functions 7.3.0,
  and Firebase Admin 14.2.0 on 2026-07-26. The full function set loads in the
  emulator and its unit tests pass.
- The web production bundle builds, but Vite reports a Firebase JavaScript chunk
  of roughly 567 kB before gzip. Route-level Firebase code splitting can be
  considered as a later performance improvement.
- The web dependency audit reports zero vulnerabilities. The current official
  Firebase Admin dependency tree reports 12 transitive advisories in Google
  Storage/Firestore support packages. No critical findings remain; incompatible
  forced overrides were not applied.
- Several feature pages still define local product and order types. Reconcile those definitions with production Firestore documents before making `packages/shared` authoritative.
- Buyer access is free. The retired buyer subscription price and product are disabled.
  No renewable buyer subscriptions remained in Stripe; both legacy tester records were
  marked canceled in Firestore without refunds on 2026-07-25.
- Two producer documents report an active subscription even though their referenced
  Stripe subscriptions are canceled. They were not changed during the buyer cleanup
  to avoid unexpectedly removing producer access.
- The deployed `getProducerPayoutStatus` function is not present in the organized source
  or saved project backups. It was preserved in production by deploying only the named
  functions that are represented in this repository.
