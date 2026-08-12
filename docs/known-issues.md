# Known issues

Recorded during project organization on 2026-07-25:

- The Google Play client has been generated under `apps/mobile/android`.
- Firebase Cloud Functions were migrated to Node.js 22, Firebase Functions 7.3.0,
  and Firebase Admin 14.2.0 on 2026-07-26. The full function set loads in the
  emulator and its unit tests pass.
- The web production bundle builds, but Vite reports a Firebase JavaScript chunk
  of roughly 567 kB before gzip. Route-level Firebase code splitting can be
  considered as a later performance improvement.
- The web and Cloud Functions production dependency audits report zero known
  vulnerabilities as of 2026-08-11.
- Several feature pages still define local product and order types. Reconcile those definitions with production Firestore documents before making `packages/shared` authoritative.
- Buyer access is free. The retired buyer subscription price and product are disabled.
  No renewable buyer subscriptions remained in Stripe; both legacy tester records were
  marked canceled in Firestore without refunds on 2026-07-25.
- Producer subscription records are reconciled by trusted Cloud Functions against
  Stripe and Google Play, including a scheduled reconciliation job.
- The formerly deployed-only `getProducerPayoutStatus` function was restored to source
  on 2026-08-07 so future backend deployments remain reproducible.
- Google Play version 1.7 (version code 8) is the current tester build. Version 1.8
  (version code 9) is the consolidated UX and reliability release candidate built on
  2026-08-11. The selected tester list still needs to satisfy Google Play's current
  opted-in tester and continuous-testing requirements before production access.
- The Google Play `producer_monthly` subscription and `monthly` base plan are active
  at USD 29.99 per month in the United States. A trusted scheduled safeguard checks
  that the base plan remains available.
- The Android splash/theme defect and the first-time Buyer loading loop were fixed in
  version 1.8. The new regression coverage verifies first-time Buyer setup, compact
  mobile navigation, mobile Producer controls, cold/warm lifecycle behavior, and
  portrait/landscape layout.
