import { Capacitor } from "@capacitor/core";

export const isNativeAndroidApp = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

