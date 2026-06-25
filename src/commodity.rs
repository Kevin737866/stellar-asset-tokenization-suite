use soroban_sdk::{contracttype, Address, Env, Symbol, Vec, panic_with_error, String};
use crate::asset_factory::AssetConfig;
use crate::asset_class_handlers::AssetClassError;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum CommodityError {
    InvalidPurityGrade = 1,
}

#[contracttype]
#[derive(Clone)]
pub struct CommodityConfig {
    pub commodity_type: Symbol,
    pub vault_location: Symbol,
    pub custody_vault: Address,
    pub purity_grade: Symbol,
    pub physical_redemption_window: u64,
    pub quality_attestation: Address,
}

pub fn create_commodity_config(
    env: Env,
    base_config: AssetConfig,
    commodity_config: CommodityConfig,
) -> AssetConfig {
    let valid_grades = Vec::from_array(&env, [
        Symbol::new(&env, "999"),
        Symbol::new(&env, "995"),
        Symbol::new(&env, "990"),
        Symbol::new(&env, "750"),
    ]);
    
    if !valid_grades.contains(&commodity_config.purity_grade) {
        panic_with_error!(&env, AssetClassError::InvalidPurityGrade);
    }

    let mut metadata = base_config.metadata;
    metadata.set(Symbol::new(&env, "commodity_type"), String::from_str(&env, &commodity_config.commodity_type.to_string()));
    metadata.set(Symbol::new(&env, "vault_location"), String::from_str(&env, &commodity_config.vault_location.to_string()));
    metadata.set(Symbol::new(&env, "purity_grade"), String::from_str(&env, &commodity_config.purity_grade.to_string()));
    metadata.set(Symbol::new(&env, "redemption_window"), String::from_str(&env, &commodity_config.physical_redemption_window.to_string()));

    AssetConfig {
        metadata,
        ..base_config
    }
}
