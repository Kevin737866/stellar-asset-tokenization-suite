# Soroban Contract: Suite Wrapper (StellarRWASuite)

Source: `src/lib.rs`

## Overview
`StellarRWASuite` is a thin wrapper contract that exposes a bundled deployment / initialization workflow for other contracts:
- AssetFactory
- ComplianceRegistry
- DividendDistributor
- SecondaryMarket
- CustodyValidator

## Data types
- `RwaDeploySpec`

## Public entry points

### `deploy_rwa_token(env: Env, auth: Address, asset_factory: Address, spec: RwaDeploySpec) -> Address`
Deploys/initializes an RWA token using the provided `asset_factory` contract.

### `init_compliance_registry(env: Env, auth: Address, registry: Address, admin: Address, kyc_required: bool, transfer_restrictions: bool)`
Initializes a `ComplianceRegistry` instance.

### `init_dividend_distributor(env: Env, auth: Address, distributor: Address, admin: Address, supported_currencies: Vec<Symbol>)`
Initializes a `DividendDistributor` instance.

### `init_secondary_market(env: Env, auth: Address, market: Address, admin: Address, base_currency: Address, compliance_registry: Address, dividend_distributor: Address, fee_rate: i64, min_order_size: i128, max_price_deviation_bps: i64)`
Initializes a `SecondaryMarket` instance.

### `init_custody_validator(env: Env, auth: Address, validator: Address, admin: Address, oracle_addresses: Vec<Address>)`
Initializes a `CustodyValidator` instance.

