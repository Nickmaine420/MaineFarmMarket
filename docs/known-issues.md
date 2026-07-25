# Known issues

Recorded during project organization on 2026-07-25:

- The Google Play client has been generated under `apps/mobile/android`.
- Firebase Cloud Functions declare Node.js 20. Google reports that runtime as deprecated
  and scheduled for decommissioning on 2026-10-30, so a tested runtime upgrade is
  required before then.
- The web production bundle builds, but Vite reports a main JavaScript chunk of roughly
  888 kB before gzip. Route-level code splitting should be considered before release.
- Locked dependency installation reported 11 audit findings for the web app and 28 for Cloud Functions, including critical findings. No automatic audit fix was applied because dependency upgrades require a separate compatibility and security review.
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
