import { describe, expect, it } from "vitest";
import { formatMarketplaceLabel } from "./display";

describe("formatMarketplaceLabel", () => {
  it("converts internal order values to customer-facing language", () => {
    expect(formatMarketplaceLabel("AWAITING_PAYMENT")).toBe("Awaiting producer response");
    expect(formatMarketplaceLabel("arrange_with_producer")).toBe("Arrange payment with producer");
    expect(formatMarketplaceLabel("cancelled_by_buyer")).toBe("Cancelled by buyer");
  });

  it("labels missing legacy fields without exposing unknown", () => {
    expect(formatMarketplaceLabel("unknown")).toBe("Not recorded");
    expect(formatMarketplaceLabel(null, "Legacy — not recorded")).toBe("Legacy — not recorded");
  });
});
