# Soroban Contract: RWA Token

Source: `src/rwa_token.rs`

## Overview
The RWAToken contract implements the core token behaviors and integrates with:
- `ComplianceRegistry` for transfer compliance checks

It supports:
- mint/burn
- transfer with compliance + pause/freeze
- token locking for voting power
- admin pause/unpause and freeze/unfreeze

## Data types
- `RWATokenError`
- `TokenInfo`
- `Balance`
- `TransferRestriction` (type exists, not directly used by public entrypoints)
- `LockSlot`

## Public entry points

### `initialize(env: Env, auth: Address, name: Symbol, symbol: Symbol, total_supply: i128, decimals: u32, asset_type: Symbol, metadata: Map<Symbol, String>, compliance_registry: Address, dividend_distributor: Address)`
Initializes token state and mints `total_supply` to the admin (`auth`).

**Auth:** `auth.require_auth()`

**Panics / Errors:**
- `AlreadyInitialized`
- `InvalidAmount` (if `total_supply <= 0` or `decimals > 18`)

### `migrate(env: Env, auth: Address)`
Storage migration for admin.

### `mint(env: Env, auth: Address, to: Address, amount: i128)`
Mints additional supply to `to`.

**Auth:** admin authorization check (`assert_admin` + `auth`)

**Panics:**
- `InvalidAmount` (amount <= 0)
- `TokenPaused` if paused

### `burn(env: Env, from: Address, amount: i128)`
Burns tokens from `from`.

**Panics:**
- `InvalidAmount` (amount <= 0)
- `TokenPaused` if paused
- `InsufficientBalance`
- `ComplianceCheckFailed` (via `check_transfer_compliance`)

### `transfer(env: Env, from: Address, to: Address, amount: i128)`
Transfers spendable tokens (unlocked amount only).

**Auth:** `from.require_auth()`

**Checks:**
- version check
- paused or frozen => `TransferPaused`
- compliance => `ComplianceCheckFailed`
- spendable balance check (unlocked only)

### `get_token_info(env: Env) -> TokenInfo`
Returns token metadata.

### `get_balance(env: Env, address: Address) -> Balance`
Returns on-chain balance.

### `lock_tokens(env: Env, auth: Address, owner: Address, amount: i128, lock_period: u64)`
Locks tokens for `lock_period` and increases `voting_power`.

**Auth:** `auth.require_auth()` and `auth == owner`

### `unlock_tokens(env: Env, auth: Address, owner: Address, amount: i128)`
Unlocks locked tokens and decreases voting power.

**Auth:** `auth.require_auth()` and `auth == owner`

### `pause(env: Env, auth: Address)` / `unpause(env: Env, auth: Address)`
Pauses/unpauses transfers.

### `freeze(env: Env, auth: Address)` / `unfreeze(env: Env, auth: Address)`
Freezes/unfreezes transfers.

### Read-only compliance helpers (private)
- `check_transfer_compliance`
- `check_outbound_compliance`


