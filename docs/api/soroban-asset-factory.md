# Soroban Contract: AssetFactory

Source: `src/asset_factory.rs`

## Overview
The AssetFactory contract is responsible for:
- Initializing on-chain storage (admin, versioning, templates, registry)
- Registering templates for each asset class
- Creating RWA token contracts (deterministic deployment)
- Linking already-deployed token contracts to the factory registry
- Managing pause status and admin / upgrades

## Data types
- `AssetFactoryError` (contract error enum)
- `AssetClass` (RealEstate, Commodity, Invoice, Security, Art, CarbonCredit)
- `ComplianceRules`
- `DividendSchedule`
- `AssetConfig`
- `AssetTemplate`
- `AssetInfo`

## Contract Errors
Defined in `AssetFactoryError`.

## Public entry points

### `initialize(env: Env, auth: Address, admin: Address)`
Initializes contract storage.

**Auth:** `auth.require_auth()`

**Panics:** `AlreadyInitialized` if initialized.

### `migrate(env: Env, auth: Address)`
Upgrades contract storage version up to `STORAGE_VERSION`.

**Auth:** admin check.

### `create_asset(env: Env, auth: Address, config: AssetConfig) -> Address`
Deploys a new token contract (deterministic deployment) and records it in the registry.

**Auth:** admin check (`assert_admin` + `auth`).

**Validations:**
- `config.total_supply > 0`
- `config.decimals <= 18`
- `config.compliance_rules.transfer_limits >= 0`
- If `config.dividend_schedule` is present: frequency/date checks and `total_distributed >= 0`
- Registry must not already contain `config.symbol`
- Template must exist for `config.asset_class` and be active

**Returns:** deployed token contract address.

### `deploy_rwa_token(env: Env, auth: Address, spec: RwaDeploySpec) -> Address`
Links and initializes an already-deployed token contract, then writes an `AssetInfo` entry.

**Auth:** admin check.

### `get_asset_info(env: Env, symbol: Symbol) -> AssetInfo`
Fetch a single asset entry from the registry.

**Panics:** `AssetNotFound`.

### `list_assets(env: Env) -> Vec<AssetInfo>`
Returns all `AssetInfo` entries from the registry.

### `set_asset_pause_status(env: Env, auth: Address, symbol: Symbol, paused: bool)`
Sets `is_paused` flag for an asset and emits `asset_pause_status_changed`.

**Auth:** admin check.

### `update_admin(env: Env, auth: Address, new_admin: Address)`
Updates factory admin.

### `register_template(env: Env, auth: Address, template: AssetTemplate)`
Registers or replaces a template for an asset class.

### `get_template(env: Env, asset_class: AssetClass) -> AssetTemplate`
Fetches the template for a given asset class.

**Panics:** `TemplateNotFound`.

### `upgrade_asset(env: Env, auth: Address, symbol: Symbol, new_wasm_hash: BytesN<32>)`
Deploys a new contract version and updates the registry token address.

### `emergency_pause_all(env: Env, auth: Address)`
Pauses all registry entries and emits `emergency_pause_all`.

### `get_all_assets(env: Env) -> Map<Symbol, AssetInfo>`
Returns the raw registry map.

### `get_asset_count(env: Env) -> u32`
Returns registry size.


