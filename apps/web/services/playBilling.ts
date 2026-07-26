import { registerPlugin } from "@capacitor/core";

export const GOOGLE_PLAY_PRODUCER_SUBSCRIPTION_ID = "producer_monthly";

export type PlaySubscriptionDetails = {
  available: boolean;
  productId: string;
  name?: string;
  description?: string;
  basePlanId?: string;
  offerId?: string | null;
  formattedPrice?: string;
  billingPeriod?: string;
  priceAmountMicros?: number;
  priceCurrencyCode?: string;
};

export type PlayPurchase = {
  purchaseToken: string;
  productIds: string[];
  purchaseState: number;
  acknowledged: boolean;
  autoRenewing: boolean;
  orderId?: string | null;
  purchaseTime: number;
};

type PlayBillingPlugin = {
  getSubscription(options: {
    productId: string;
  }): Promise<PlaySubscriptionDetails>;
  purchaseSubscription(options: {
    productId: string;
    obfuscatedAccountId: string;
  }): Promise<PlayPurchase>;
  querySubscriptions(): Promise<{ purchases: PlayPurchase[] }>;
  openSubscriptionManagement(options: { productId: string }): Promise<void>;
};

export const PlayBilling = registerPlugin<PlayBillingPlugin>("PlayBilling");

export async function obfuscatePlayAccountId(uid: string): Promise<string> {
  const bytes = new TextEncoder().encode(uid);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
