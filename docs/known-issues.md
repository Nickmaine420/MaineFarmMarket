# Known issues

Recorded during project organization on 2026-07-25:

- The future Google Play client has a reserved directory but has not been generated.
- Firebase Cloud Functions declare Node.js 20. Use Node 20 for development and deployment; the organization pass ran on Node 24 and npm correctly reported the engine mismatch.
- The web production bundle builds, but Vite reports a main JavaScript chunk of roughly 813 kB before gzip. Route-level code splitting should be considered before release.
- Locked dependency installation reported 11 audit findings for the web app and 28 for Cloud Functions, including critical findings. No automatic audit fix was applied because dependency upgrades require a separate compatibility and security review.
- Several feature pages still define local product and order types. Reconcile those definitions with production Firestore documents before making `packages/shared` authoritative.
- The Google Play application ID, release signing ownership, Android Firebase registration, and store-policy review remain open decisions.

