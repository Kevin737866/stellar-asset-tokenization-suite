# TODO - API Reference Documentation (Issue #70)

## Plan
1. Read Rust contract entrypoint files to extract all `pub fn` APIs.
2. Read TypeScript SDK client files + types/errors to extract public method APIs.
3. Create docs pages under `docs/api/` for each contract + SDK clients.
4. Add a docs index page and update root `README.md` to link to API reference.
5. Ensure coverage: all 6 contract modules + suite wrapper + all exported SDK clients.

## Progress
- [x] Step 1: Read Rust contract entrypoints (`src/asset_factory.rs`, `src/rwa_token.rs`, `src/compliance_registry.rs`, `src/dividend_distributor.rs`, `src/secondary_market.rs`, `src/custody_validator.rs`, `src/lib.rs`).
- [x] Step 2: Read SDK client files (`sdk/src/assetFactory.ts`, `tokenClient.ts`, `complianceClient.ts`, `dividendClient.ts`, `marketClient.ts`, `custody.ts`, `custodyMonitoring.ts`, `types.ts`, `errors.ts`, plus any SDK index exports).
- [x] Step 3: Implement docs templates and create `docs/api/*.md`.

- [x] Step 4: Update `README.md` with API reference links.
- [x] Step 5: Final verification (method name mapping, links, coverage). 



