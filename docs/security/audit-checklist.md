# Smart Contract Audit Checklist — Stellar RWA Tokenization Suite

> 50+ item checklist covering Soroban-specific and general smart contract security concerns.  
> Use this checklist for internal reviews and as a baseline for external audit engagements.

---

## General Security (15 items)

- [ ] **GEN-01**: All public/external functions have proper authorization checks (admin, owner, or role-based)
- [ ] **GEN-02**: No hardcoded secrets, API keys, or private keys in source code or comments
- [ ] **GEN-03**: All integer arithmetic uses checked/overflow-safe operations (`checked_add`, `checked_sub`, `checked_mul`, `checked_div`)
- [ ] **GEN-04**: No use of `unwrap()` or `expect()` in production code paths — use proper error handling
- [ ] **GEN-05**: Panics are replaced with typed contract errors (no `panic!` in contract logic)
- [ ] **GEN-06**: All storage keys use unique, namespaced identifiers to prevent collisions
- [ ] **GEN-07**: Contract has an emergency pause mechanism accessible only to admin
- [ ] **GEN-08**: Event emission is consistent and covers all state-changing operations
- [ ] **GEN-09**: Input validation is performed on all public function parameters (non-zero addresses, valid ranges, string length limits)
- [ ] **GEN-10**: No unbounded loops over storage — use pagination or batch processing
- [ ] **GEN-11**: Gas estimation / limits are considered for complex operations
- [ ] **GEN-12**: Contract upgrade path is documented and tested (migration functions, storage compatibility)
- [ ] **GEN-13**: No delegate call or equivalent to untrusted contracts
- [ ] **GEN-14**: Timestamp dependence is documented; contract does not rely on exact block timestamps for critical logic
- [ ] **GEN-15**: All external contract calls handle failure gracefully (no silent failure)

---

## Access Control & Authorization (8 items)

- [ ] **AC-01**: Admin functions are gated by `require_admin()` (not just address comparison)
- [ ] **AC-02**: Admin can be transferred (two-step transfer to prevent accidental lockout)
- [ ] **AC-03**: Governance module (`shared_governance.rs`) enforces threshold-based multi-sig for critical actions
- [ ] **AC-04**: Timelock is enforced on governance proposals before execution
- [ ] **AC-05**: Role-based access is clearly defined and documented (admin, issuer, custodian, oracle, auditor)
- [ ] **AC-06**: No single point of failure — admin key compromise impact is limited by governance
- [ ] **AC-07**: Pause/unpause permissions are clearly separated from other admin functions
- [ ] **AC-08**: Function visibility is minimized (`pub` only when necessary; prefer `pub(crate)`)

---

## Token & Asset Logic (10 items)

- [ ] **TK-01**: Token mint/burn functions are admin-only
- [ ] **TK-02**: Token transfers check compliance status before execution (compliance hook)
- [ ] **TK-03**: Transfer function validates `from != to` and `amount > 0`
- [ ] **TK-04**: Balance updates use safe arithmetic (no possibility of overflow/underflow)
- [ ] **TK-05**: Allowance system follows ERC-20 pattern with front-running protection (`approve` checks current allowance is zero)
- [ ] **TK-06**: Locked/frozen tokens cannot be transferred
- [ ] **TK-07**: Total supply is consistent across all mint/burn operations
- [ ] **TK-08**: Dividend claims update state before token transfer (Checks-Effects-Interactions)
- [ ] **TK-09**: Claimed dividends cannot be double-claimed (per user, per distribution tracking)
- [ ] **TK-10**: Multi-currency dividend distributions validate currency against supported list

---

## Compliance & KYC (7 items)

- [ ] **CP-01**: KYC status changes are admin-only
- [ ] **CP-02**: Blacklisted addresses cannot receive or send tokens
- [ ] **CP-03**: Whitelist enforcement is consistent across all transfer paths
- [ ] **CP-04**: Transfer limits (daily, per-transaction) are enforced and cannot be bypassed via splitting
- [ ] **CP-05**: Geographic/jurisdiction restrictions are enforced
- [ ] **CP-06**: PII (Personally Identifiable Information) is NOT stored on-chain — only hash commitments
- [ ] **CP-07**: Compliance status is checked at trade execution time, not just order placement

---

## Order Book & Secondary Market (8 items)

- [ ] **SM-01**: Order placement validates minimum order size, price precision, and asset pair
- [ ] **SM-02**: Order matching is deterministic and fair (price-time priority)
- [ ] **SM-03**: Self-trading prevention: buyer and seller must be different addresses (or compliance-checked)
- [ ] **SM-04**: Order cancellation only by order owner or admin
- [ ] **SM-05**: Settlement checks balances at fill time and reverts on insufficient funds
- [ ] **SM-06**: Maximum price deviation from oracle is enforced (`max_price_deviation_bps`)
- [ ] **SM-07**: Fees are correctly calculated and collected on fills
- [ ] **SM-08**: Order book state remains consistent after partial fills and cancellations

---

## Custody & Oracle (7 items)

- [ ] **CV-01**: Custody proof submission requires proper authorization (custodian role)
- [ ] **CV-02**: Proof hashes include asset_id, timestamp, custodian address, and nonce to prevent replay
- [ ] **CV-03**: Oracle registration/deregistration is admin-only
- [ ] **CV-04**: Multi-oracle consensus is required for critical data (median or threshold-based)
- [ ] **CV-05**: Oracle reputation scoring includes decay for inactive oracles
- [ ] **CV-06**: Custody attestations are verified before token minting for asset-backed tokens
- [ ] **CV-07**: Insurance verification and audit report storage are integrity-protected

---

## Testing & Fuzzing (5 items)

- [ ] **TF-01**: Unit tests cover all public functions with >90% code coverage
- [ ] **TF-02**: Integration tests cover cross-contract workflows (deploy → KYC → transfer → dividend → trade)
- [ ] **TF-03**: Fuzz/property-based tests cover asset class handlers and edge cases (boundary values)
- [ ] **TF-04**: Negative test cases: unauthorized access, invalid inputs, compliance violations
- [ ] **TF-05**: Gas consumption is benchmarked and regression-tested

---

## Deployment & Operations (5 items)

- [ ] **DO-01**: Deployment scripts are idempotent (skip already-deployed contracts)
- [ ] **DO-02**: Contract addresses are verified post-deployment (read-back confirmation)
- [ ] **DO-03**: Network configurations are separated (testnet, futurenet, mainnet)
- [ ] **DO-04**: Admin keys are managed with hardware wallets or multi-sig
- [ ] **DO-05**: Incident response plan is documented and tested (see `incident-response.md`)

---

## Documentation (3 items)

- [ ] **DC-01**: All public functions have Rust doc comments with parameter descriptions
- [ ] **DC-02**: Architecture diagram is up-to-date with current contract relationships
- [ ] **DC-03**: Known risks and mitigations are documented in threat model

---

**Total: 68 items**

---

## Scoring Guide

| Score | Grade | Action Required |
|-------|-------|----------------|
| 65-68 | A | Ready for production |
| 57-64 | B | Address gaps before mainnet |
| 45-56 | C | Requires significant remediation |
| < 45 | D | Not production-ready |

---

## How to Use

1. Run through every item before each release
2. Mark items as N/A only with written justification
3. Track open findings in GitHub issues with `security` label
4. Re-run checklist after major changes or quarterly
5. Share with external auditors as baseline scope
