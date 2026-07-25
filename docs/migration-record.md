# Organization record

Date: 2026-07-25

Source archive:

`C:\Users\nickm\Downloads\MaineFarmMarket.zip`

Preserved recovery copy:

`backups/MaineFarmMarket-original-2026-03-02.zip`

SHA-256:

`DD3E93493FFFF117C23A6953E5FBFCE87F62D4E6830709C6A05D2E06C329CCCE`

## Actions taken

- Copied and hash-verified the complete original archive before organization.
- Kept the original archive in `backups/` without modification.
- Placed the existing website in `apps/web`.
- Placed Firebase Cloud Functions in `services/functions`.
- Placed Firestore rules in `firebase`.
- Retained the old deployment log in `archive/logs`.
- Added boundaries for a future Android client and shared contracts.
- Updated Firebase deployment paths for the new layout.
- Kept recovered environment files in their appropriate app/service directories and excluded them from Git.

No files were taken from or added to `CAC-USA`.

## Existing conditions

- The public GitHub repository `Nickmaine420/MaineFarmMarket` was empty when checked.
- Some feature pages define their own product and order shapes.
- The recovered `UserProfile` and Vite environment declarations did not match their existing runtime usage. Their type declarations were aligned without changing runtime behavior.
- Feature-specific product and order shapes should be reconciled against real Firestore documents before they move into `packages/shared`.
