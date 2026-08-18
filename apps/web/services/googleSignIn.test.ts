import { describe, expect, it, vi } from "vitest";
import { signInWithGoogleAccountChooser } from "./googleSignIn";

describe("signInWithGoogleAccountChooser", () => {
  it("clears the previous selection before opening Google sign-in", async () => {
    const calls: string[] = [];
    const authClient = {
      signOut: vi.fn(),
      signInWithGoogle: vi.fn(async () => {
        calls.push("signInWithGoogle");
        return {} as never;
      }),
    };
    const chooserClient = {
      clearLastAccount: vi.fn(async () => {
        calls.push("clearLastAccount");
      }),
    };

    await signInWithGoogleAccountChooser(authClient, chooserClient);

    expect(calls).toEqual(["clearLastAccount", "signInWithGoogle"]);
    expect(authClient.signInWithGoogle).toHaveBeenCalledWith({
      skipNativeAuth: true,
      useCredentialManager: false,
    });
  });

  it("does not risk silent account reuse when clearing fails", async () => {
    const authClient = {
      signOut: vi.fn(),
      signInWithGoogle: vi.fn().mockResolvedValue({}),
    };
    const chooserClient = {
      clearLastAccount: vi.fn().mockRejectedValue(new Error("clear failed")),
    };

    await expect(
      signInWithGoogleAccountChooser(authClient, chooserClient)
    ).rejects.toThrow("clear failed");

    expect(authClient.signInWithGoogle).not.toHaveBeenCalled();
  });
});
