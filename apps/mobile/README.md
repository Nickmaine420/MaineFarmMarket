# Maine Farm Market Android app

This directory contains the independent Capacitor Android wrapper for the Maine Farm
Market React client. It must never reuse files from `CAC-USA`.

- Application ID: `com.mainefarmmarket.app`
- Firebase project: `mainefarmmarket`
- Minimum Android API: 24
- Compile/target Android API: 36
- Web source: `apps/web`
- Shared contracts: `packages/shared`

Run `npm run mobile:sync` from the repository root after every web change. Create a
signed release bundle with `npm run mobile:bundle`.

`google-services.json` contains Firebase client configuration and is committed for the
Android build. Private upload keys, keystore passwords, service-account credentials,
Stripe secret keys, and webhook secrets must never be committed.

The Android subscription screen is consumption-only. It does not launch external
Stripe subscription checkout from inside the app. Existing members can sign in and use
the shared marketplace.
