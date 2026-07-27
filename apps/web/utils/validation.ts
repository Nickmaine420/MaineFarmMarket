export function isMaineZip(value: string): boolean {
  return /^(?:039\d{2}|04\d{3})(?:-\d{4})?$/.test(value.trim());
}

export function hasUsPhoneNumber(value: string): boolean {
  return value.replace(/\D/g, "").length >= 10;
}

export function toWholeQuantity(value: string | number): number | null {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 0 ? quantity : null;
}

export function toPriceCents(value: string | number): number | null {
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const cents = Math.round(dollars * 100);
  return Number.isInteger(cents) && cents > 0 ? cents : null;
}
