export type DiscountableProduct = {
  price?: number;
  priceCents?: number;
  originalPriceCents?: number;
  discountEndsAt?: unknown;
};

const timestampToMillis = (value: unknown): number | null => {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object") {
    const candidate = value as { toMillis?: () => number; seconds?: number };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  return null;
};

export const activeProductDiscount = (
  product: DiscountableProduct,
  nowMs = Date.now()
) => {
  const currentPriceCents = Number.isInteger(product.priceCents)
    ? Number(product.priceCents)
    : Math.round(Number(product.price || 0) * 100);
  const originalPriceCents = Number(product.originalPriceCents || 0);
  const endsAtMs = timestampToMillis(product.discountEndsAt);
  if (
    currentPriceCents <= 0 ||
    !Number.isInteger(originalPriceCents) ||
    originalPriceCents <= currentPriceCents ||
    (endsAtMs != null && endsAtMs <= nowMs)
  ) {
    return null;
  }
  return {
    currentPriceCents,
    originalPriceCents,
    percent: Math.max(
      1,
      Math.min(99, Math.round((1 - currentPriceCents / originalPriceCents) * 100))
    ),
    endsAtMs,
  };
};

export const effectiveProductPriceCents = (
  product: DiscountableProduct,
  nowMs = Date.now()
) => {
  const storedPriceCents = Number.isInteger(product.priceCents)
    ? Number(product.priceCents)
    : Math.round(Number(product.price || 0) * 100);
  const originalPriceCents = Number(product.originalPriceCents || 0);
  const endsAtMs = timestampToMillis(product.discountEndsAt);
  return endsAtMs != null && endsAtMs <= nowMs && originalPriceCents > storedPriceCents
    ? originalPriceCents
    : storedPriceCents;
};

export const salePriceFromPercent = (originalPriceCents: number, percent: number) => {
  if (
    !Number.isInteger(originalPriceCents) ||
    originalPriceCents <= 0 ||
    !Number.isInteger(percent) ||
    percent < 1 ||
    percent > 90
  ) {
    return null;
  }
  return Math.max(1, Math.round(originalPriceCents * (1 - percent / 100)));
};

export const milesBetween = (
  first: { lat: number; lng: number },
  second: { lat: number; lng: number }
) => {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = radians(second.lat - first.lat);
  const longitudeDelta = radians(second.lng - first.lng);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.lat)) *
      Math.cos(radians(second.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const monthCalendarCells = (year: number, monthIndex: number) => {
  const firstDay = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return [
    ...Array.from({ length: firstDay.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
};
