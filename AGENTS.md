# Maine Farm Market project rules

- This repository is exclusively for Maine Farm Market.
- Do not copy code, assets, configuration, or dependencies from `CAC-USA`.
- Treat `backups/` as recovery material. Never modify or delete its contents during normal development.
- Keep deployable clients separate:
  - `apps/web` is the website.
  - `apps/mobile` is the future Google Play app.
- Both clients must use the same Firebase project and shared Firestore data contract.
- Put trusted payment and administrative operations in `services/functions`, not in either client.
- Put cross-platform types, collection names, validation rules, and other platform-neutral contracts in `packages/shared`.
- Never commit `.env`, `.env.local`, service credentials, API secrets, or generated dependency folders.

