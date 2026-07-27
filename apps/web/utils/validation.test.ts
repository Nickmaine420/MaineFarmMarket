import { describe, expect, it } from "vitest";
import {
  hasUsPhoneNumber,
  isMaineZip,
  toPriceCents,
  toWholeQuantity,
} from "./validation";

describe("marketplace form validation", () => {
  it("accepts Maine ZIP codes and rejects out-of-state ZIP codes", () => {
    expect(isMaineZip("04901")).toBe(true);
    expect(isMaineZip("04101-1234")).toBe(true);
    expect(isMaineZip("10001")).toBe(false);
  });

  it("requires a usable US phone number", () => {
    expect(hasUsPhoneNumber("(207) 555-0123")).toBe(true);
    expect(hasUsPhoneNumber("555-0123")).toBe(false);
  });

  it("normalizes valid prices to integer cents", () => {
    expect(toPriceCents("6.50")).toBe(650);
    expect(toPriceCents("0")).toBeNull();
    expect(toPriceCents("not a price")).toBeNull();
  });

  it("only accepts nonnegative whole inventory quantities", () => {
    expect(toWholeQuantity("20")).toBe(20);
    expect(toWholeQuantity("2.5")).toBeNull();
    expect(toWholeQuantity("-1")).toBeNull();
  });
});
