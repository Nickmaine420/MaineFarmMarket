package com.mainefarmmarket.app;

import android.content.Intent;
import android.net.Uri;
import androidx.annotation.NonNull;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
            )
            .enableAutoServiceReconnection()
            .build();
    }

    private interface BillingAction {
        void run();
    }

    private void withBillingClient(PluginCall call, BillingAction action) {
        if (billingClient != null && billingClient.isReady()) {
            action.run();
            return;
        }

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    action.run();
                } else {
                    reject(call, "Google Play Billing is unavailable", result);
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // Automatic service reconnection is enabled on the BillingClient.
            }
        });
    }

    private void reject(PluginCall call, String message, BillingResult result) {
        call.reject(
            message + ": " + result.getDebugMessage(),
            "PLAY_BILLING_" + result.getResponseCode()
        );
    }

    private QueryProductDetailsParams productQuery(String productId) {
        QueryProductDetailsParams.Product product =
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
        return QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(product))
            .build();
    }

    private ProductDetails.SubscriptionOfferDetails selectOffer(ProductDetails details) {
        List<ProductDetails.SubscriptionOfferDetails> offers =
            details.getSubscriptionOfferDetails();
        if (offers == null || offers.isEmpty()) return null;

        for (ProductDetails.SubscriptionOfferDetails offer : offers) {
            if (
                MarketplaceConfig.PRODUCER_BASE_PLAN_ID.equals(offer.getBasePlanId()) &&
                offer.getOfferId() == null
            ) {
                return offer;
            }
        }
        for (ProductDetails.SubscriptionOfferDetails offer : offers) {
            if (MarketplaceConfig.PRODUCER_BASE_PLAN_ID.equals(offer.getBasePlanId())) {
                return offer;
            }
        }
        return null;
    }

    private JSObject productDetailsResult(ProductDetails details) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("productId", details.getProductId());
        result.put("name", details.getName());
        result.put("description", details.getDescription());

        ProductDetails.SubscriptionOfferDetails offer = selectOffer(details);
        if (offer != null) {
            result.put("basePlanId", offer.getBasePlanId());
            result.put("offerId", offer.getOfferId());
            List<ProductDetails.PricingPhase> phases =
                offer.getPricingPhases().getPricingPhaseList();
            if (!phases.isEmpty()) {
                ProductDetails.PricingPhase recurringPhase = phases.get(phases.size() - 1);
                result.put("formattedPrice", recurringPhase.getFormattedPrice());
                result.put("billingPeriod", recurringPhase.getBillingPeriod());
                result.put("priceAmountMicros", recurringPhase.getPriceAmountMicros());
                result.put("priceCurrencyCode", recurringPhase.getPriceCurrencyCode());
            }
        }
        return result;
    }

    private JSObject purchaseResult(Purchase purchase) {
        JSObject result = new JSObject();
        result.put("purchaseToken", purchase.getPurchaseToken());
        result.put("productIds", new JSArray(purchase.getProducts()));
        result.put("purchaseState", purchase.getPurchaseState());
        result.put("acknowledged", purchase.isAcknowledged());
        result.put("autoRenewing", purchase.isAutoRenewing());
        result.put("orderId", purchase.getOrderId());
        result.put("purchaseTime", purchase.getPurchaseTime());
        return result;
    }

    @PluginMethod
    public void getSubscription(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null || productId.isBlank()) {
            call.reject("productId is required");
            return;
        }

        withBillingClient(call, () ->
            billingClient.queryProductDetailsAsync(productQuery(productId), (billingResult, queryResult) -> {
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    reject(call, "Could not load the Google Play subscription", billingResult);
                    return;
                }
                List<ProductDetails> products = queryResult.getProductDetailsList();
                if (products == null || products.isEmpty()) {
                    JSObject unavailable = new JSObject();
                    unavailable.put("available", false);
                    unavailable.put("productId", productId);
                    call.resolve(unavailable);
                    return;
                }
                call.resolve(productDetailsResult(products.get(0)));
            })
        );
    }

    @PluginMethod
    public void purchaseSubscription(PluginCall call) {
        String productId = call.getString("productId");
        String obfuscatedAccountId = call.getString("obfuscatedAccountId");
        if (!MarketplaceConfig.isConfiguredProducerSubscription(productId)) {
            call.reject("The requested subscription product is not configured");
            return;
        }
        if (obfuscatedAccountId == null || obfuscatedAccountId.isBlank()) {
            call.reject("obfuscatedAccountId is required");
            return;
        }
        if (pendingPurchaseCall != null) {
            call.reject("Another Google Play purchase is already in progress");
            return;
        }

        withBillingClient(call, () ->
            billingClient.queryProductDetailsAsync(productQuery(productId), (queryResult, productResult) -> {
                if (queryResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    reject(call, "Could not load the Google Play subscription", queryResult);
                    return;
                }
                List<ProductDetails> products = productResult.getProductDetailsList();
                if (products == null || products.isEmpty()) {
                    call.reject("The Google Play subscription is not available");
                    return;
                }

                ProductDetails details = products.get(0);
                ProductDetails.SubscriptionOfferDetails offer = selectOffer(details);
                if (offer == null) {
                    call.reject("The Google Play subscription has no available base plan");
                    return;
                }

                BillingFlowParams.ProductDetailsParams productParams =
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(details)
                        .setOfferToken(offer.getOfferToken())
                        .build();
                BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(productParams))
                    .setObfuscatedAccountId(obfuscatedAccountId)
                    .build();

                pendingPurchaseCall = call;
                call.setKeepAlive(true);
                BillingResult launchResult =
                    billingClient.launchBillingFlow(getActivity(), flowParams);
                if (launchResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    pendingPurchaseCall = null;
                    call.setKeepAlive(false);
                    reject(call, "Google Play could not start the purchase", launchResult);
                }
            })
        );
    }

    @PluginMethod
    public void querySubscriptions(PluginCall call) {
        withBillingClient(call, () -> {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
            billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    reject(call, "Could not restore Google Play subscriptions", billingResult);
                    return;
                }
                JSArray purchaseArray = new JSArray();
                for (Purchase purchase : purchases) {
                    purchaseArray.put(purchaseResult(purchase));
                }
                JSObject result = new JSObject();
                result.put("purchases", purchaseArray);
                call.resolve(result);
            });
        });
    }

    @PluginMethod
    public void openSubscriptionManagement(PluginCall call) {
        String productId = call.getString("productId");
        Uri.Builder uri = Uri.parse("https://play.google.com/store/account/subscriptions")
            .buildUpon()
            .appendQueryParameter("package", MarketplaceConfig.PACKAGE_NAME);
        if (productId != null && !productId.isBlank()) {
            uri.appendQueryParameter("sku", productId);
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri.build()));
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open Google Play subscription management", error);
        }
    }

    @Override
    public void onPurchasesUpdated(
        @NonNull BillingResult billingResult,
        List<Purchase> purchases
    ) {
        PluginCall call = pendingPurchaseCall;
        if (call == null) return;
        pendingPurchaseCall = null;
        call.setKeepAlive(false);

        if (
            billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK &&
            purchases != null &&
            !purchases.isEmpty()
        ) {
            call.resolve(purchaseResult(purchases.get(0)));
            return;
        }
        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.reject("Purchase canceled", "PLAY_BILLING_CANCELED");
            return;
        }
        reject(call, "Google Play did not complete the purchase", billingResult);
    }

    @Override
    protected void handleOnDestroy() {
        if (billingClient != null) billingClient.endConnection();
        super.handleOnDestroy();
    }
}
