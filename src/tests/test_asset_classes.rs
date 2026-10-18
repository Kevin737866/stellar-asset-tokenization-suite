#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Map, Symbol, Vec,
};

use crate::asset_class_handlers::AssetClassHandlers;
use crate::asset_factory::{AssetClass, AssetConfig, ComplianceRules};
use crate::commodity::{self, AgriculturalConfig};
use crate::intellectual_property::{self, IPConfig};
use crate::real_estate::{self, RealEstateConfig};

// ── helpers ──────────────────────────────────────────────────────────────────

fn base_config(env: &Env) -> AssetConfig {
    AssetConfig {
        name: Symbol::new(env, "TestAsset"),
        symbol: Symbol::new(env, "TA"),
        decimals: 6,
        total_supply: 1_000_000i128,
        asset_class: AssetClass::RealEstate,
        compliance_rules: ComplianceRules {
            kyc_required: true,
            accredited_investor_only: false,
            geographic_restrictions: Vec::new(env),
            holding_period_days: 0,
            transfer_limits: 1_000_000i128,
        },
        dividend_schedule: Vec::new(env),
        metadata: Map::new(env),
    }
}

fn real_estate_config(env: &Env, appraisal_value: i128) -> RealEstateConfig {
    RealEstateConfig {
        property_address: Symbol::new(env, "123MainSt"),
        location_oracle: Address::generate(env),
        rental_yield_rate: 500,
        property_management_voting: true,
        insurance_status: true,
        appraisal_value,
    }
}

fn ip_config(env: &Env, ip_type: &str, expiry_date: u64) -> IPConfig {
    IPConfig {
        ip_type: Symbol::new(env, ip_type),
        registration_number: Symbol::new(env, "US1234567"),
        jurisdiction: Symbol::new(env, "US"),
        owner: Address::generate(env),
        filing_date: 1_000,
        expiry_date,
        valuation: 2_500_000i128,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #171: real estate appraisal bounds
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
#[should_panic]
fn real_estate_appraisal_below_minimum_rejected() {
    let env = Env::default();
    real_estate::create_real_estate_config(
        env.clone(),
        base_config(&env),
        real_estate_config(&env, 9_999),
    );
}

#[test]
#[should_panic]
fn real_estate_appraisal_above_maximum_rejected() {
    let env = Env::default();
    real_estate::create_real_estate_config(
        env.clone(),
        base_config(&env),
        real_estate_config(&env, 10_000_000_001),
    );
}

#[test]
fn real_estate_appraisal_within_bounds_accepted() {
    let env = Env::default();

    for value in [10_000i128, 250_000, 10_000_000_000] {
        let config = real_estate::create_real_estate_config(
            env.clone(),
            base_config(&env),
            real_estate_config(&env, value),
        );
        let stored = config
            .metadata
            .get(Symbol::new(&env, "appraisal_value"))
            .unwrap();
        assert_eq!(
            stored,
            soroban_sdk::String::from_str(&env, &value.to_string())
        );
    }
}

#[test]
fn real_estate_bounds_are_configurable_constants() {
    assert_eq!(real_estate::MIN_APPRAISAL_VALUE, 10_000);
    assert_eq!(real_estate::MAX_APPRAISAL_VALUE, 10_000_000_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #172: agricultural commodity sub-class
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn valid_agricultural_config_records_harvest_cycle() {
    let env = Env::default();
    let planting_date = 1_000_000u64;
    let harvest_date = planting_date + 120 * 86_400;

    let config = commodity::create_agricultural_config(
        env.clone(),
        base_config(&env),
        AgriculturalConfig {
            crop_type: Symbol::new(&env, "wheat"),
            planting_date,
            harvest_date,
            expected_yield: 50_000i128,
        },
    );

    assert_eq!(
        config.metadata.get(Symbol::new(&env, "crop_type")).unwrap(),
        soroban_sdk::String::from_str(&env, "wheat")
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "harvest_date"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, &harvest_date.to_string())
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "expected_yield"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "50000")
    );
    assert!(config
        .metadata
        .contains_key(Symbol::new(&env, "price_adjustment_bps")));
}

#[test]
fn agricultural_subtype_metadata_is_set() {
    let env = Env::default();
    let config = commodity::create_agricultural_config(
        env.clone(),
        base_config(&env),
        AgriculturalConfig {
            crop_type: Symbol::new(&env, "corn"),
            planting_date: 0,
            harvest_date: 90 * 86_400,
            expected_yield: 1_000,
        },
    );

    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "commodity_subtype"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "agricultural")
    );
}

#[test]
#[should_panic]
fn agricultural_harvest_date_must_follow_planting_date() {
    let env = Env::default();
    commodity::create_agricultural_config(
        env.clone(),
        base_config(&env),
        AgriculturalConfig {
            crop_type: Symbol::new(&env, "wheat"),
            planting_date: 100,
            harvest_date: 100,
            expected_yield: 1_000,
        },
    );
}

#[test]
#[should_panic]
fn agricultural_expected_yield_must_be_positive() {
    let env = Env::default();
    commodity::create_agricultural_config(
        env.clone(),
        base_config(&env),
        AgriculturalConfig {
            crop_type: Symbol::new(&env, "wheat"),
            planting_date: 0,
            harvest_date: 100,
            expected_yield: 0,
        },
    );
}

#[test]
fn harvest_price_adjustment_shrinks_as_harvest_approaches() {
    let day = 86_400u64;

    // Harvested or past harvest: no discount.
    assert_eq!(commodity::harvest_price_adjustment_bps(100, 100), 0);
    assert_eq!(commodity::harvest_price_adjustment_bps(200, 100), 0);

    // A full year out: capped maximum discount.
    assert_eq!(
        commodity::harvest_price_adjustment_bps(0, 365 * day),
        commodity::MAX_HARVEST_PRICE_ADJUSTMENT_BPS
    );

    let far = commodity::harvest_price_adjustment_bps(0, 300 * day);
    let near = commodity::harvest_price_adjustment_bps(0, 30 * day);
    assert!(far > near);
    assert!(near >= 0);
    assert!(far <= commodity::MAX_HARVEST_PRICE_ADJUSTMENT_BPS);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #170: intellectual property asset class
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn valid_ip_config_creates_metadata() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);

    let config = intellectual_property::create_ip_config(
        env.clone(),
        base_config(&env),
        ip_config(&env, "patent", 1_000 + 365 * 86_400),
    );

    assert_eq!(
        config.metadata.get(Symbol::new(&env, "ip_type")).unwrap(),
        soroban_sdk::String::from_str(&env, "patent")
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "holding_period_days"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "180")
    );
}

#[test]
fn all_ip_types_are_accepted() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);

    for ip_type in ["patent", "trademark", "copyright", "trade_secret"] {
        intellectual_property::create_ip_config(
            env.clone(),
            base_config(&env),
            ip_config(&env, ip_type, 1_000 + 86_400),
        );
    }
}

#[test]
#[should_panic]
fn invalid_ip_type_rejected() {
    let env = Env::default();
    env.ledger().set_timestamp(1_000);
    intellectual_property::create_ip_config(
        env.clone(),
        base_config(&env),
        ip_config(&env, "trade_dress", 1_000 + 86_400),
    );
}

#[test]
#[should_panic]
fn expired_ip_rejected() {
    let env = Env::default();
    env.ledger().set_timestamp(5_000);
    intellectual_property::create_ip_config(
        env.clone(),
        base_config(&env),
        ip_config(&env, "patent", 5_000),
    );
}

#[test]
fn intellectual_property_defaults_match_spec() {
    let env = Env::default();
    let rules = AssetClassHandlers::get_default_compliance_rules(
        env.clone(),
        AssetClass::IntellectualProperty,
    );

    assert!(rules.kyc_required);
    assert_eq!(rules.holding_period_days, 180);
    assert_eq!(rules.transfer_limits, 1_000_000);

    assert!(AssetClassHandlers::get_default_dividend_schedule(
        env,
        AssetClass::IntellectualProperty,
    )
    .is_none());
}
