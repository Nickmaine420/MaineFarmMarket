import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { registerPlugin } from "@capacitor/core";

type NativeGoogleAuthClient = Pick<
  typeof FirebaseAuthentication,
  "signOut" | "signInWithGoogle"
>;

type GoogleAccountChooserClient = {
  clearLastAccount: () => Promise<void>;
};

export const GoogleAccountChooser =
  registerPlugin<GoogleAccountChooserClient>("GoogleAccountChooser");

export const signInWithGoogleAccountChooser = async (
  authClient: NativeGoogleAuthClient = FirebaseAuthentication,
  chooserClient: GoogleAccountChooserClient = GoogleAccountChooser
) => {
  // Clear both the Firebase Authentication plugin and the legacy Google Play
  // Services client. They maintain separate session caches on Android.
  await authClient.signOut();
  await chooserClient.clearLastAccount();
  return authClient.signInWithGoogle({
    skipNativeAuth: true,
    useCredentialManager: false,
  });
};
