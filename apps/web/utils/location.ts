import { Capacitor, registerPlugin } from "@capacitor/core";

type LocationPermissionClient = {
  ensurePermission: () => Promise<void>;
};

type GeolocationClient = Pick<Geolocation, "getCurrentPosition">;

type CurrentLocationDependencies = {
  geolocation?: GeolocationClient | null;
  nativePlatform?: boolean;
  permissionClient?: LocationPermissionClient;
};

export type CurrentCoordinates = {
  lat: number;
  lng: number;
};

export const LocationPermission =
  registerPlugin<LocationPermissionClient>("LocationPermission");

export async function getCurrentCoordinates(
  dependencies: CurrentLocationDependencies = {}
): Promise<CurrentCoordinates> {
  const nativePlatform =
    dependencies.nativePlatform ?? Capacitor.isNativePlatform();
  const permissionClient = dependencies.permissionClient ?? LocationPermission;
  const geolocation =
    dependencies.geolocation ??
    (typeof navigator === "undefined" ? null : navigator.geolocation);

  if (!geolocation) {
    throw new Error("Location is not supported on this device.");
  }
  if (nativePlatform) {
    await permissionClient.ensurePermission();
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      reject,
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 15_000,
      }
    );
  });
}
