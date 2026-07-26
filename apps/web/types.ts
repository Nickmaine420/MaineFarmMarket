
export enum UserRole {
  BUYER = 'buyer',
  PRODUCER = 'producer',
  ADMIN = 'admin'
}

export enum SubscriptionStatus {
  NONE = 'none',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PAST_DUE = 'past_due'
}

export interface UserProfile {
  uid: string;
  role: UserRole;
  displayName: string | null;
  email: string | null;
  buyerProfileComplete: boolean;
  subscriptionStatus: SubscriptionStatus;
  subscriptionProvider: 'stripe' | 'google_play' | 'review' | null;
  userAgreementAcceptedAt: unknown | null;
  producerTermsVersion: string | null;
  producerTermsAcceptedAt: unknown | null;
  producerOnboardingComplete: boolean;
  producerPaymentPreference: 'direct' | 'stripe' | null;
  hasStripeConnectAccount: boolean;
  address?: {
    line1: string;
    city: string;
    state: 'ME';
    zip: string;
  };
  subscription?: {
    status: SubscriptionStatus;
    currentPeriodEnd: number;
    provider?: 'stripe' | 'google_play' | 'review';
  };
}

export interface Product {
  id: string;
  producerId: string;
  producerName: string;
  title: string;
  category: string;
  description: string;
  price: number;
  unit: string;
  image: string;
  inStock: boolean;
  quantityAvailable: number;
}

export interface Order {
  id: string;
  buyerId: string;
  producerId: string;
  items: {
    productId: string;
    title: string;
    price: number;
    qty: number;
  }[];
  status: 'requested' | 'accepted' | 'declined' | 'completed';
  fulfillment: 'pickup' | 'delivery';
  createdAt: number;
}
