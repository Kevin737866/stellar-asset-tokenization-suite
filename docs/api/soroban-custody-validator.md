# Soroban Contract: Custody Validator

Source: `src/custody_validator.rs`

## Overview

The **CustodyValidator** contract is the on-chain verification and attestation engine for custody of physical assets. It provides:

- **Oracle & Custodian Registration** — Register and manage trusted oracles and licensed custodians
- **Custody Attestations** — Submit and store proofs of physical asset custody
- **Proof Validation** — Verify proofs against oracle policies, freshness requirements, and insurance rules
- **Dispute Resolution** — Initiate and resolve disputes about attestations with bond requirements
- **Insurance Integration** — Register insurance policies and trigger claims
- **Alert Monitoring** — Detect expiring attestations and stale data

## Architecture

```
┌──────────────────────┐
│  CustodyValidator     │
└──────────┬───────────┘
           │
    ┌──────┼──────┬──────────┐
    │      │      │          │
    ▼      ▼      ▼          ▼
┌──────┐ ┌────┐ ┌────────┐ ┌──────────┐
│Oracle│ │Cust│ │Attest  │ │Dispute   │
│Mgmt  │ │Mgmt│ │& Proof │ │Resolution│
└──────┘ └────┘ └────────┘ └──────────┘
```

## Data Types

### `CustodyError`
| Variant | Code | Description |
|---------|------|-------------|
| `AlreadyInitialized` | 601 | Already initialized |
| `NotInitialized` | 602 | Not yet initialized |
| `InvalidProof` | 603 | Proof validation failed |
| `OracleOffline` | 604 | Oracle is marked offline |
| `VerificationFailed` | 605 | Verification failed |
| `AssetNotRegistered` | 606 | Asset not registered |
| `StaleData` | 607 | Data exceeds freshness threshold |
| `InvalidSignature` | 608 | Cryptographic signature invalid |
| `DisputeAlreadyExists` | 609 | Duplicate dispute |
| `InsufficientBond` | 610 | Bond amount too low |
| `InvalidDisputeStatus` | 611 | Invalid dispute state transition |
| `BondNotRefundable` | 612 | Bond cannot be refunded |
| `CustodianNotWhitelisted` | 613 | Custodian not registered |
| `InvalidVerificationType` | 614 | Unknown verification type |
| `ProofHashMismatch` | 615 | Proof hash doesn't match |
| `AttestationExpired` | 616 | Attestation past expiry |
| `MultiSigThresholdNotMet` | 617 | Multi-sig requirement not met |
| `InvalidMerkleProof` | 618 | Merkle proof invalid |
| `ZKVerificationFailed` | 619 | ZK proof invalid |
| `InsuranceClaimFailed` | 620 | Insurance claim processing failed |
| `AttestationNotFound` | 621 | Attestation not found |
| `OracleNotFound` | 622 | Oracle not found |
| `Unauthorized` | 623 | Caller not authorized |

### `CustodyAttestation`
| Field | Type | Description |
|-------|------|-------------|
| `attestation_id` | `u64` | Unique attestation ID |
| `asset_id` | `Address` | Asset token address |
| `custodian` | `Address` | Custodian address |
| `oracle` | `Address` | Verifying oracle |
| `verification_type` | `Symbol` | Type of verification |
| `proof_hash` | `BytesN<32>` | Hash of the custody proof |
| `value` | `i128` | Attested asset value |
| `timestamp` | `u64` | Attestation timestamp |
| `expiry` | `u64` | Expiry timestamp |
| `is_valid` | `bool` | Validity flag |
| `signatures` | `Vec<BytesN<64>>` | Multi-sig signatures |

### `CustodianRegistry`
| Field | Type | Description |
|-------|------|-------------|
| `custodian_address` | `Address` | Custodian address |
| `name` | `Symbol` | Custodian name |
| `jurisdiction` | `Symbol` | Regulatory jurisdiction |
| `license_number` | `Symbol` | License identifier |
| `verification_types` | `Vec<Symbol>` | Supported verification types |
| `bond_required` | `i128` | Required bond amount |
| `bond_balance` | `i128` | Current bond balance |
| `insurance_provider` | `Symbol` | Insurance provider name |
| `is_active` | `bool` | Active status |
| `total_attestations` | `u64` | Attestation count |
| `successful_verifications` | `u64` | Success count |
| `failed_verifications` | `u64` | Failure count |
| `disputes_resolved` | `u64` | Resolved disputes count |

### `OracleInfo`
| Field | Type | Description |
|-------|------|-------------|
| `oracle_address` | `Address` | Oracle address |
| `name` | `Symbol` | Oracle name |
| `jurisdiction` | `Symbol` | Jurisdiction |
| `is_active` | `bool` | Online/offline status |
| `reputation_score` | `u32` | Trust score (0-100) |
| `total_verifications` | `u64` | Verification count |

### `VerificationTypeConfig`
| Field | Type | Description |
|-------|------|-------------|
| `verification_type` | `Symbol` | Type identifier |
| `required_oracles` | `u32` | Min oracle count |
| `freshness_seconds` | `u64` | Max data age |
| `requires_multi_sig` | `bool` | Multi-sig requirement |
| `supports_zk` | `bool` | ZK proof support |

### `DisputeRecord`
| Field | Type | Description |
|-------|------|-------------|
| `dispute_id` | `u64` | Unique dispute ID |
| `attestation_id` | `u64` | Disputed attestation |
| `challenger` | `Address` | Who initiated |
| `reason` | `Symbol` | Dispute reason |
| `bond_amount` | `i128` | Bond posted |
| `evidence_hash` | `BytesN<32>` | Evidence |
| `status` | `Symbol` | "pending", "resolved", "rejected" |
| `resolution` | `Symbol` | Resolution type |
| `penalty_amount` | `i128` | Penalty applied |

---

## Public Entry Points

### `initialize(env, auth, admin, oracle_addresses)`

Initializes custody validator storage with initial oracle set.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Authorizing address |
| `admin` | `Address` | Admin address |
| `oracle_addresses` | `Vec<Address>` | Initial oracle addresses |

**Auth:** `auth.require_auth()`

**Returns:** Nothing

**Errors:**
- `AlreadyInitialized`

**Example:**
```rust
let mut oracles = Vec::new(&env);
oracles.push_back(oracle_addr_1);
oracles.push_back(oracle_addr_2);

let cv_id = env.register_contract(None, CustodyValidator);
let cv = CustodyValidatorClient::new(&env, &cv_id);
cv.initialize(&admin, &admin, &oracles);
```

---

### `migrate(env, auth)`

Admin storage migration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

---

### `register_oracle(env, auth, oracle_address, name, jurisdiction)`

Registers a new oracle with metadata.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `oracle_address` | `Address` | Oracle's address |
| `name` | `Symbol` | Oracle name |
| `jurisdiction` | `Symbol` | Jurisdiction code |

**Auth:** Admin check

---

### `register_custodian(env, auth, custodian_address, name, jurisdiction, license_number, verification_types, bond_required, insurance_provider)`

Registers a licensed custodian with supported verification types and bond requirements.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `custodian_address` | `Address` | Custodian's address |
| `name` | `Symbol` | Custodian name |
| `jurisdiction` | `Symbol` | Regulatory jurisdiction |
| `license_number` | `Symbol` | License ID |
| `verification_types` | `Vec<Symbol>` | Supported verification types |
| `bond_required` | `i128` | Required stake amount |
| `insurance_provider` | `Symbol` | Insurance provider |

**Auth:** Admin check

---

### `setup_verification_types(env, auth)`

Populates default verification type configurations (physical audit, vault inspection, insurance check, etc.).

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

---

### `submit_attestation(env, attestation) -> u64`

Validates and stores a custody attestation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `attestation` | `CustodyAttestation` | Attestation to submit |

**Returns:** `u64` — New attestation ID

**Errors:**
- `CustodianNotWhitelisted`
- `InvalidVerificationType`
- `InvalidProof`
- `ProofHashMismatch`

**Events:**
- `attestation_submitted` with topics `(attestation_id, asset_id, custodian)`

**Example:**
```rust
let attestation = CustodyAttestation {
    attestation_id: 0, // contract assigns
    asset_id: gold_token_address,
    custodian: vault_custodian,
    oracle: trusted_oracle,
    verification_type: Symbol::new(&env, "physical_audit"),
    proof_hash: proof_hash,
    value: 100_000,
    timestamp: env.ledger().timestamp(),
    expiry: env.ledger().timestamp() + 86400 * 30,
    is_valid: true,
    signatures: sigs,
};
let attestation_id = cv.submit_attestation(&attestation);
```

---

### `dispute_attestation(env, attestation_id, challenger, reason, bond_amount, evidence_hash) -> u64`

Initiates a dispute against a custody attestation. Requires posting a bond.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `attestation_id` | `u64` | Attestation to dispute |
| `challenger` | `Address` | Dispute initiator |
| `reason` | `Symbol` | Dispute reason |
| `bond_amount` | `i128` | Bond posted |
| `evidence_hash` | `BytesN<32>` | Evidence |

**Returns:** `u64` — Dispute ID

**Errors:**
- `AttestationNotFound`
- `DisputeAlreadyExists`
- `InsufficientBond`

---

### `resolve_dispute(env, auth, dispute_id, resolution, penalty_amount)`

Resolves a pending dispute and applies penalties if appropriate.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `dispute_id` | `u64` | Dispute to resolve |
| `resolution` | `Symbol` | Resolution type |
| `penalty_amount` | `i128` | Penalty to apply |

**Auth:** Admin check

**Errors:**
- `InvalidDisputeStatus` — Not in "pending" state

---

### `validate_proof(env, proof) -> bool`

Read-only validation of a custody proof against oracle and insurance rules.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `proof` | `CustodyProof` | Proof to validate |

**Returns:** `bool` — `true` if valid

**Checks:**
- Oracle is active
- Freshness threshold met
- Multi-sig requirements (if applicable)
- Merkle/ZK proofs (if applicable)

---

### `get_attestation(env, attestation_id) -> CustodyAttestation`

Returns attestation details.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `attestation_id` | `u64` | Attestation ID |

**Returns:** `CustodyAttestation`

**Errors:**
- `AttestationNotFound`

---

### `get_latest_attestation(env, asset_id) -> Option<CustodyAttestation>`

Returns the most recent valid attestation for an asset.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `asset_id` | `Address` | Asset token address |

**Returns:** `Option<CustodyAttestation>`

---

### `get_dispute(env, dispute_id) -> DisputeRecord`

Returns dispute record details.

| Parameter | Type | Description |
|-----------|------|-------------|
| `dispute_id` | `u64` | Dispute ID |

**Returns:** `DisputeRecord`

---

### `get_custodian_info(env, custodian_address) -> CustodianRegistry`

Returns custodian registration details.

| Parameter | Type | Description |
|-----------|------|-------------|
| `custodian_address` | `Address` | Custodian's address |

**Returns:** `CustodianRegistry`

---

### `list_active_custodians(env) -> Vec<CustodianRegistry>`

Returns all active custodians.

**Returns:** `Vec<CustodianRegistry>`

---

### `get_verification_config(env, verification_type) -> VerificationTypeConfig`

Returns configuration for a verification type.

| Parameter | Type | Description |
|-----------|------|-------------|
| `verification_type` | `Symbol` | Type to query |

**Returns:** `VerificationTypeConfig`

---

### `trigger_insurance_claim(env, auth, asset_id, claim_reason, evidence_hash)`

Triggers an insurance claim for a registered asset.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `asset_id` | `Address` | Asset to claim on |
| `claim_reason` | `Symbol` | Claim reason |
| `evidence_hash` | `BytesN<32>` | Supporting evidence |

**Auth:** Admin check

---

### `setup_insurance_integration(env, auth, asset_id, insurance)`

Creates or updates an insurance integration record for an asset.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `asset_id` | `Address` | Asset token address |
| `insurance` | `InsuranceIntegration` | Insurance configuration |

---

### `get_custody_alerts(env) -> Vec<(Address, Symbol)>`

Returns alerts for invalid, expiring, or soon-to-expire attestations.

**Returns:** `Vec<(Address, Symbol)>` — Alert pairs

---

### `get_oracle_info(env, oracle_address) -> OracleInfo`

Returns oracle details.

**Returns:** `OracleInfo`

---

### `list_active_oracles(env) -> Vec<OracleInfo>`

Returns all active oracles.

**Returns:** `Vec<OracleInfo>`

---

### `update_oracle_status(env, auth, oracle_address, is_active)`

Sets oracle online/offline status.

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `Address` | Admin address |
| `oracle_address` | `Address` | Oracle address |
| `is_active` | `bool` | New status |

---

### `update_oracle_reputation(env, auth, oracle_address, reputation_score)`

Updates oracle reputation score (0-100).

---

### `update_config(env, auth, config)`

Updates global validation configuration.

---

### `get_validation_stats(env) -> Map<Symbol, u64>`

Returns validation statistics: total proofs, valid, expired, oracle count.

---

## Event Catalog

| Event | Topics | Emitted By |
|-------|--------|------------|
| `initialized` | `admin` | `initialize()` |
| `migrated` | `old_version, new_version` | `migrate()` |
| `attestation_submitted` | `attestation_id, asset_id, custodian` | `submit_attestation()` |
| `dispute_initiated` | `dispute_id, attestation_id, challenger` | `dispute_attestation()` |
| `dispute_resolved` | `dispute_id, resolution, penalty` | `resolve_dispute()` |
| `oracle_status_changed` | `oracle_address, is_active` | `update_oracle_status()` |
| `insurance_claim_triggered` | `asset_id, claim_reason` | `trigger_insurance_claim()` |

## Cross-Contract Interactions

```
CustodyValidator
    │
    ├──submit_attestation()──▶ Oracle validation
    │                         Multi-sig verification
    │                         Insurance policy check
    │
    ├──validate_proof()──▶ Freshness check
    │                     Merkle/ZK proof verification
    │
    └──resolve_dispute()──▶ Bond slashing
                           Custodian reputation update
```
