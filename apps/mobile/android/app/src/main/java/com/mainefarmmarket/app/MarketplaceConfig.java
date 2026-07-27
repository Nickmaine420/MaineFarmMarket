package com.mainefarmmarket.app;

public final class MarketplaceConfig {
    public static final String PACKAGE_NAME = "com.mainefarmmarket.app";
    public static final String PRODUCER_SUBSCRIPTION_ID = "producer_monthly";
    public static final String PRODUCER_BASE_PLAN_ID = "monthly";

    private MarketplaceConfig() {}

    public static boolean isConfiguredProducerSubscription(String productId) {
        return PRODUCER_SUBSCRIPTION_ID.equals(productId);
    }
}
