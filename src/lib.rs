use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, Symbol, Vec};

pub mod asset_factory;
pub mod asset_class_handlers;
pub mod auth;
pub mod compliance_registry;
pub mod custody_validator;
pub mod dividend_distributor;
pub mod rwa_token;
pub mod secondary_market;

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
    pub metadata: Map<Symbol, Symbol>,
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
        fee_rate: i64,
        min_order_size: i128,
    ) {
        let c = SecondaryMarketClient::new(&env, &market);
        c.initialize(&auth, &admin, &fee_rate, &min_order_size);
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
