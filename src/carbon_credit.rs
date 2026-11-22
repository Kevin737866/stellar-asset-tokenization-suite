use soroban_sdk::{contracterror, contracttype, Address, Env, Map, Symbol, Vec, panic_with_error, String};
use crate::asset_factory::AssetConfig;
use crate::asset_class_handlers::{AssetClassError, validate_metadata_size};

/// Issue #175: the asset type stored on a tokenized carbon credit, as written
/// by `AssetClass::CarbonCredit` in the asset factory.
pub const CARBON_CREDIT_ASSET_TYPE: &str = "CarbonCredit";

const RETIREMENTS_KEY: &str = "carbon_retirements";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum CarbonCreditError {
    InvalidVintage = 1,
    InvalidVerificationStandard = 2,
    /// Issue #175: the token is not a carbon credit asset.
    NotCarbonCredit = 3,
    InvalidRetirementAmount = 4,
}

#[contracttype]
#[derive(Clone)]
pub struct CarbonCreditConfig {
    pub project_id: Symbol,
    pub vintage_year: u32,
    pub retirement_functionality: bool,
    pub project_metadata: Map<Symbol, Symbol>,
    pub verification_standard: Symbol,
    pub carbon_offset_amount: i128,
}

/// Issue #175: a permanent record of credits taken out of circulation.
///
/// Retirement records are append-only: there is deliberately no update or
/// delete entry point, so a retired credit can never be un-retired or counted
/// twice.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetirementRecord {
    pub owner: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub purpose: Symbol,
}

fn retirements_key(env: &Env) -> Symbol {
    Symbol::new(env, RETIREMENTS_KEY)
}

/// Issue #175: append a retirement record to `owner`'s certificate.
///
/// The storage entry is keyed by the owner and only ever grows; the history is
/// the certificate returned by [`get_retirement_certificate`].
pub fn append_retirement(env: &Env, owner: &Address, record: RetirementRecord) {
    let key = retirements_key(env);
    let mut certificates: Map<Address, Vec<RetirementRecord>> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or(Map::new(env));

    let mut records = certificates
        .get(owner.clone())
        .unwrap_or_else(|| Vec::new(env));
    records.push_back(record);
    certificates.set(owner.clone(), records);

    env.storage().instance().set(&key, &certificates);
}

/// Issue #175: every retirement ever recorded for `owner`, oldest first.
pub fn get_retirements(env: &Env, owner: &Address) -> Vec<RetirementRecord> {
    let certificates: Map<Address, Vec<RetirementRecord>> = env
        .storage()
        .instance()
        .get(&retirements_key(env))
        .unwrap_or(Map::new(env));

    certificates
        .get(owner.clone())
        .unwrap_or_else(|| Vec::new(env))
}

/// Issue #175: total credits `owner` has permanently retired.
pub fn total_retired(env: &Env, owner: &Address) -> i128 {
    let mut total: i128 = 0;
    for record in get_retirements(env, owner).iter() {
        total += record.amount;
    }
    total
}

pub fn create_carbon_credit_config(
    env: Env,
    base_config: AssetConfig,
    carbon_config: CarbonCreditConfig,
) -> AssetConfig {
    validate_metadata_size(&env, base_config.metadata.len(), 100);

    let current_year = (env.ledger().timestamp() / 31536000) + 1970;
    if carbon_config.vintage_year < 1990 || (carbon_config.vintage_year as u64) > current_year {
        panic_with_error!(&env, AssetClassError::InvalidVintage);
    }

    let valid_standards = Vec::from_array(&env, [
        Symbol::new(&env, "VCS"),
        Symbol::new(&env, "GS"),
        Symbol::new(&env, "CDM"),
        Symbol::new(&env, "ACR"),
    ]);
    
    if !valid_standards.contains(&carbon_config.verification_standard) {
        panic_with_error!(&env, AssetClassError::InvalidVerificationStandard);
    }

    let mut metadata = base_config.metadata;
    metadata.set(Symbol::new(&env, "project_id"), String::from_str(&env, &carbon_config.project_id.to_string()));
    metadata.set(Symbol::new(&env, "vintage_year"), String::from_str(&env, &carbon_config.vintage_year.to_string()));
    metadata.set(Symbol::new(&env, "retirement_functionality"), String::from_str(&env, &carbon_config.retirement_functionality.to_string()));
    metadata.set(Symbol::new(&env, "verification_standard"), String::from_str(&env, &carbon_config.verification_standard.to_string()));
    metadata.set(Symbol::new(&env, "carbon_offset_amount"), String::from_str(&env, &carbon_config.carbon_offset_amount.to_string()));

    for (key, value) in carbon_config.project_metadata {
        metadata.set(key, String::from_str(&env, &value.to_string()));
    }

    AssetConfig {
        metadata,
        ..base_config
    }
}
