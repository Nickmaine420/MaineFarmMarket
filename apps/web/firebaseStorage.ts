import { connectStorageEmulator, getStorage } from "firebase/storage";
import { app, isFirebaseEmulatorMode } from "./firebase";

// Storage is initialized only when a producer opens a photo workflow. Keeping
// it out of the authentication bootstrap reduces work during every cold start.
export const storage = getStorage(app);

if (isFirebaseEmulatorMode) {
  const emulatorFlag = "__mfmStorageEmulatorConnected";
  const globalState = globalThis as typeof globalThis & Record<string, unknown>;
  if (!globalState[emulatorFlag]) {
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    globalState[emulatorFlag] = true;
  }
}
