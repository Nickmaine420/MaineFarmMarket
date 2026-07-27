package com.mainefarmmarket.app;

import static org.junit.Assert.*;

import org.junit.Test;

public class ExampleUnitTest {

    @Test
    public void producerSubscriptionMatchesPlayConsoleProduct() {
        assertEquals("producer_monthly", MarketplaceConfig.PRODUCER_SUBSCRIPTION_ID);
        assertTrue(MarketplaceConfig.isConfiguredProducerSubscription("producer_monthly"));
        assertFalse(MarketplaceConfig.isConfiguredProducerSubscription("buyer_monthly"));
        assertFalse(MarketplaceConfig.isConfiguredProducerSubscription(null));
    }

    @Test
    public void packageNameIsIndependentFromOtherApps() {
        assertEquals("com.mainefarmmarket.app", MarketplaceConfig.PACKAGE_NAME);
        assertNotEquals("com.cacusa.app", MarketplaceConfig.PACKAGE_NAME);
    }
}
