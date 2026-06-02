# Soroban Contract: Custody Validator

Source: `src/custody_validator.rs`

## Overview
CustodyValidator is an on-chain custody verification registry and attestation engine.

It supports:
- registering oracles and custodians
- configuring verification types and validation config
- submitting custody attestations and verifying them against custodian/oracle policy
- initiating and resolving disputes about attestations
- validating proofs (read-only) against freshness and oracle/insurance rules
- triggering insurance claim integrations
- reading alerts, oracle/custodian info, and validation stats

## Data types
- `CustodyError`
- `StorageKey`
- `CustodyAttestation`
- `CustodianRegistry`
- `CustodyProof`
- `OracleInfo`
- `DisputeRecord`
- `VerificationTypeConfig`
- `InsuranceIntegration`
- `AssetRegistration`
- `ValidationConfig`

## Public entry points

### `initialize(env: Env, auth: Address, admin: Address, oracle_addresses: Vec<Address>)`
Initializes config and storage collections.

### `migrate(env: Env, auth: Address)`
Admin migration.

### `register_oracle(env: Env, auth: Address, oracle_address: Address, name: Symbol, jurisdiction: Symbol)`
Adds oracle metadata and initializes oracle info.

### `register_custodian(env: Env, auth: Address, custodian_address: Address, name: Symbol, jurisdiction: Symbol, license_number: Symbol, verification_types: Vec<Symbol>, bond_required: i128, insurance_provider: Symbol)`
Adds a custodian record.

### `setup_verification_types(env: Env, auth: Address)`
Populates default verification type configs.

### `resolve_dispute(env: Env, auth: Address, dispute_id: u64, resolution: Symbol, penalty_amount: i128)`
Resolves a dispute (pending only) and updates custodian stats.

### `submit_attestation(env: Env, attestation: CustodyAttestation) -> u64`
Validates and stores a custody attestation.

### `dispute_attestation(env: Env, attestation_id: u64, challenger: Address, reason: Symbol, bond_amount: i128, evidence_hash: BytesN<32>) -> u64`
Initiates a dispute about an attestation.

### `validate_proof(env: Env, proof: CustodyProof) -> bool`
Read-only validation of a proof.

### `get_attestation(env: Env, attestation_id: u64) -> CustodyAttestation`
Returns attestation details.

### `get_latest_attestation(env: Env, asset_id: Address) -> Option<CustodyAttestation>`
Returns latest valid attestation (within scanning logic).

### `get_dispute(env: Env, dispute_id: u64) -> DisputeRecord`
Returns dispute record.

### `get_custodian_info(env: Env, custodian_address: Address) -> CustodianRegistry`
Returns custodian record.

### `list_active_custodians(env: Env) -> Vec<CustodianRegistry>`
Lists active custodians.

### `get_verification_config(env: Env, verification_type: Symbol) -> VerificationTypeConfig`
Returns configuration for a verification type.

### `trigger_insurance_claim(env: Env, auth: Address, asset_id: Address, claim_reason: Symbol, evidence_hash: BytesN<32>)`
Triggers insurance integration based on stored `InsuranceIntegration`.

### `setup_insurance_integration(env: Env, auth: Address, asset_id: Address, insurance: InsuranceIntegration)`
Creates/updates an insurance integration record.

### `get_custody_alerts(env: Env) -> Vec<(Address, Symbol)>`
Returns invalid / expiring / soon-to-expire attestation alerts.

### `get_oracle_info(env: Env, oracle_address: Address) -> OracleInfo`
Returns oracle info.

### `list_active_oracles(env: Env) -> Vec<OracleInfo>`
Lists active oracles.

### `update_oracle_status(env: Env, auth: Address, oracle_address: Address, is_active: bool)`
Updates oracle availability.

### `update_oracle_reputation(env: Env, auth: Address, oracle_address: Address, reputation_score: u32)`
Updates oracle reputation.

### `update_config(env: Env, auth: Address, config: ValidationConfig)`
Updates global validation config.

### `get_asset_registration(env: Env, asset_address: Address) -> AssetRegistration`
Returns asset registration.

### `get_validation_stats(env: Env) -> Map<Symbol, u64>`
Returns counts for proofs/oracles and valid vs expired.

