// MaineFarmMarket/lib/stripeConnectProducer.js
//
// Producer Stripe Connect onboarding helper
//
// Calls Firebase callable functions (via Firebase SDK):
// - createProducerConnectAccount
// - createProducerOnboardingLink
//
// Usage:
//   await startProducerStripeOnboarding();         // producerId defaults to uid in backend
//   await startProducerStripeOnboarding("abc123"); // if your producer doc id differs (optional)

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export async function startProducerStripeOnboarding(producerId) {
  const createProducerConnectAccount = httpsCallable(
    functions,
    "createProducerConnectAccount"
  );

  const createProducerOnboardingLink = httpsCallable(
    functions,
    "createProducerOnboardingLink"
  );

  // 1) Ensure connected account exists
  const acctRes = await createProducerConnectAccount(producerId != null ? { producerId } : {});
  const stripeAccountId = acctRes.data?.stripeAccountId;

  if (!stripeAccountId) {
    throw new Error("Stripe Connect account creation failed (missing stripeAccountId).");
  }

  // 2) Get onboarding link
  const linkRes = await createProducerOnboardingLink(producerId != null ? { producerId } : {});
  const url = linkRes.data?.url;

  if (!url) {
    throw new Error("Stripe onboarding link creation failed (missing url).");
  }

  // 3) Redirect producer to Stripe onboarding
  window.location.assign(url);
}
