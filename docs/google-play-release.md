# Google Play release

## Release identity

- Application ID: `com.mainefarmmarket.app`
- Firebase Android app ID: `1:275379861196:android:52532d7cdfc236f9013469`
- Version name: `1.6`
- Version code: `7`
- Target SDK: 36

## Build

From the repository root:

```powershell
npm run mobile:bundle
```

The generated bundle is:

```text
apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
```

The signing properties and upload keystore are intentionally excluded from Git. Keep
the original private upload key and its password backup secure. The public upload
certificate may be supplied to Google Play when requested.

## Subscription behavior

Buyers access the marketplace and place orders without an access subscription.
Android producer subscriptions use Google Play product `producer_monthly` and base
plan `monthly`. Website producer subscriptions continue to use Stripe. Subscription
management follows the provider originally used by the producer.

## Before production rollout

1. Upload the signed AAB to an internal testing track.
2. Confirm both the upload-key and Play app-signing SHA-1/SHA-256 certificates are
   registered on the Firebase Android app before testing Google sign-in.
3. Complete the Data safety, privacy policy, app access, content rating, and account
   deletion declarations in Play Console.
4. Add internal testers and verify Google sign-in, real-time data, direct-payment
   orders, optional Stripe product checkout, and producer order notifications.
5. Verify the production Firebase Functions, Firestore rules, Hosting site, Stripe
   webhook, and Stripe Connect configuration are deployed from this repository.
