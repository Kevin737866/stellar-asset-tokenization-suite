use soroban_sdk::{contracterror, contracttype, Address, Env, Symbol, Vec, panic_with_error, String};
use crate::asset_factory::AssetConfig;
use crate::asset_class_handlers::{AssetClassError, validate_address_not_zero, validate_metadata_size};

const SECONDS_PER_DAY: u64 = 86_400;

/// Issue #172: the discount is capped at 10% and scales linearly with the
/// number of days remaining until harvest (up to one year out).
pub const MAX_HARVEST_PRICE_ADJUSTMENT_BPS: i64 = 1_000;
pub const HARVEST_ADJUSTMENT_HORIZON_DAYS: u64 = 365;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum CommodityError {
    InvalidPurityGrade = 1,
    InvalidHarvestDate = 2,
    InvalidExpectedYield = 3,
}

/// Issue #172: metadata specific to agricultural commodities. Yields are
/// expressed in whole units of the crop (e.g. bushels) and dates are Unix
/// timestamps in seconds.
#[contracttype]
#[derive(Clone)]
pub struct AgriculturalConfig {
    pub crop_type: Symbol,
    pub planting_date: u64,
    pub harvest_date: u64,
    pub expected_yield: i128,
}

/// Issue #172: price discount (in basis points) applied while a crop is still
/// growing. Crops close to harvest trade near full value; the discount grows
/// with the time remaining until harvest.
pub fn harvest_price_adjustment_bps(now: u64, harvest_date: u64) -> i64 {
    if harvest_date <= now {
        return 0;
    }

    let days_remaining = (harvest_date - now) / SECONDS_PER_DAY;
    let bps = days_remaining.saturating_mul(MAX_HARVEST_PRICE_ADJUSTMENT_BPS as u64)
        / HARVEST_ADJUSTMENT_HORIZON_DAYS;

    if bps > MAX_HARVEST_PRICE_ADJUSTMENT_BPS as u64 {
        MAX_HARVEST_PRICE_ADJUSTMENT_BPS
    } else {
        bps as i64
    }
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
    validate_address_not_zero(&env, &commodity_config.custody_vault);
    validate_metadata_size(&env, base_config.metadata.len(), 100);

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

/// Issue #172: build an agricultural commodity configuration, validating the
/// crop's harvest cycle and recording the time-to-harvest price adjustment.
pub fn create_agricultural_config(
    env: Env,
    base_config: AssetConfig,
    agricultural_config: AgriculturalConfig,
) -> AssetConfig {
    if agricultural_config.harvest_date <= agricultural_config.planting_date {
        panic_with_error!(&env, CommodityError::InvalidHarvestDate);
    }

    if agricultural_config.expected_yield <= 0 {
        panic_with_error!(&env, CommodityError::InvalidExpectedYield);
    }

    validate_metadata_size(&env, base_config.metadata.len(), 100);

    let now = env.ledger().timestamp();
    let price_adjustment_bps =
        harvest_price_adjustment_bps(now, agricultural_config.harvest_date);

    let mut metadata = base_config.metadata;
    metadata.set(
        Symbol::new(&env, "commodity_subtype"),
        String::from_str(&env, "agricultural"),
    );
    metadata.set(
        Symbol::new(&env, "crop_type"),
        String::from_str(&env, &agricultural_config.crop_type.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "planting_date"),
        String::from_str(&env, &agricultural_config.planting_date.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "harvest_date"),
        String::from_str(&env, &agricultural_config.harvest_date.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "expected_yield"),
        String::from_str(&env, &agricultural_config.expected_yield.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "price_adjustment_bps"),
        String::from_str(&env, &price_adjustment_bps.to_string()),
    );

    AssetConfig {
        metadata,
        ..base_config
    }
}
