/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mainefarmmarket.app",
  appName: "Maine Farm Market",
  webDir: "dist",
  loggingBehavior: "none",
  android: {
    path: "../mobile/android",
    backgroundColor: "#efe1b6",
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com"],
    },
  },
};

export default config;
