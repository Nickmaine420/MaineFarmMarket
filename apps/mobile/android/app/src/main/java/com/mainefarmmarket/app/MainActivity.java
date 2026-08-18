package com.mainefarmmarket.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlayBillingPlugin.class);
        registerPlugin(GoogleAccountChooserPlugin.class);
        registerPlugin(LocationPermissionPlugin.class);
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) {
                    finish();
                    return;
                }

                bridge.getWebView().evaluateJavascript(
                    "(function(){var state=window.history.state||{};" +
                    "var depth=Number(state.maineFarmMarketDepth||0);" +
                    "if(depth>0){window.history.back();return true;}return false;})()",
                    result -> {
                        if (!"true".equals(result)) {
                            finish();
                        }
                    }
                );
            }
        });
    }
}
