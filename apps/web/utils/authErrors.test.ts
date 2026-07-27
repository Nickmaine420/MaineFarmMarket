import { describe, expect, it } from "vitest";
import { getGoogleSignInErrorMessage } from "./authErrors";

describe("Google sign-in error messages", () => {
  it("distinguishes a user cancellation from other failures", () => {
    expect(
      getGoogleSignInErrorMessage({ code: "auth/popup-closed-by-user" })
    ).toContain("canceled");
  });

  it("gives a useful network recovery message", () => {
    expect(
      getGoogleSignInErrorMessage({ code: "auth/network-request-failed" })
    ).toContain("connection");
  });

  it("does not mislabel a configuration failure as a cancellation", () => {
    const message = getGoogleSignInErrorMessage({
      message: "10: DEVELOPER_ERROR",
    });
    expect(message).toContain("temporarily unavailable");
    expect(message).not.toContain("canceled");
  });
});
