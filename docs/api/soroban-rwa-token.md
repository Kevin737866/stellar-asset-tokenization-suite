# Soroban Contract: RWA Token

Source: `src/rwa_token.rs`

## Overview

The **RWAToken** contract is the core token implementation for all Real-World Assets. It implements a Stellar-compatible token with advanced features:

- **Mint/Burn** — Admin-controlled supply management
- **Transfer with Compliance** — Every transfer is validated against the `ComplianceRegistry`
- **Lock/Unlock** — Token locking for governance voting power
- **Pause/Freeze** — Admin emergency controls
- **Token Info** — Comprehensive on-chain metadata

## Architecture

```
             ┌──────────────┐
             │   RWAToken    │
             └──────┬───────┘
                    │
       ┌────────────┼────────────┐
       │            │            │
       ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────────────┐
│  Mint/   │ │ Transfer │ │  Lock/Unlock     │
│  Burn    │ │(+compliance)│ │  (voting power) │
└──────────┘ └────┬─────┘ └──────────────────┘
                  │
                  ▼
         ┌──────────────────┐
         │ ComplianceRegistry│
         │ (KYC/Blacklist/   │
         │  Transfer Limits) │
         └──────────────────┘
```

## Data Types

### `RWATokenError`
| Variant | Code | Description |
|---------|------|-------------|
| `AlreadyInitialized` | 1 | Token already initialized |
| `NotInitialized` | 2 | Token not yet initialized |
| `TokenInfoNotFound` | 3 | Token info storage missing |
| `TransferPaused` | 4 | Transfers are paused |
| `AssetFrozen` | 5 | Asset is frozen |
| `KYCNotVerified` | 6 | KYC required for operation |
| `TransferRestriction` | 7 | Transfer exceeds restrictions |
| `InvalidAmount` | 8 | Amount is zero or negative |
| `InsufficientBalance` | 9 | Not enough unlocked tokens |
| `Unauthorized` | 10 | Caller not authorized |
| `ComplianceCheckFailed` | 11 | Compliance validation failed |

### `TokenInfo`
| Field | Type | Description |
|-------|------|-------------|
| `name` | `Symbol` | Token name |
| `symbol` | `Symbol` | Ticker symbol |
| `total_supply` | `i128` | Current total supply |
| `decimals` | `u32` | Decimal places |
| `asset_type` | `Symbol` | Asset class string |
| `is_paused` | `bool` | Transfer pause status |
| `is_frozen` | `bool` | Freeze status |
| `metadata` | `Map<Symbol, String>` | Key-value metadata |
| `compliance_registry` | `Address` | Compliance contract |
| `dividend_distributor` | `Address` | Dividend contract |
| `version` | `u32` | Storage version |

### `Balance`
| Field | Type | Description |
|-------|------|-------------|
| `amount` | `i128` | Spendable (unlocked) balance |
| `locked_amount` | `i128` | Total locked tokens |
| `voting_power` | `i128` | Voting power derived from locks |

### `LockSlot`
| Field | Type | Description |
|-------|------|-------------|
| `amount` | `i128` | Locked amount |
| `unlock_time` | `u64` | Timestamp when lock expires |

---

## Public Entry Points

### `initialize(env, auth, name, symbol, total_supply, decimals, asset_type, metadata, compliance_registry, dividend_distributor)`

Initializes token state and mints `total_supply` to the admin (`auth`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address (signs + receives minted supply) |
| `name` | `Symbol` | Token name |
| `symbol` | `Symbol` | Ticker symbol |
| `total_supply` | `i128` | Initial supply (> 0) |
| `decimals` | `u32` | Decimal precision (max 18) |
| `asset_type` | `Symbol` | Asset class identifier |
| `metadata` | `Map<Symbol, String>` | Arbitrary metadata |
| `compliance_registry` | `Address` | Compliance contract address |
| `dividend_distributor` | `Address` | Dividend distributor contract |

**Auth:** `auth.require_auth()`

**Returns:** Nothing

**Errors:**
- `AlreadyInitialized` — Already initialized
- `InvalidAmount` — `total_supply <= 0` or `decimals > 18`

**Events:**
- `initialized` with topics `(name, symbol, total_supply)`

**Example:**
```rust
let token_id = env.register_contract(None, RWAToken);
let token = RWATokenClient::new(&env, &token_id);
token.initialize(
    &admin,
    &Symbol::new(&env, "ManhattanOffice"),
    &Symbol::new(&env, "MNO"),
    &1_000_000i128,
    &6u32,
    &Symbol::new(&env, "real_estate"),
    &Map::new(&env),
    &compliance_id,
    &dividend_distributor_id,
);
```

---

### `migrate(env, auth)`

Storage migration for admin. Upgrades version through any defined migration steps.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

**Auth:** Admin check

**Returns:** Nothing

**Errors:**
- `Unauthorized` — Caller is not admin

**Events:**
- `migrated` with topics `(old_version, new_version)`

---

### `mint(env, auth, to, amount)`

Mints additional supply to `to`. Increases both the recipient's balance and `total_supply`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `to` | `Address` | Recipient address |
| `amount` | `i128` | Amount to mint (> 0) |

**Auth:** Admin authorization

**Returns:** Nothing

**Errors:**
- `InvalidAmount` — `amount <= 0`
- `TokenPaused` — Transfers are paused

**Events:**
- `mint` with topics `(to, amount)`

**Example:**
```rust
let recipient = Address::generate(&env);
token.mint(&admin, &recipient, &10_000i128);
```

---

### `burn(env, from, amount)`

Burns tokens from `from`. Decreases balance and `total_supply`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `from` | `Address` | Address whose tokens to burn |
| `amount` | `i128` | Amount to burn (> 0) |

**Returns:** Nothing

**Errors:**
- `InvalidAmount` — `amount <= 0`
- `TokenPaused` — Transfers are paused
- `InsufficientBalance` — Unlocked balance too low
- `ComplianceCheckFailed` — Compliance check failed

**Events:**
- `burn` with topics `(from, amount)`

**Example:**
```rust
token.burn(&admin, &500i128);
```

---

### `transfer(env, from, to, amount)`

Transfers spendable (unlocked) tokens between addresses. Validates all compliance rules.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `from` | `Address` | Sender address |
| `to` | `Address` | Recipient address |
| `amount` | `i128` | Amount to transfer (> 0) |

**Auth:** `from.require_auth()`

**Checks:**
1. Version check — token must be initialized
2. Pause/freeze check — `TransferPaused` or `AssetFrozen` if active
3. Compliance check — KYC, blacklist, transfer limits
4. Spendable balance — Only unlocked tokens can be transferred

**Returns:** Nothing

**Errors:**
- `TransferPaused` — Token is paused or frozen
- `ComplianceCheckFailed` — Compliance validation failed
- `InsufficientBalance` — Not enough unlocked tokens

**Events:**
- `transfer` with topics `(from, to, amount)`

**Example:**
```rust
let recipient = Address::generate(&env);
token.transfer(&admin, &recipient, &500i128);
```

---

### `get_token_info(env) -> TokenInfo`

Returns complete token metadata from storage.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |

**Returns:** `TokenInfo`

**Errors:**
- `NotInitialized` — Token has not been initialized

**Example:**
```rust
let info = token.get_token_info();
assert_eq!(info.total_supply, 1_000_000);
assert_eq!(info.decimals, 6);
```

---

### `get_balance(env, address) -> Balance`

Returns the on-chain balance for an address, including locked amount and voting power.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `address` | `Address` | Address to query |

**Returns:** `Balance`

**Example:**
```rust
let balance = token.get_balance(&admin);
// balance.amount      — spendable tokens
// balance.locked_amount — locked tokens
// balance.voting_power  — voting power
```

---

### `lock_tokens(env, auth, owner, amount, lock_period)`

Locks tokens for `lock_period` seconds, reducing spendable balance and increasing voting power.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Must be the token owner |
| `owner` | `Address` | Token owner address |
| `amount` | `i128` | Amount to lock (> 0) |
| `lock_period` | `u64` | Lock duration in seconds |

**Auth:** `auth.require_auth()` and `auth == owner`

**Returns:** Nothing

**Errors:**
- `InvalidAmount` — `amount <= 0`
- `InsufficientBalance` — Not enough unlocked tokens

**Events:**
- `tokens_locked` with topics `(owner, amount, lock_period)`

**Example:**
```rust
// Lock 100,000 tokens for 90 days
token.lock_tokens(&admin, &admin, &100_000i128, &(86400 * 90));
```

---

### `unlock_tokens(env, auth, owner, amount)`

Unlocks tokens, restoring spendable balance and reducing voting power.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Must be the token owner |
| `owner` | `Address` | Token owner address |
| `amount` | `i128` | Amount to unlock (> 0) |

**Auth:** `auth.require_auth()` and `auth == owner`

**Returns:** Nothing

**Errors:**
- `InvalidAmount` — `amount <= 0`
- `InsufficientBalance` — Locked balance too low

**Events:**
- `tokens_unlocked` with topics `(owner, amount)`

---

### `pause(env, auth)` / `unpause(env, auth)`

Pauses or resumes all transfers. Admin-only.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

**Auth:** Admin check

**Events:** `paused` / `unpaused`

---

### `freeze(env, auth)` / `unfreeze(env, auth)`

Freezes or unfreezes all transfers. Admin-only.

**Events:** `frozen` / `unfrozen`

---

## Event Catalog

| Event | Topics | Emitted By |
|-------|--------|------------|
| `initialized` | `name, symbol, total_supply` | `initialize()` |
| `migrated` | `old_version, new_version` | `migrate()` |
| `mint` | `to, amount` | `mint()` |
| `burn` | `from, amount` | `burn()` |
| `transfer` | `from, to, amount` | `transfer()` |
| `tokens_locked` | `owner, amount, lock_period` | `lock_tokens()` |
| `tokens_unlocked` | `owner, amount` | `unlock_tokens()` |
| `paused` | `timestamp` | `pause()` |
| `unpaused` | `timestamp` | `unpause()` |
| `frozen` | `timestamp` | `freeze()` |
| `unfrozen` | `timestamp` | `unfreeze()` |

## Cross-Contract Interactions

```
RWAToken
    │
    ├──transfer()──▶ ComplianceRegistry.check_compliance()
    │               ComplianceRegistry.check_outbound_participant()
    │
    ├──lock_tokens()──▶ Balance.voting_power update
    │
    └──mint/burn()──▶ Total Supply update
```
