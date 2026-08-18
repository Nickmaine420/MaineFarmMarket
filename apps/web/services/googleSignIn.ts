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
  // The legacy Google Play Services flow works across the supported physical
  // devices, but caches the last account. Await a native sign-out so its next
  // sign-in intent presents the account picker instead of silently reusing it.
  await chooserClient.clearLastAccount();
  return authClient.signInWithGoogle({
    skipNativeAuth: true,
    useCredentialManager: false,
  });
};
