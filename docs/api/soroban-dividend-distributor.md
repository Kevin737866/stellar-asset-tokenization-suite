# Soroban Contract: Dividend Distributor

Source: `src/dividend_distributor.rs`

## Overview

The **DividendDistributor** contract manages yield distributions across multiple supported currencies. It supports:

- **Multi-Currency Distributions** — Create and claim dividends in various currencies (USDC, EURC, etc.)
- **Configurable Fee Rates** — Protocol fee taken from each claim (in basis points)
- **Auto-Yield Distribution** — Optional automatic dividend creation on a configurable cadence
- **Claim Tracking** — Per-user, per-distribution claim records prevent double-claims
- **Distribution Lifecycle** — Active/inactive states, deadlines, and deactivation

## Architecture

```
┌──────────────────────┐
│ DividendDistributor   │
└──────────┬───────────┘
           │
           ├──create_distribution()──▶ Stores DividendDistribution
           │
           ├──claim_dividend()──▶ Checks RWAToken balance
           │                     Transfers currency token (minus fee)
           │
           └──auto_yield_distribute()──▶ Timer-based distribution creation
```

## Data Types

### `DividendError`
| Variant | Code | Description |
|---------|------|-------------|
| `AlreadyInitialized` | 401 | Distributor already initialized |
| `NotInitialized` | 402 | Not yet initialized |
| `ConfigNotFound` | 403 | Configuration not found |
| `InsufficientFunds` | 404 | Not enough funds for distribution |
| `InvalidAmount` | 405 | Zero or negative amount |
| `DistributionNotFound` | 406 | Distribution ID not found |
| `AlreadyClaimed` | 407 | User already claimed |
| `UnsupportedCurrency` | 408 | Currency not supported |
| `DistributionNotActive` | 409 | Distribution is inactive |
| `AutoDistributionDisabled` | 410 | Auto-distribution not enabled |
| `YieldCadenceNotReached` | 411 | Too soon since last distribution |
| `ZeroTotalSupply` | 412 | Token supply is zero |
| `NoTokensToClaim` | 413 | User holds no tokens |
| `NoDividendAvailable` | 414 | No dividend to distribute |
| `Unauthorized` | 415 | Caller not authorized |

### `DividendDistribution`
| Field | Type | Description |
|-------|------|-------------|
| `distribution_id` | `u64` | Unique distribution ID |
| `token_address` | `Address` | Associated RWA token |
| `currency` | `Symbol` | Distribution currency |
| `total_amount` | `i128` | Total distribution amount |
| `remaining_amount` | `i128` | Amount not yet claimed |
| `claim_deadline` | `u64` | Deadline timestamp |
| `is_active` | `bool` | Active status |
| `created_at` | `u64` | Creation timestamp |
| `metadata` | `Map<Symbol, Symbol>` | Arbitrary metadata |

### `DividendConfig`
| Field | Type | Description |
|-------|------|-------------|
| `supported_currencies` | `Vec<Symbol>` | Active currencies |
| `auto_distribute` | `bool` | Enable auto-distribution |
| `min_distribution_amount` | `i128` | Minimum distribution amount |
| `max_distribution_frequency` | `u64` | Minimum seconds between distributions |
| `fee_rate` | `i64` | Protocol fee in bps (e.g., 50 = 0.5%) |
| `fee_recipient` | `Address` | Fee collection address |

### `ClaimInfo`
| Field | Type | Description |
|-------|------|-------------|
| `claimed` | `bool` | Whether claimed |
| `amount` | `i128` | Amount claimed |
| `claimed_at` | `u64` | Claim timestamp |

---

## Public Entry Points

### `initialize(env, auth, admin, supported_currencies)`

Initializes the dividend distributor with default config.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Authorizing address |
| `admin` | `Address` | Admin address |
| `supported_currencies` | `Vec<Symbol>` | Initial supported currencies |

**Auth:** `auth.require_auth()`

**Returns:** Nothing

**Errors:**
- `AlreadyInitialized` — Already initialized

**Example:**
```rust
let mut currencies = Vec::new(&env);
currencies.push_back(Symbol::new(&env, "USDC"));
currencies.push_back(Symbol::new(&env, "EURC"));

let dist_id = env.register_contract(None, DividendDistributor);
let distributor = DividendDistributorClient::new(&env, &dist_id);
distributor.initialize(&admin, &admin, &currencies);
```

---

### `migrate(env, auth)`

Admin storage migration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

**Auth:** Admin check

---

### `register_currency_token(env, auth, currency, token_address)`

Maps a currency symbol to its Stellar token contract address.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `currency` | `Symbol` | Currency symbol (e.g., "USDC") |
| `token_address` | `Address` | Stellar asset contract address |

**Auth:** Admin check

**Example:**
```rust
distributor.register_currency_token(
    &admin,
    &Symbol::new(&env, "USDC"),
    &usdc_token_address,
);
```

---

### `create_distribution(env, auth, token_address, currency, amount, claim_deadline, metadata) -> u64`

Creates a single dividend distribution for a token in a specific currency.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `token_address` | `Address` | RWA token address |
| `currency` | `Symbol` | Distribution currency |
| `amount` | `i128` | Total distribution amount (> 0) |
| `claim_deadline` | `u64` | Deadline timestamp |
| `metadata` | `Map<Symbol, Symbol>` | Arbitrary metadata |

**Auth:** Admin check

**Returns:** `u64` — New distribution ID

**Errors:**
- `InvalidAmount` — `amount <= 0`
- `UnsupportedCurrency` — Currency not registered

**Events:**
- `distribution_created` with topics `(distribution_id, token_address, currency, amount)`

**Example:**
```rust
let deadline = env.ledger().timestamp() + 86400 * 30; // 30 days
let id = distributor.create_distribution(
    &admin,
    &token_address,
    &Symbol::new(&env, "USDC"),
    &10_000i128,
    &deadline,
    &Map::new(&env),
);
```

---

### `multi_ccy_distributions(env, auth, token_address, currencies, amounts, claim_deadline, metadata) -> Vec<u64>`

Creates multiple distributions across different currencies in one call.

| Parameter | Type | Description |
|-----------|------|-------------|
| `currencies` | `Vec<Symbol>` | Currency symbols |
| `amounts` | `Vec<i128>` | Corresponding amounts |

**Returns:** `Vec<u64>` — Distribution IDs

---

### `auto_yield_distribute(...) -> Vec<u64>`

Creates distributions only if auto-distribute is enabled and cadence is met.

**Errors:**
- `AutoDistributionDisabled` — Not enabled in config
- `YieldCadenceNotReached` — Too soon since last distribution

---

### `claim_dividend(env, distribution_id, claimer) -> i128`

Claims a dividend for a specific distribution. Amount is proportional to the claimer's token balance at claim time, minus protocol fee.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `distribution_id` | `u64` | Distribution to claim from |
| `claimer` | `Address` | Claimer address |

**Returns:** `i128` — Net amount claimed (after fee)

**Errors:**
- `DistributionNotFound` — Invalid ID
- `AlreadyClaimed` — Already claimed
- `DistributionNotActive` — Deactivated
- `NoTokensToClaim` — Zero token balance
- Claim deadline passed

**Events:**
- `dividend_claimed` with topics `(distribution_id, claimer, amount, fee)`

**Example:**
```rust
let claimed_amount = distributor.claim_dividend(&distribution_id, &claimer);
// claimed_amount = gross * holder_percentage * (1 - fee_rate/10000)
```

---

### `claim_all_dividends(env, claimer) -> Vec<i128>`

Claims all eligible dividends for a claimer across all active distributions.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `claimer` | `Address` | Claimer address |

**Returns:** `Vec<i128>` — Amounts claimed per distribution

---

### `get_distribution(env, distribution_id) -> DividendDistribution`

Returns distribution metadata.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `distribution_id` | `u64` | Distribution ID |

**Returns:** `DividendDistribution`

**Errors:**
- `DistributionNotFound`

---

### `get_active_distributions(env, token_address) -> Vec<DividendDistribution>`

Returns all active distributions (not expired, not deactivated) for a given token.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `token_address` | `Address` | RWA token address |

**Returns:** `Vec<DividendDistribution>`

---

### `get_claim_info(env, distribution_id, claimer) -> Option<ClaimInfo>`

Returns claim state for a user-distribution pair, if claimed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `distribution_id` | `u64` | Distribution ID |
| `claimer` | `Address` | Claimer address |

**Returns:** `Option<ClaimInfo>`

---

### `calculate_available_dividend(env, distribution_id, claimer) -> i128`

Computes the claimable amount for a user without actually claiming.

| Parameter | Type | Description |
|-----------|------|-------------|
| `distribution_id` | `u64` | Distribution ID |
| `claimer` | `Address` | Claimer address |

**Returns:** `i128` — Available dividend (0 if already claimed or no tokens)

---

### `update_config(env, auth, config)`

Updates the distribution configuration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `config` | `DividendConfig` | New configuration |

**Auth:** Admin check

---

### `deactivate_distribution(env, auth, distribution_id)`

Admin deactivates a distribution, preventing further claims.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `distribution_id` | `u64` | Distribution to deactivate |

**Auth:** Admin check

---

## Event Catalog

| Event | Topics | Emitted By |
|-------|--------|------------|
| `initialized` | `admin` | `initialize()` |
| `migrated` | `old_version, new_version` | `migrate()` |
| `distribution_created` | `distribution_id, token_address, currency, amount` | `create_distribution()` |
| `dividend_claimed` | `distribution_id, claimer, amount, fee` | `claim_dividend()` |
| `config_updated` | `fee_rate, auto_distribute` | `update_config()` |
| `distribution_deactivated` | `distribution_id` | `deactivate_distribution()` |

## Dividend Calculation

```
gross_amount = total_distribution_amount × (claimer_balance / total_supply)
fee = gross_amount × (fee_rate_bps / 10000)
net_amount = gross_amount - fee
```

The protocol fee is deducted from each claim and sent to `fee_recipient`.
