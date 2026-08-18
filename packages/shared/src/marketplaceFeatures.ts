export const MAX_PRODUCER_PROFILE_PHOTOS = 6;
export const MAX_EVENT_CATEGORIES = 12;
export const MAX_DISCOUNT_PERCENT = 90;

export type PublicProducerPhoto = {
  url: string;
  alt: string;
  uploadedAt?: unknown;
};

export type MarketplaceEvent = {
  id: string;
  hostProducerId: string;
  title: string;
  description: string;
  venueName: string;
  address: string;
  city: string;
  state: "ME";
  zip: string;
  lat: number | null;
  lng: number | null;
  categories: string[];
  startAt: unknown;
  endAt: unknown;
  status: "draft" | "published" | "cancelled";
};

export type ProducerPromotion = {
  id: string;
  producerId: string;
  title: string;
  description: string;
  kind: "deal" | "announcement";
  startsAt: unknown;
  endsAt: unknown;
  active: boolean;
};

export type ProducerPartnership = {
  id: string;
  memberIds: [string, string];
  requestedBy: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  publicNote: string;
};
