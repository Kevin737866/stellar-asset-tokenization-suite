# Soroban Contract: AssetFactory

Source: `src/asset_factory.rs`

## Overview

The **AssetFactory** is the central deployment and registry contract for all Real-World Asset (RWA) tokens. It provides:

- **Contract Initialization** — bootstraps admin, versioning, templates, and the asset registry
- **Template Management** — registers and retrieves per-asset-class deployment templates (wasm hash + default config)
- **Asset Creation** — deterministically deploys new RWA token contracts or links externally-deployed tokens
- **Registry Operations** — queries, pauses, and lists all managed assets
- **Admin Controls** — factory-wide emergency pause, admin rotation, and asset-level pause/unpause

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│   AssetFactory│────▶│   RWAToken        │────▶│ ComplianceRegistry   │
│   (registry)  │     │   (deployed per   │     │ (KYC/AML)            │
│               │     │    asset class)   │     │                      │
└──────┬───────┘     └────────┬─────────┘     └──────────────────────┘
       │                      │
       │              ┌───────▼──────────┐
       │              │ DividendDistributor│
       │              │ (yield payouts)    │
       │              └──────────────────┘
       │
       ▼
┌──────────────────┐
│ SecondaryMarket   │
│ (trading)         │
└──────────────────┘
```

## Data Types

### `AssetFactoryError`
Contract error enum with variants:

| Variant | Code | Description |
|---------|------|-------------|
| `AlreadyInitialized` | 201 | Factory has already been initialized |
| `NotInitialized` | 202 | Factory has not been initialized |
| `AssetAlreadyExists` | 203 | An asset with the same symbol already exists |
| `AssetNotFound` | 204 | The requested asset was not found in the registry |
| `TemplateNotFound` | 205 | No template registered for the given asset class |
| `TemplateNotActive` | 206 | The template for the asset class is not active |
| `ComplianceCheckFailed` | 207 | Compliance validation failed |
| `UpgradeNotApproved` | 208 | Contract upgrade has not been approved |
| `GovernanceThresholdNotMet` | 209 | Governance voting threshold was not met |
| `InvalidParameters` | 210 | Invalid parameters provided |
| `UnsupportedAssetClass` | 211 | Asset class is not supported |

### `AssetClass`
```rust
enum AssetClass {
    RealEstate,    // 0 - Property tokenization
    Commodity,     // 1 - Gold, silver, oil, etc.
    Invoice,       // 2 - Trade receivables
    Security,      // 3 - Equity / debt securities
    Art,           // 4 - Fine art & collectibles
    CarbonCredit,  // 5 - Carbon offset credits
}
```

### `ComplianceRules`
| Field | Type | Description |
|-------|------|-------------|
| `kyc_required` | `bool` | Whether KYC verification is required |
| `accredited_investor_only` | `bool` | Restrict to accredited investors |
| `geographic_restrictions` | `Vec<Symbol>` | Restricted jurisdictions |
| `holding_period_days` | `u32` | Minimum holding period in days |
| `transfer_limits` | `i128` | Maximum transfer amount |

### `AssetConfig`
| Field | Type | Description |
|-------|------|-------------|
| `name` | `Symbol` | Human-readable asset name |
| `symbol` | `Symbol` | Ticker symbol (unique in registry) |
| `decimals` | `u32` | Token decimals (max 18) |
| `total_supply` | `i128` | Initial total supply (> 0) |
| `asset_class` | `AssetClass` | Asset classification |
| `compliance_rules` | `ComplianceRules` | Compliance configuration |
| `dividend_schedule` | `Option<DividendSchedule>` | Optional yield schedule |
| `metadata` | `Map<Symbol, String>` | Arbitrary key-value metadata |

### `AssetTemplate`
| Field | Type | Description |
|-------|------|-------------|
| `asset_class` | `AssetClass` | Asset class this template applies to |
| `base_config` | `AssetConfig` | Default configuration |
| `wasm_hash` | `BytesN<32>` | Wasm hash of the token contract |
| `is_active` | `bool` | Whether the template is active |
| `version` | `u32` | Template version number |

### `AssetInfo`
| Field | Type | Description |
|-------|------|-------------|
| `symbol` | `Symbol` | Asset ticker symbol |
| `token_address` | `Address` | Deployed token contract address |
| `asset_class` | `AssetClass` | Asset classification |
| `is_paused` | `bool` | Pause status |
| `created_at` | `u64` | Creation timestamp |
| `deployer` | `Address` | Address that deployed the asset |

---

## Public Entry Points

### `initialize(env, auth, admin)`

Initializes the factory contract storage.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Authorizing address (must sign) |
| `admin` | `Address` | Initial admin address |

**Auth:** `auth.require_auth()`

**Returns:** Nothing

**Errors:**
- `AlreadyInitialized` — Factory has already been initialized

**Events:**
- `initialized` with topic `admin`

**Example:**
```rust
let factory_id = env.register_contract(None, AssetFactory);
let factory = AssetFactoryClient::new(&env, &factory_id);
factory.initialize(&admin, &admin);
```

---

### `migrate(env, auth)`

Upgrades contract storage to the latest `STORAGE_VERSION`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address (must be current admin) |

**Auth:** Admin check via `assert_admin`

**Returns:** Nothing

**Errors:**
- `Unauthorized` — Caller is not admin
- `AlreadyInitialized` — Already at latest version

**Events:**
- `migrated` with topic `(old_version, new_version)`

**Example:**
```rust
// Only callable by admin
factory.migrate(&admin);
```

---

### `create_asset(env, auth, config) -> Address`

Deploys a new RWA token contract and records it in the factory registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `config` | `AssetConfig` | Full asset configuration |

**Auth:** Admin check

**Validations:**
- `config.total_supply > 0`
- `config.decimals <= 18`
- `config.compliance_rules.transfer_limits >= 0`
- If `dividend_schedule` present: valid frequency and `total_distributed >= 0`
- Symbol must not already exist in registry
- Template must exist and be active for `config.asset_class`

**Returns:** `Address` — Deployed token contract address

**Errors:**
- `InvalidParameters` — Invalid config values
- `AssetAlreadyExists` — Symbol already registered
- `TemplateNotFound` — No template for asset class
- `TemplateNotActive` — Template is deactivated

**Events:**
- `asset_created` with topics `(symbol, token_address, asset_class)`

**Example:**
```rust
let config = AssetConfig {
    name: Symbol::new(&env, "ManhattanOffice"),
    symbol: Symbol::new(&env, "MNO"),
    decimals: 6,
    total_supply: 1_000_000,
    asset_class: AssetClass::RealEstate,
    compliance_rules: ComplianceRules {
        kyc_required: true,
        accredited_investor_only: false,
        geographic_restrictions: Vec::new(&env),
        holding_period_days: 90,
        transfer_limits: 100_000,
    },
    dividend_schedule: None,
    metadata: Map::new(&env),
};

let token_address = factory.create_asset(&admin, &config);
```

---

### `deploy_rwa_token(env, auth, spec) -> Address`

Links and initializes an already-deployed token contract, then writes an `AssetInfo` entry to the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `spec` | `RwaDeploySpec` | Deployment specification |

**Auth:** Admin check

**Returns:** `Address` — Token contract address

**Errors:**
- `AssetAlreadyExists` — Symbol already registered

**Events:**
- `asset_registered` with topics `(symbol, token_address)`

**Example:**
```rust
let spec = RwaDeploySpec {
    token_address: pre_deployed_address,
    symbol: Symbol::new(&env, "EXTERNAL"),
    asset_class: AssetClass::Art,
};
let addr = factory.deploy_rwa_token(&admin, &spec);
```

---

### `get_asset_info(env, symbol) -> AssetInfo`

Fetches a single asset entry from the registry by symbol.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `symbol` | `Symbol` | Ticker symbol to query |

**Returns:** `AssetInfo`

**Errors:**
- `AssetNotFound` — Symbol not in registry

**Example:**
```rust
let info = factory.get_asset_info(&Symbol::new(&env, "MNO"));
assert_eq!(info.asset_class, AssetClass::RealEstate);
```

---

### `list_assets(env) -> Vec<AssetInfo>`

Returns all `AssetInfo` entries currently in the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |

**Returns:** `Vec<AssetInfo>`

**Example:**
```rust
let all_assets = factory.list_assets();
for asset in all_assets.iter() {
    // Process each asset
}
```

---

### `get_all_assets(env) -> Map<Symbol, AssetInfo>`

Returns the raw registry map.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |

**Returns:** `Map<Symbol, AssetInfo>`

**Example:**
```rust
let map = factory.get_all_assets();
assert_eq!(map.len(), factory.get_asset_count());
```

---

### `get_asset_count(env) -> u32`

Returns the number of assets in the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |

**Returns:** `u32` — Registry size

**Example:**
```rust
let count = factory.get_asset_count();
```

---

### `set_asset_pause_status(env, auth, symbol, paused)`

Sets the `is_paused` flag for a specific asset in the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `symbol` | `Symbol` | Asset symbol |
| `paused` | `bool` | `true` to pause, `false` to unpause |

**Auth:** Admin check

**Returns:** Nothing

**Errors:**
- `AssetNotFound` — Symbol not in registry

**Events:**
- `asset_pause_status_changed` with topics `(symbol, paused)`

**Example:**
```rust
factory.set_asset_pause_status(&admin, &Symbol::new(&env, "MNO"), &true);
```

---

### `emergency_pause_all(env, auth)`

Pauses all assets in the registry in a single operation. Use for emergency halts.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

**Auth:** Admin check

**Returns:** Nothing

**Events:**
- `emergency_pause_all` with topic `timestamp`

**Example:**
```rust
factory.emergency_pause_all(&admin);
```

---

### `update_admin(env, auth, new_admin)`

Transfers factory admin role to a new address.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Current admin address |
| `new_admin` | `Address` | New admin address |

**Auth:** Admin check

**Returns:** Nothing

**Errors:**
- `Unauthorized` — Caller is not current admin

**Events:**
- `admin_updated` with topics `(old_admin, new_admin)`

**Example:**
```rust
let new_admin = Address::generate(&env);
factory.update_admin(&admin, &new_admin);
```

---

### `register_template(env, auth, template)`

Registers or replaces a deployment template for an asset class.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `template` | `AssetTemplate` | Template to register |

**Auth:** Admin check

**Returns:** Nothing

**Events:**
- `template_registered` with topics `(asset_class, version)`

**Example:**
```rust
let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
let template = AssetTemplate {
    asset_class: AssetClass::RealEstate,
    base_config: default_asset_config(&env),
    wasm_hash,
    is_active: true,
    version: 1,
};
factory.register_template(&admin, &template);
```

---

### `get_template(env, asset_class) -> AssetTemplate`

Fetches the registered template for a given asset class.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `asset_class` | `AssetClass` | Asset class to look up |

**Returns:** `AssetTemplate`

**Errors:**
- `TemplateNotFound` — No template registered for class

**Example:**
```rust
let template = factory.get_template(&AssetClass::Commodity);
assert!(template.is_active);
```

---

### `upgrade_asset(env, auth, symbol, new_wasm_hash)`

Deploys a new contract version for an asset and updates the registry token address.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `symbol` | `Symbol` | Asset symbol to upgrade |
| `new_wasm_hash` | `BytesN<32>` | New wasm hash |

**Auth:** Admin check

**Returns:** Nothing

**Errors:**
- `AssetNotFound` — Symbol not found
- `UpgradeNotApproved` — Upgrade not approved by governance

**Events:**
- `asset_upgraded` with topics `(symbol, old_hash, new_hash)`

---

## Event Catalog

| Event | Topics | Emitted By |
|-------|--------|------------|
| `initialized` | `admin` | `initialize()` |
| `migrated` | `old_version, new_version` | `migrate()` |
| `asset_created` | `symbol, token_address, asset_class` | `create_asset()` |
| `asset_registered` | `symbol, token_address` | `deploy_rwa_token()` |
| `asset_pause_status_changed` | `symbol, paused` | `set_asset_pause_status()` |
| `emergency_pause_all` | `timestamp` | `emergency_pause_all()` |
| `admin_updated` | `old_admin, new_admin` | `update_admin()` |
| `template_registered` | `asset_class, version` | `register_template()` |
| `asset_upgraded` | `symbol, old_hash, new_hash` | `upgrade_asset()` |

## Cross-Contract Interactions

```
AssetFactory ───creates──▶ RWAToken
     │                         │
     │                         ├──checks──▶ ComplianceRegistry
     │                         │
     │                         ├──distributes──▶ DividendDistributor
     │                         │
     │                         └──lists on──▶ SecondaryMarket
     │
     ├──registers──▶ AssetInfo in Storage
     │
     └──manages──▶ Templates per AssetClass
```
