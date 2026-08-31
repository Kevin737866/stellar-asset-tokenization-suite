use soroban_sdk::{contracterror, contracttype, Env, Symbol, panic_with_error, String};
use crate::asset_factory::AssetConfig;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum RECError {
    InvalidEnergySource = 1,
    InvalidMWhAmount = 2,
    ExpiredCompliancePeriod = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RECConfig {
    pub energy_source: Symbol,
    pub mwh_amount: i128,
    pub grid_region: Symbol,
    pub compliance_period_expiry: u64,
}

pub fn create_rec_config(
    env: Env,
    base_config: AssetConfig,
    rec_config: RECConfig,
) -> AssetConfig {
    let valid_sources = [
        Symbol::new(&env, "SOLAR"),
        Symbol::new(&env, "WIND"),
        Symbol::new(&env, "HYDRO"),
        Symbol::new(&env, "GEOTHERMAL"),
    ];

    let mut is_valid = false;
    for source in valid_sources.iter() {
        if &rec_config.energy_source == source {
            is_valid = true;
            break;
        }
    }
    if !is_valid {
        panic_with_error!(&env, RECError::InvalidEnergySource);
    }

    if rec_config.mwh_amount <= 0 {
        panic_with_error!(&env, RECError::InvalidMWhAmount);
    }

    if rec_config.compliance_period_expiry <= env.ledger().timestamp() {
        panic_with_error!(&env, RECError::ExpiredCompliancePeriod);
    }

    let mut compliance_rules = base_config.compliance_rules;
    compliance_rules.holding_period_days = 0;
    compliance_rules.accredited_investor_only = false;

    let mut metadata = base_config.metadata;
    metadata.set(
        Symbol::new(&env, "energy_source"),
        String::from_str(&env, &rec_config.energy_source.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "mwh_amount"),
        String::from_str(&env, &rec_config.mwh_amount.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "grid_region"),
        String::from_str(&env, &rec_config.grid_region.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "compliance_period_expiry"),
        String::from_str(&env, &rec_config.compliance_period_expiry.to_string()),
    );

    AssetConfig {
        compliance_rules,
        metadata,
        ..base_config
    }
}

pub fn validate_rec_transfer(env: &Env, expiry: u64) -> bool {
    env.ledger().timestamp() <= expiry
}
