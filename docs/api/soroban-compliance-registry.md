# Soroban Contract: Compliance Registry

Source: `src/compliance_registry.rs`

## Overview
The ComplianceRegistry contract tracks KYC / AML status and enforces transfer compliance rules.

It supports:
- initializing registry storage
- updating KYC status
- maintaining allow/block lists (whitelist / blacklist)
- configuring compliance rules
- checking compliance for transfers (read-only)
- enforcing transfer limits (stateful / consuming)
- outbound participant checks (read-only)

## Data types
- `ComplianceError`
- `KYCStatus`
- `TransferLimits`
- `ComplianceRule`

## Contract errors
Defined in `ComplianceError`.

## Public entry points

### `initialize(env: Env, auth: Address, admin: Address, kyc_required: bool, transfer_restrictions: bool)`
Initializes registry state.

**Auth:** `auth.require_auth()`

### `migrate(env: Env, auth: Address)`
Admin migration.

### `update_kyc_status(env: Env, auth: Address, user: Address, kyc_status: KYCStatus)`
Stores KYC status and emits `kyc_updated`.

### `get_kyc_status(env: Env, user: Address) -> KYCStatus`
Returns KYC status or a default unverified record.

### `add_to_blacklist(env: Env, auth: Address, address: Address, reason: Symbol)`
Adds to blacklist, emits `blacklisted`.

### `remove_from_blacklist(env: Env, auth: Address, address: Address)`
Removes from blacklist, emits `unblacklisted`.

### `add_to_whitelist(env: Env, auth: Address, address: Address)`
Adds to whitelist, emits `whitelisted`.

### `remove_from_whitelist(env: Env, auth: Address, address: Address)`
Removes from whitelist, emits `unwhitelisted`.

### `check_compliance(env: Env, from: Address, to: Address, amount: i128) -> bool`
Read-only compliance check for transfers.

Emits `compliance_check`.

### `check_outbound_participant(env: Env, participant: Address, amount: i128) -> bool`
Read-only outbound participant check.

Emits `outbound_compliance_check`.

### `check_transfer_limits(env: Env, user: Address, amount: i128) -> bool`
Consumes remaining limits (stateful) and emits `transfer_limit_check`.

### `set_transfer_limits(env: Env, auth: Address, user: Address, limits: TransferLimits)`
Sets transfer limits for a user.

### `get_compliance_rules(env: Env) -> Vec<ComplianceRule>`
Returns configured compliance rules.

### `update_compliance_rule(env: Env, auth: Address, rule: ComplianceRule)`
Updates or inserts a rule; emits `compliance_rule_updated`.

