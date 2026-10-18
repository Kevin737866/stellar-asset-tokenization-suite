use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, Env, String, Symbol};

use crate::asset_class_handlers::validate_metadata_size;
use crate::asset_factory::AssetConfig;

/// Issue #170: default compliance parameters for intellectual property.
pub const IP_HOLDING_PERIOD_DAYS: u32 = 180;
pub const IP_TRANSFER_LIMIT: i128 = 1_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum IntellectualPropertyError {
    InvalidIpType = 1,
    ExpiredIp = 2,
    InvalidDates = 3,
    InvalidValuation = 4,
}

/// Issue #170: metadata describing a tokenized intellectual property right.
#[contracttype]
#[derive(Clone)]
pub struct IPConfig {
    pub ip_type: Symbol,
    pub registration_number: Symbol,
    pub jurisdiction: Symbol,
    pub owner: Address,
    pub filing_date: u64,
    pub expiry_date: u64,
    pub valuation: i128,
}

fn is_valid_ip_type(env: &Env, ip_type: &Symbol) -> bool {
    [
        Symbol::new(env, "patent"),
        Symbol::new(env, "trademark"),
        Symbol::new(env, "copyright"),
        Symbol::new(env, "trade_secret"),
    ]
    .contains(ip_type)
}

/// Issue #170: validate an intellectual property configuration and fold it
/// into the base asset config's metadata.
pub fn create_ip_config(env: Env, base_config: AssetConfig, ip_config: IPConfig) -> AssetConfig {
    if !is_valid_ip_type(&env, &ip_config.ip_type) {
        panic_with_error!(&env, IntellectualPropertyError::InvalidIpType);
    }

    // An IP right that has already lapsed cannot back a token.
    if ip_config.expiry_date <= env.ledger().timestamp() {
        panic_with_error!(&env, IntellectualPropertyError::ExpiredIp);
    }

    if ip_config.filing_date >= ip_config.expiry_date {
        panic_with_error!(&env, IntellectualPropertyError::InvalidDates);
    }

    if ip_config.valuation <= 0 {
        panic_with_error!(&env, IntellectualPropertyError::InvalidValuation);
    }

    validate_metadata_size(&env, base_config.metadata.len(), 100);

    let mut metadata = base_config.metadata;
    metadata.set(
        Symbol::new(&env, "ip_type"),
        String::from_str(&env, &ip_config.ip_type.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "registration_number"),
        String::from_str(&env, &ip_config.registration_number.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "jurisdiction"),
        String::from_str(&env, &ip_config.jurisdiction.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "owner"),
        String::from_str(&env, &format!("{:?}", ip_config.owner)),
    );
    metadata.set(
        Symbol::new(&env, "filing_date"),
        String::from_str(&env, &ip_config.filing_date.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "expiry_date"),
        String::from_str(&env, &ip_config.expiry_date.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "valuation"),
        String::from_str(&env, &ip_config.valuation.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "holding_period_days"),
        String::from_str(&env, &IP_HOLDING_PERIOD_DAYS.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "transfer_limit"),
        String::from_str(&env, &IP_TRANSFER_LIMIT.to_string()),
    );

    AssetConfig {
        metadata,
        ..base_config
    }
}
