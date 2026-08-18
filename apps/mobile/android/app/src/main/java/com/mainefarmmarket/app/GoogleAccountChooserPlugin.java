package com.mainefarmmarket.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;

@CapacitorPlugin(name = "GoogleAccountChooser")
public class GoogleAccountChooserPlugin extends Plugin {
    @PluginMethod
    public void clearLastAccount(PluginCall call) {
        String webClientId = getContext().getString(R.string.default_web_client_id);
        GoogleSignInOptions options = new GoogleSignInOptions.Builder(
            GoogleSignInOptions.DEFAULT_SIGN_IN
        )
            .requestIdToken(webClientId)
            .requestEmail()
            .build();
        GoogleSignInClient client = GoogleSignIn.getClient(getActivity(), options);

        client.signOut().addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                call.resolve();
                return;
            }
            Exception error = task.getException();
            call.reject(
                "Could not prepare the Google account chooser",
                error == null ? new IllegalStateException("Google sign-out failed") : error
            );
        });
    }
}
