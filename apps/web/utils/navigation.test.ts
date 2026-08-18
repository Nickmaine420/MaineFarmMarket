import { describe, expect, it } from "vitest";
import { UserRole } from "../types";
import { isNavigationTargetActive, navigationItemsForRole } from "./navigation";

describe("app navigation", () => {
  it("provides every primary buyer destination", () => {
    expect(navigationItemsForRole(UserRole.BUYER).map((item) => item.to)).toEqual([
      "/buyer",
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
      "/producer?view=farm",
      "/account",
    ]);
  });

  it("marks producer tabs active using the view query", () => {
    expect(isNavigationTargetActive("/producer", "?view=orders", "/producer?view=orders")).toBe(true);
    expect(isNavigationTargetActive("/producer", "?view=products", "/producer?view=orders")).toBe(false);
  });
});
