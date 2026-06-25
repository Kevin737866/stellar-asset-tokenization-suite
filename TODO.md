# Project TODO

## #14 Security: Centralized Admin Control (Multi-sig / Governance)

### Step 1 — Discovery
- [x] Read existing admin enforcement implementation (`src/shared_admin.rs`).
- [x] Identify contracts using single admin gating (asset_factory, rwa_token, compliance_registry, dividend_distributor).

### Step 2 — Governance design
- [ ] Implement threshold-based multi-owner governance module.
  - [ ] Store owners + threshold in contract instance storage.
  - [ ] Provide `propose/approve/execute` (optionally timelock).

### Step 3 — Integrate into contracts
- [ ] Replace `require_admin/assert_admin` paths in:
  - [ ] `src/asset_factory.rs`
  - [ ] `src/rwa_token.rs`
  - [ ] `src/compliance_registry.rs`
  - [ ] `src/dividend_distributor.rs`

### Step 4 — Migration / initialization
- [ ] Decide storage compatibility strategy and implement `migrate` updates.

### Step 5 — Tests
- [ ] Add/adjust unit tests to cover:
  - [ ] single-owner cannot execute
  - [ ] threshold approvals can execute

### Step 6 — Verify
- [ ] Run `cargo test` and ensure build/test passes.

