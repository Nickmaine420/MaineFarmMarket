import { describe, expect, it } from "vitest";
import {
  activeProductDiscount,
  effectiveProductPriceCents,
  milesBetween,
  monthCalendarCells,
  salePriceFromPercent,
} from "./marketplaceFeatures";

describe("marketplace feature helpers", () => {
  it("computes and validates product discounts", () => {
    expect(salePriceFromPercent(1000, 25)).toBe(750);
    expect(salePriceFromPercent(1000, 91)).toBeNull();
    expect(activeProductDiscount({ priceCents: 750, originalPriceCents: 1000 }, 0)?.percent).toBe(25);
    expect(activeProductDiscount({ priceCents: 1000, originalPriceCents: 1000 }, 0)).toBeNull();
  });

  it("expires discounts", () => {
    expect(
      activeProductDiscount(
        { priceCents: 500, originalPriceCents: 1000, discountEndsAt: new Date(1000) },
        1001
      )
    ).toBeNull();
    expect(
      effectiveProductPriceCents(
        { priceCents: 500, originalPriceCents: 1000, discountEndsAt: new Date(1000) },
        1001
      )
    ).toBe(1000);
  });

  it("calculates distance and calendar placement", () => {
    expect(milesBetween({ lat: 44.55, lng: -69.63 }, { lat: 44.32, lng: -69.78 })).toBeGreaterThan(10);
    const cells = monthCalendarCells(2026, 7);
    expect(cells.filter(Boolean)).toHaveLength(31);
    expect(cells[6]).toBe(1);
  });
});
