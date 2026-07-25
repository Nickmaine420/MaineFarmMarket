# Shared contracts

This package is the future single source of truth for platform-neutral contracts used by both the website and mobile app.

Good candidates include:

- Firestore collection names and document-path helpers
- user, producer, product, cart, and order types
- order and subscription status values
- validation schemas
- Maine-specific category and location constants

Firebase client initialization, UI components, browser APIs, React Native APIs, and secret-bearing backend code do not belong here.

The recovered website currently has local types with known shape inconsistencies. Those types should be reconciled against real Firestore documents before being migrated into this package.

