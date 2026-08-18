import { describe, expect, it, vi } from "vitest";
import { getCurrentCoordinates } from "./location";

describe("getCurrentCoordinates", () => {
  it("requests native permission before reading coordinates", async () => {
    const calls: string[] = [];
    const permissionClient = {
      ensurePermission: vi.fn(async () => {
        calls.push("permission");
      }),
    };
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) => {
        calls.push("position");
        success({ coords: { latitude: 44.31, longitude: -69.78 } } as GeolocationPosition);
      }),
    };

    await expect(
      getCurrentCoordinates({ geolocation, nativePlatform: true, permissionClient })
    ).resolves.toEqual({ lat: 44.31, lng: -69.78 });
    expect(calls).toEqual(["permission", "position"]);
  });

  it("does not read coordinates when native permission is denied", async () => {
    const geolocation = { getCurrentPosition: vi.fn() };
    const permissionClient = {
      ensurePermission: vi.fn().mockRejectedValue(new Error("denied")),
    };

    await expect(
      getCurrentCoordinates({ geolocation, nativePlatform: true, permissionClient })
    ).rejects.toThrow("denied");
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
