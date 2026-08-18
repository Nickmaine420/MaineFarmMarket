import { describe, expect, it } from "vitest";
import { UserRole } from "../types";
import { bottomNavigationItemsForRole, isNavigationTargetActive, navigationItemsForRole } from "./navigation";

describe("app navigation", () => {
  it("provides every primary buyer destination", () => {
    expect(navigationItemsForRole(UserRole.BUYER).map((item) => item.to)).toEqual([
      "/buyer",
      "/events",
      "/promotions",
      "/buyer/orders",
      "/cart",
      "/account",
    ]);
  });

  it("provides every primary producer destination", () => {
    expect(navigationItemsForRole(UserRole.PRODUCER).map((item) => item.to)).toEqual([
      "/producer?view=overview",
      "/producer?view=products",
      "/producer?view=orders",
      "/events",
      "/producer/growth",
      "/producer?view=farm",
      "/account",
    ]);
  });

  it("keeps the producer farm editor in the full menu without crowding the bottom bar", () => {
    expect(bottomNavigationItemsForRole(UserRole.PRODUCER).some((item) => item.to.includes("view=farm"))).toBe(false);
    expect(bottomNavigationItemsForRole(UserRole.PRODUCER).map((item) => item.shortLabel)).toEqual([
      "Home", "Products", "Orders", "Events", "Grow", "Account",
    ]);
  });

  it("marks producer tabs active using the view query", () => {
    expect(isNavigationTargetActive("/producer", "?view=orders", "/producer?view=orders")).toBe(true);
    expect(isNavigationTargetActive("/producer", "?view=products", "/producer?view=orders")).toBe(false);
  });
});
