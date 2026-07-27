import { describe, expect, it } from "vitest";
import { normalizeRouteTarget, parseHashLocation } from "./router";

describe("local hash routing", () => {
  it("normalizes empty and relative destinations", () => {
    expect(normalizeRouteTarget("")).toBe("/");
    expect(normalizeRouteTarget("buyer/orders")).toBe("/buyer/orders");
    expect(normalizeRouteTarget("/producer")).toBe("/producer");
  });

  it("parses a route and query parameters from the hash", () => {
    expect(parseHashLocation("#/producer/payouts?from=setup")).toEqual({
      pathname: "/producer/payouts",
      search: "?from=setup",
      hash: "#/producer/payouts?from=setup",
      state: null,
    });
  });

  it("preserves navigation state without putting it in the URL", () => {
    const state = { from: "/buyer" };
    expect(parseHashLocation("#/account", state).state).toBe(state);
  });
});
