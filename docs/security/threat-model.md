# Threat Model — Stellar RWA Tokenization Suite

> Last updated: 2026-07-27  
> Scope: All Soroban contracts in `src/` — AssetFactory, RwaToken, ComplianceRegistry, DividendDistributor, SecondaryMarket, CustodyValidator

---

## 1. System Overview

The Stellar RWA Tokenization Suite enables on-chain issuance, compliance-controlled transfer, dividend distribution, secondary trading, and custody verification of real-world assets on the Stellar network via Soroban smart contracts.

### 1.1 Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Off-Chain Layer                            │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Custodian│  │  Oracle   │  │ Auditor  │  │  Asset Issuer  │  │
│  │ (proofs) │  │(price fds)│  │(reports) │  │  (admin ops)   │  │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └───────┬────────┘  │
└───────┼──────────────┼─────────────┼────────────────┼───────────┘
        │              │             │                │
┌───────┴──────────────┴─────────────┴────────────────┴───────────┐
│                     On-Chain Contracts (Soroban)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │
│  │Custody   │ │Compliance│ │RWA Token │ │Asset Factory      │   │
│  │Validator │←┤Registry  │←┤(ERC-like)│←┤(deployment hub)   │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───────────────────┘   │
│       │            │            │                                 │
│  ┌────┴────────────┴────────────┴──────────────────────────┐    │
│  │               Secondary Market (order book)              │    │
│  └──────────────────────────┬──────────────────────────────┘    │
│                             │                                    │
│  ┌──────────────────────────┴──────────────────────────────┐    │
│  │            Dividend Distributor (multi-currency)         │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Assets

| Asset | Location | Sensitivity | Impact if Compromised |
|-------|----------|-------------|----------------------|
| Token balances | RwaToken contract storage | High | Theft / unauthorized mint |
| KYC/AML data | ComplianceRegistry | High | Regulatory violation, sanctions risk |
| Custody proofs | CustodyValidator | High | Fraudulent asset backing |
| Order book state | SecondaryMarket | Medium | Market manipulation, fund loss |
| Dividend records | DividendDistributor | Medium | Misappropriation of yield |
| Admin keys / addresses | All contracts | Critical | Full contract compromise |
| Oracle addresses | CustodyValidator, SecondaryMarket | High | Price/custody data manipulation |
| Governance config | shared_governance.rs, shared_admin.rs | Critical | Unauthorized admin actions |

---

## 3. Actors

| Actor | Role | Trust Level |
|-------|------|-------------|
| **Admin (single/multi-sig)** | Deploy, pause, upgrade, manage KYC | Fully trusted (but constrained by governance) |
| **Asset Issuer** | Deploy new tokens via factory | Trusted (verified off-chain) |
| **Custodian** | Submit custody attestations | Semi-trusted (oracle-backed) |
| **Oracle** | Provide price feeds / verification data | Semi-trusted (reputation-scored) |
| **Investor / Token Holder** | Hold, transfer, trade, claim dividends | Untrusted |
| **Auditor** | Review custody proofs | Trusted third party |
| **Governance Participant** | Propose, approve, execute changes | Varies (token-weighted) |
| **Attacker (external)** | Malicious actor | Untrusted / hostile |

---

## 4. Trust Boundaries

```
┌──────────────────────┐       ┌──────────────────────┐
│   Off-Chain World    │       │   On-Chain (Soroban) │
│                      │       │                      │
│  • Custodian systems │──TB1──│ • CustodyValidator   │
│  • Oracle APIs       │──TB2──│ • Price resolution   │
│  • User wallets      │──TB3──│ • All contracts      │
│  • Admin interfaces  │──TB4──│ • Admin functions     │
│  • Legal/regulatory  │       │ • ComplianceRegistry │
└──────────────────────┘       └──────────────────────┘
```

**TB1 (Custodian → CustodyValidator):** Proofs may be forged if custodian is compromised. Mitigated by oracle corroboration and reputation scoring.  
**TB2 (Oracle → Contracts):** Oracles may be Sybil-attacked. Mitigated by multi-oracle consensus and stake requirements.  
**TB3 (User → Contracts):** All user input is untrusted. Mitigated by input validation, authorization checks, and compliance gating.  
**TB4 (Admin → Contracts):** Single admin key compromise = full compromise. Mitigated by governance module (multi-sig, timelock).

---

## 5. Threat Enumeration by Contract

### 5.1 AssetFactory (`src/asset_factory.rs`)

| ID | Threat | Severity | Vector | Mitigation |
|----|--------|----------|--------|------------|
| AF-01 | Unauthorized token deployment | High | Missing admin check | `require_admin()` enforced on all deployment functions |
| AF-02 | Duplicate asset symbol | Medium | Symbol collision in registry | Symbol uniqueness check in storage |
| AF-03 | Deployment with malicious compliance registry address | Critical | Attacker-supplied address | Whitelist of approved registry contracts |
| AF-04 | Integer overflow in supply/token params | High | Unbounded inputs | Use `checked_*` operations; validate ranges |
| AF-05 | Metadata injection (excessive size) | Medium | Large metadata strings | Enforce max metadata length (e.g., 256 bytes per field) |

### 5.2 RwaToken (`src/rwa_token.rs`)

| ID | Threat | Severity | Vector | Mitigation |
|----|--------|----------|--------|------------|
| RT-01 | Unauthorized mint/burn | Critical | Missing or weak admin gating | `require_admin()` enforced; governance threshold |
| RT-02 | Balance overflow/underflow | Critical | Unchecked arithmetic | Use `checked_add`/`checked_sub`; Soroban SDK safe math |
| RT-03 | Transfer circumventing compliance | High | Transfer before compliance check | ComplianceRegistry check on every transfer (hook) |
| RT-04 | Token locking bypass | Medium | Incorrect lock period logic | Validate lock timestamps; reject transfers during lock |
| RT-05 | Reentrancy via transfer hook | Critical | External call during transfer | Checks-Effects-Interactions pattern; Soroban single-threaded VM mitigates |
| RT-06 | Frozen token bypass | High | Transfer when paused | Pause flag checked at top of transfer/approve |
| RT-07 | Approval race condition | Medium | Front-run approval change | Standard ERC-20 pattern: require `allowance == 0 || amount == 0` |

### 5.3 ComplianceRegistry (`src/compliance_registry.rs`)

| ID | Threat | Severity | Vector | Mitigation |
|----|--------|----------|--------|------------|
| CR-01 | Unauthorized KYC status change | Critical | Non-admin sets KYC | Admin-only gating with governance |
| CR-02 | Blacklist bypass via address reuse | High | New address evades blacklist | Tie KYC to identity hash, not just address |
| CR-03 | Transfer limit evasion | Medium | Split transfers | Daily limit enforcement; aggregate tracking |
| CR-04 | Jurisdiction geo-bypass | Medium | VPN/proxy to approved region | Rely on KYC attestation; not purely IP-based |
| CR-05 | Denial of service via mass registration | Low | Spam KYC registrations | Rate limiting (off-chain); gas costs deter |
| CR-06 | Compliance data leak | Low | On-chain KYC data exposure | Store only hash commitments on-chain; keep PII off-chain |

### 5.4 DividendDistributor (`src/dividend_distributor.rs`)

| ID | Threat | Severity | Vector | Mitigation |
|----|--------|----------|--------|------------|
| DD-01 | Unauthorized dividend creation | High | Non-admin creates distribution | Admin-only gating |
| DD-02 | Double-claim attack | Critical | Claim same distribution twice | Claimed flag per (user, distribution_id) |
| DD-03 | Claim after deadline | Medium | Late claims | Deadline comparison before claim execution |
| DD-04 | Incorrect pro-rata calculation | High | Precision loss in division | Use 18-decimal fixed-point; multiply before divide |
| DD-05 | Reentrancy on claim | Critical | Cross-contract call during payment | State update before token transfer |
| DD-06 | Unsupported currency attack | Medium | Distribute in unlisted currency | Validate currency against `supported_currencies` |

### 5.5 SecondaryMarket (`src/secondary_market.rs`)

| ID | Threat | Severity | Vector | Mitigation |
|----|--------|----------|--------|------------|
| SM-01 | Front-running orders | High | Mempool observation | Acceptable slippage params; time-weighted avg price |
| SM-02 | Order book manipulation (spoofing) | High | Place/cancel large orders | Fee on cancellation; minimum order lifetime |
| SM-03 | Price oracle manipulation | Critical | Single oracle feed | Multi-oracle median; max deviation threshold |
| SM-04 | Self-trading / wash trading | Medium | Same-entity orders | Compliance check on both sides; KYC requirement |
| SM-05 | Order fill at stale price | High | Price deviation between order and fill | `max_price_deviation_bps` check at settlement |
| SM-06 | Settlement failure (insufficient balance) | High | Balance changed between order and fill | Check balance at fill time; revert on failure |

### 5.6 CustodyValidator (`src/custody_validator.rs`)

| ID | Threat | Severity | Vector | Mitigation |
|----|--------|----------|--------|------------|
| CV-01 | Forged custody proof | Critical | Custodian submits false attestation | Multi-oracle verification; cryptographic proof hash |
| CV-02 | Oracle collusion | Critical | Multiple oracles conspire | Stake/slash mechanism; reputation decay |
| CV-03 | Replay of stale attestation | High | Old proof re-submitted | Timestamp + nonce in proof hash |
| CV-04 | Unauthorized oracle registration | High | Attacker adds malicious oracle | Admin-only oracle management |
| CV-05 | Proof hash collision | Medium | Weak hashing | Use cryptographic hash (SHA-256); include asset_id, timestamp, custodian |
| CV-06 | Denial of custody (asset not backed) | Critical | Token issued without backing | Require custody proof before token minting |

---

## 6. Attack Vectors (Cross-Contract)

### 6.1 Reentrancy
- **Risk:** Low-Medium. Soroban uses a single-threaded VM without external contract calls in the traditional EVM sense. However, cross-contract invocations within the suite could create reentrancy-like patterns.
- **Mitigation:** Follow Checks-Effects-Interactions; update state before invoking other contracts.

### 6.2 Front-Running
- **Risk:** Medium. Stellar transactions are visible in the mempool before inclusion.
- **Mitigation:** Slippage tolerance parameters; commit-reveal schemes for sensitive operations.

### 6.3 Integer Overflow/Underflow
- **Risk:** Low. Soroban SDK provides safe arithmetic by default in Rust.
- **Mitigation:** Use `checked_*` operations explicitly; avoid `unwrap()` on arithmetic.

### 6.4 Denial of Service (DoS)
- **Risk:** Medium. Contracts with unbounded loops over storage could hit gas limits.
- **Mitigation:** Pagination; bounded iteration; gas estimation before execution.

### 6.5 Access Control
- **Risk:** High. Single-admin pattern is a single point of failure.
- **Mitigation:** Governance module (multi-sig, threshold, timelock) — see `shared_governance.rs`.

### 6.6 Oracle Manipulation
- **Risk:** High. Price and custody data depend on external oracles.
- **Mitigation:** Multi-oracle consensus; maximum deviation bounds; reputation staking.

---

## 7. Residual Risk Assessment

| Risk | Inherent | Mitigation Strength | Residual | Notes |
|------|----------|--------------------|----------|-------|
| Admin key compromise | Critical | Medium (governance WIP) | High | Governance/timelock partially implemented |
| Oracle manipulation | High | Medium (multi-oracle) | Medium | Oracle staking not yet implemented |
| Forged custody proofs | Critical | Medium (multi-oracle verify) | Medium | Cryptographic proof attestation needed |
| Front-running | Medium | Low (slippage only) | Medium | No commit-reveal yet |
| Reentrancy | Low | High (Soroban VM) | Low | Soroban inherently resistant |
| Integer overflow | Low | High (Rust safe math) | Very Low | |
| Compliance data leak | Medium | Medium (hash commitment) | Low | PII kept off-chain |
| DoS via iteration | Medium | Medium (pagination) | Medium | Some unbounded loops remain |

---

## 8. Security Recommendations (Prioritized)

1. **[P0]** Complete governance module with multi-sig, threshold, and timelock for all admin functions
2. **[P0]** Implement cryptographic custody proof verification (Merkle proofs, zk-attestations)
3. **[P1]** Add oracle staking and slashing mechanism
4. **[P1]** Implement commit-reveal for large orders to prevent front-running
5. **[P2]** Add circuit breakers for extreme price movements
6. **[P2]** Implement formal verification for token transfer and settlement logic
7. **[P3]** Regular external security audits (bi-annual)
8. **[P3]** Bug bounty program launch

---

## 9. References

- [OWASP Smart Contract Top 10](https://owasp.org/www-project-smart-contract-top-10/)
- [Soroban Security Best Practices](https://developers.stellar.org/docs/smart-contracts/security)
- [SDF Security Audits](https://stellar.org/security)
