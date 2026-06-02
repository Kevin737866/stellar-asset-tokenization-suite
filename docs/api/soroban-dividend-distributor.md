# Soroban Contract: Dividend Distributor

Source: `src/dividend_distributor.rs`

## Overview
The DividendDistributor contract manages yield distributions across supported currencies.

It supports:
- initializing distributor config
- registering currency token addresses
- creating multi-currency distributions
- auto-yield distribution (when enabled)
- claiming dividends (single/all)
- querying distributions and claim state
- admin config updates and deactivation

## Data types
- `DividendError`
- `DividendDistribution`
- `ClaimKey`
- `ClaimInfo`
- `DividendConfig`

## Public entry points

### `initialize(env: Env, auth: Address, admin: Address, supported_currencies: Vec<Symbol>)`
Initializes distributor and stores `DividendConfig`.

### `migrate(env: Env, auth: Address)`
Admin migration.

### `register_currency_token(env: Env, auth: Address, currency: Symbol, token_address: Address)`
Registers which contract address represents the dividend currency.

### `multi_ccy_distributions(env: Env, auth: Address, token_address: Address, currencies: Vec<Symbol>, amounts: Vec<i128>, claim_deadline: u64, metadata: Map<Symbol, Symbol>) -> Vec<u64>`
Creates multiple distributions in one call.

### `auto_yield_distribute(env: Env, auth: Address, token_address: Address, currencies: Vec<Symbol>, amounts: Vec<i128>, claim_deadline: u64, metadata: Map<Symbol, Symbol>) -> Vec<u64>`
Creates distributions only if auto-distribution is enabled and cadence has been reached.

### `create_distribution(env: Env, auth: Address, token_address: Address, currency: Symbol, amount: i128, claim_deadline: u64, metadata: Map<Symbol, Symbol>) -> u64`
Creates a single distribution.

### `claim_dividend(env: Env, distribution_id: u64, claimer: Address) -> i128`
Claims dividend for a distribution.

### `claim_all_dividends(env: Env, claimer: Address) -> Vec<i128>`
Claims all eligible dividends for a claimer.

### `get_distribution(env: Env, distribution_id: u64) -> DividendDistribution`
Returns distribution metadata.

### `get_active_distributions(env: Env, token_address: Address) -> Vec<DividendDistribution>`
Returns distributions for a given token that are active and not past the claim deadline.

### `get_claim_info(env: Env, distribution_id: u64, claimer: Address) -> Option<ClaimInfo>`
Returns claim state (if any).

### `calculate_available_dividend(env: Env, distribution_id: u64, claimer: Address) -> i128`
Computes claimable amount without claiming.

### `update_config(env: Env, auth: Address, config: DividendConfig)`
Admin updates the distribution configuration.

### `deactivate_distribution(env: Env, auth: Address, distribution_id: u64)`
Admin deactivates a distribution.

