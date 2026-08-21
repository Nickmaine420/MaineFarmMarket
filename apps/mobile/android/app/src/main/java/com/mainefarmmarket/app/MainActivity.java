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
                    "if(depth>0){window.history.back();return true;}" +
                    "var hash=window.location.hash||'';" +
                    "if(hash.indexOf('#/start-subscription')===0){window.location.replace('/#/account');return true;}" +
                    "var path=window.location.pathname||'';" +
                    "if(/\\/(privacy|delete-account)\\.html$/.test(path)){" +
                    "var sameOriginReferrer=false;try{sameOriginReferrer=!!document.referrer&&new URL(document.referrer).origin===window.location.origin;}catch(e){}" +
                    "if(sameOriginReferrer&&window.history.length>1){window.history.back();}" +
                    "else{window.location.replace('/#/');}return true;}" +
                    "return false;})()",
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
