#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Map, Symbol, Vec,
};

use crate::asset_class_handlers::{self, AssetClassHandlers};
use crate::asset_factory::{AssetClass, AssetConfig, ComplianceRules, DividendSchedule};
use crate::commodity::{self, AgriculturalConfig};
use crate::intellectual_property::{self, IPConfig};
use crate::real_estate::{self, RealEstateConfig};
use crate::security::{DividendRights, SecurityConfig};

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

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #381: security coupon schedule validation for debt instruments
// ═══════════════════════════════════════════════════════════════════════════════

const COUPON_NOW: u64 = 1_800_000_000;
const COUPON_DAY: u64 = 86_400;

fn security_base_config(env: &Env, maturity_date: Option<u64>) -> AssetConfig {
    let mut config = base_config(env);
    config.asset_class = AssetClass::Security;

    if let Some(maturity) = maturity_date {
        config.metadata.set(
            Symbol::new(env, asset_class_handlers::MATURITY_DATE_KEY),
            soroban_sdk::String::from_str(env, &maturity.to_string()),
        );
    }

    config
}

fn debt_security_config(env: &Env, equity_type: &str) -> SecurityConfig {
    SecurityConfig {
        equity_type: Symbol::new(env, equity_type),
        regulation_framework: Symbol::new(env, "REG_D"),
        accreditation_required: true,
        holding_period_days: 90,
        regulatory_reporting: true,
        isin: Symbol::new(env, "US1234567890"),
        dividend_rights: DividendRights::Cumulative,
    }
}

fn coupon_schedule(
    frequency_days: u32,
    first_coupon_date: u64,
    total_distributed: i128,
    is_active: bool,
) -> DividendSchedule {
    DividendSchedule {
        frequency_days,
        next_distribution_date: first_coupon_date,
        total_distributed,
        is_active,
    }
}

fn with_schedule(mut config: AssetConfig, env: &Env, schedule: DividendSchedule) -> AssetConfig {
    let mut schedules = Vec::new(env);
    schedules.push_back(schedule);
    config.dividend_schedule = schedules;
    config
}

#[test]
fn asset_class_handlers_debt_security_accepts_valid_coupon_schedule_and_records_metadata() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let maturity = COUPON_NOW + 365 * COUPON_DAY;
    let first_coupon = COUPON_NOW + 90 * COUPON_DAY;
    let config = AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(maturity)),
            &env,
            coupon_schedule(90, first_coupon, 0, true),
        ),
        debt_security_config(&env, "bond"),
    );

    assert_eq!(
        config
            .metadata
            .get(Symbol::new(
                &env,
                asset_class_handlers::COUPON_FREQUENCY_DAYS_KEY
            ))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "90")
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(
                &env,
                asset_class_handlers::FIRST_COUPON_DATE_KEY
            ))
            .unwrap(),
        soroban_sdk::String::from_str(&env, &first_coupon.to_string())
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, asset_class_handlers::MATURITY_DATE_KEY))
            .unwrap(),
        soroban_sdk::String::from_str(&env, &maturity.to_string())
    );
    assert!(config.compliance_rules.accredited_investor_only);
    assert_eq!(config.compliance_rules.holding_period_days, 90);
}

#[test]
fn asset_class_handlers_equity_security_without_coupon_schedule_is_unchanged() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let config = AssetClassHandlers::create_security_config(
        env.clone(),
        security_base_config(&env, None),
        debt_security_config(&env, "common_stock"),
    );

    assert!(config
        .metadata
        .get(Symbol::new(
            &env,
            asset_class_handlers::COUPON_FREQUENCY_DAYS_KEY
        ))
        .is_none());
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "equity_type"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "common_stock")
    );
}

#[test]
fn asset_class_handlers_all_debt_security_types_are_recognized() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    for equity_type in asset_class_handlers::DEBT_SECURITY_TYPES {
        AssetClassHandlers::create_security_config(
            env.clone(),
            with_schedule(
                security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
                &env,
                coupon_schedule(365, COUPON_NOW + COUPON_DAY, 0, true),
            ),
            debt_security_config(&env, equity_type),
        );
    }
}

#[test]
fn asset_class_handlers_debt_security_accepts_annual_frequency_boundary() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let config = AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
            &env,
            coupon_schedule(
                asset_class_handlers::MAX_COUPON_FREQUENCY_DAYS,
                COUPON_NOW + COUPON_DAY,
                0,
                true,
            ),
        ),
        debt_security_config(&env, "bond"),
    );

    assert_eq!(
        config
            .metadata
            .get(Symbol::new(
                &env,
                asset_class_handlers::COUPON_FREQUENCY_DAYS_KEY
            ))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "365")
    );
}

#[test]
fn asset_class_handlers_debt_security_accepts_first_coupon_one_second_after_now() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let first_coupon = COUPON_NOW + 1;
    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + COUPON_DAY)),
            &env,
            coupon_schedule(1, first_coupon, 0, true),
        ),
        debt_security_config(&env, "note"),
    );
}

#[test]
fn asset_class_handlers_debt_security_accepts_coupon_on_maturity_boundary() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let maturity = COUPON_NOW + 30 * COUPON_DAY;
    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(maturity)),
            &env,
            coupon_schedule(30, maturity, 0, true),
        ),
        debt_security_config(&env, "debenture"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_requires_coupon_schedule() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_multiple_coupon_schedules() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let mut config = security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY));
    let mut schedules = Vec::new(&env);
    schedules.push_back(coupon_schedule(30, COUPON_NOW + COUPON_DAY, 0, true));
    schedules.push_back(coupon_schedule(90, COUPON_NOW + COUPON_DAY, 0, true));
    config.dividend_schedule = schedules;

    AssetClassHandlers::create_security_config(
        env.clone(),
        config,
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_zero_coupon_frequency() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
            &env,
            coupon_schedule(0, COUPON_NOW + COUPON_DAY, 0, true),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_frequency_above_annual() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
            &env,
            coupon_schedule(
                asset_class_handlers::MAX_COUPON_FREQUENCY_DAYS + 1,
                COUPON_NOW + COUPON_DAY,
                0,
                true,
            ),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_coupon_at_current_time() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + COUPON_DAY)),
            &env,
            coupon_schedule(1, COUPON_NOW, 0, true),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_coupon_after_maturity() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + 30 * COUPON_DAY)),
            &env,
            coupon_schedule(30, COUPON_NOW + 31 * COUPON_DAY, 0, true),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_missing_maturity_date() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, None),
            &env,
            coupon_schedule(30, COUPON_NOW + COUPON_DAY, 0, true),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_past_maturity_date() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW - 1)),
            &env,
            coupon_schedule(30, COUPON_NOW + COUPON_DAY, 0, true),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_malformed_maturity_date() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let mut config = security_base_config(&env, None);
    config.metadata.set(
        Symbol::new(&env, asset_class_handlers::MATURITY_DATE_KEY),
        soroban_sdk::String::from_str(&env, "not-a-timestamp"),
    );

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            config,
            &env,
            coupon_schedule(30, COUPON_NOW + COUPON_DAY, 0, true),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_negative_distributed_coupons() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
            &env,
            coupon_schedule(30, COUPON_NOW + COUPON_DAY, -1, true),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
#[should_panic]
fn asset_class_handlers_debt_security_rejects_inactive_coupon_schedule() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    AssetClassHandlers::create_security_config(
        env.clone(),
        with_schedule(
            security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
            &env,
            coupon_schedule(30, COUPON_NOW + COUPON_DAY, 0, false),
        ),
        debt_security_config(&env, "bond"),
    );
}

#[test]
fn asset_class_handlers_coupon_validation_helper_matches_contract_behavior() {
    let env = Env::default();
    env.ledger().set_timestamp(COUPON_NOW);

    let security_config = debt_security_config(&env, "fixed_income");
    let base_config = with_schedule(
        security_base_config(&env, Some(COUPON_NOW + 365 * COUPON_DAY)),
        &env,
        coupon_schedule(90, COUPON_NOW + 90 * COUPON_DAY, 250, true),
    );

    assert!(asset_class_handlers::is_debt_security(
        &env,
        &security_config.equity_type
    ));
    assert!(!asset_class_handlers::is_debt_security(
        &env,
        &Symbol::new(&env, "common")
    ));
    asset_class_handlers::validate_security_coupon_schedule(&env, &base_config, &security_config);
    assert_eq!(
        asset_class_handlers::AssetClassError::InvalidCouponSchedule as u32,
        12
    );
}
