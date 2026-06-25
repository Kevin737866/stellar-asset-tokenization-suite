use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, Symbol, Vec, String};

mod asset_factory;
mod asset_class_handlers;
mod auth;
mod compliance_registry;
mod custody_validator;
mod dividend_distributor;
mod rwa_token;
mod secondary_market;
pub mod shared_admin;
pub mod real_estate;
pub mod commodity;
pub mod invoice;
pub mod security;
pub mod art;
pub mod carbon_credit;

#[cfg(test)]
mod tests;

use asset_factory::AssetFactoryClient;
use compliance_registry::ComplianceRegistryClient;
use custody_validator::CustodyValidatorClient;
use dividend_distributor::DividendDistributorClient;
use secondary_market::SecondaryMarketClient;

/// Bundled arguments for RWA deployment (Soroban exports allow at most 10 function parameters).
#[contracttype]
#[derive(Clone)]
pub struct RwaDeploySpec {
    pub token_contract: Address,
    pub asset_name: Symbol,
    pub asset_symbol: Symbol,
    pub total_supply: i128,
    pub decimals: u32,
    pub asset_type: Symbol,
    pub metadata: Map<Symbol, String>,
    pub compliance_registry: Address,
    pub dividend_distributor: Address,
}

#[contract]
pub struct StellarRWASuite;

#[contractimpl]
impl StellarRWASuite {
    /// Deploy / initialize an RWA token at `spec.token_contract` (deploy WASM separately, then call this).
    pub fn deploy_rwa_token(
        env: Env,
        auth: Address,
        asset_factory: Address,
        spec: RwaDeploySpec,
    ) -> Address {
        let factory = AssetFactoryClient::new(&env, &asset_factory);
        factory.deploy_rwa_token(&auth, &spec)
    }

    pub fn init_compliance_registry(
        env: Env,
        auth: Address,
        registry: Address,
        admin: Address,
        kyc_required: bool,
        transfer_restrictions: bool,
    ) {
        let c = ComplianceRegistryClient::new(&env, &registry);
        c.initialize(&auth, &admin, &kyc_required, &transfer_restrictions);
    }

    pub fn init_dividend_distributor(
        env: Env,
        auth: Address,
        distributor: Address,
        admin: Address,
        supported_currencies: Vec<Symbol>,
    ) {
        let c = DividendDistributorClient::new(&env, &distributor);
        c.initialize(&auth, &admin, &supported_currencies);
    }

    pub fn init_secondary_market(
        env: Env,
        auth: Address,
        market: Address,
        admin: Address,
        base_currency: Address,
        compliance_registry: Address,
        dividend_distributor: Address,
        fee_rate: i64,
        min_order_size: i128,
        max_price_deviation_bps: i64,
    ) {
        let c = SecondaryMarketClient::new(&env, &market);
        c.initialize(
            &admin,
            &base_currency,
            &compliance_registry,
            &dividend_distributor,
            &fee_rate,
            &min_order_size,
            &max_price_deviation_bps,
        );
    }

    pub fn init_custody_validator(
        env: Env,
        auth: Address,
        validator: Address,
        admin: Address,
        oracle_addresses: Vec<Address>,
    ) {
        let c = CustodyValidatorClient::new(&env, &validator);
        c.initialize(&auth, &admin, &oracle_addresses);
    }
}
