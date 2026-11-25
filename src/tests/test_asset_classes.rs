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
use crate::renewable_energy::{self, EnergyUnit, MeterReadingConfig, MeterReadingPeriod};

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
// Issue #383: renewable-energy meter reading periods and units
// ═══════════════════════════════════════════════════════════════════════════════

fn hourly_meter_config(env: &Env) -> MeterReadingConfig {
    MeterReadingConfig {
        meter_id: Symbol::new(env, "METER01"),
        period: MeterReadingPeriod::Hourly,
        unit: EnergyUnit::KWh,
        start_timestamp: 1_000_000,
        end_timestamp: 1_000_000 + 3_600,
        reading_value: 250,
    }
}

// ── success path ──────────────────────────────────────────────────────────────

#[test]
fn hourly_meter_reading_records_all_metadata() {
    let env = Env::default();
    let config =
        renewable_energy::create_meter_reading_config(env.clone(), base_config(&env), hourly_meter_config(&env));

    assert_eq!(
        config.metadata.get(Symbol::new(&env, "reading_period")).unwrap(),
        soroban_sdk::String::from_str(&env, "hourly")
    );
    assert_eq!(
        config.metadata.get(Symbol::new(&env, "energy_unit")).unwrap(),
        soroban_sdk::String::from_str(&env, "kWh")
    );
    assert_eq!(
        config.metadata.get(Symbol::new(&env, "meter_id")).unwrap(),
        soroban_sdk::String::from_str(&env, "METER01")
    );
    assert_eq!(
        config.metadata.get(Symbol::new(&env, "reading_value")).unwrap(),
        soroban_sdk::String::from_str(&env, "250")
    );
    assert_eq!(
        config.metadata.get(Symbol::new(&env, "period_start")).unwrap(),
        soroban_sdk::String::from_str(&env, "1000000")
    );
    assert_eq!(
        config.metadata.get(Symbol::new(&env, "period_end")).unwrap(),
        soroban_sdk::String::from_str(&env, "1003600")
    );
}

#[test]
fn reading_wh_normalisation_is_correct_for_kwh() {
    let env = Env::default();
    // 250 kWh → 250 000 Wh
    let config =
        renewable_energy::create_meter_reading_config(env.clone(), base_config(&env), hourly_meter_config(&env));
    assert_eq!(
        config.metadata.get(Symbol::new(&env, "reading_wh")).unwrap(),
        soroban_sdk::String::from_str(&env, "250000")
    );
}

#[test]
fn reading_wh_normalisation_is_correct_for_mwh() {
    let env = Env::default();
    // 1 MWh daily period → 1 000 000 Wh
    let config = renewable_energy::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        MeterReadingConfig {
            meter_id: Symbol::new(&env, "METER02"),
            period: MeterReadingPeriod::Daily,
            unit: EnergyUnit::MWh,
            start_timestamp: 0,
            end_timestamp: 86_400,
            reading_value: 1,
        },
    );
    assert_eq!(
        config.metadata.get(Symbol::new(&env, "reading_wh")).unwrap(),
        soroban_sdk::String::from_str(&env, "1000000")
    );
}

#[test]
fn all_periods_accepted_with_correct_duration() {
    let env = Env::default();
    let cases: &[(MeterReadingPeriod, u64, &str)] = &[
        (MeterReadingPeriod::Hourly,    3_600,      "hourly"),
        (MeterReadingPeriod::Daily,     86_400,     "daily"),
        (MeterReadingPeriod::Weekly,    604_800,    "weekly"),
        (MeterReadingPeriod::Monthly,   2_592_000,  "monthly"),
        (MeterReadingPeriod::Quarterly, 7_776_000,  "quarterly"),
        (MeterReadingPeriod::Annual,    31_536_000, "annual"),
    ];

    for (period, duration, label) in cases {
        let config = renewable_energy::create_meter_reading_config(
            env.clone(),
            base_config(&env),
            MeterReadingConfig {
                meter_id: Symbol::new(&env, "M"),
                period: *period,
                unit: EnergyUnit::KWh,
                start_timestamp: 1_000_000,
                end_timestamp: 1_000_000 + duration,
                reading_value: 10,
            },
        );
        assert_eq!(
            config.metadata.get(Symbol::new(&env, "reading_period")).unwrap(),
            soroban_sdk::String::from_str(&env, label)
        );
    }
}

#[test]
fn all_units_accepted_and_labelled_correctly() {
    let env = Env::default();
    let cases: &[(EnergyUnit, &str)] = &[
        (EnergyUnit::Wh,  "Wh"),
        (EnergyUnit::KWh, "kWh"),
        (EnergyUnit::MWh, "MWh"),
        (EnergyUnit::GWh, "GWh"),
    ];

    for (unit, label) in cases {
        let config = renewable_energy::create_meter_reading_config(
            env.clone(),
            base_config(&env),
            MeterReadingConfig {
                meter_id: Symbol::new(&env, "M"),
                period: MeterReadingPeriod::Hourly,
                unit: *unit,
                start_timestamp: 0,
                end_timestamp: 3_600,
                reading_value: 1,
            },
        );
        assert_eq!(
            config.metadata.get(Symbol::new(&env, "energy_unit")).unwrap(),
            soroban_sdk::String::from_str(&env, label)
        );
    }
}

#[test]
fn handler_delegates_to_renewable_energy_module() {
    let env = Env::default();
    let config = AssetClassHandlers::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        hourly_meter_config(&env),
    );
    assert!(config.metadata.contains_key(Symbol::new(&env, "reading_period")));
    assert!(config.metadata.contains_key(Symbol::new(&env, "energy_unit")));
}

// ── period helper unit tests ──────────────────────────────────────────────────

#[test]
fn period_duration_seconds_matches_spec() {
    assert_eq!(renewable_energy::period_duration_seconds(MeterReadingPeriod::Hourly),    3_600);
    assert_eq!(renewable_energy::period_duration_seconds(MeterReadingPeriod::Daily),     86_400);
    assert_eq!(renewable_energy::period_duration_seconds(MeterReadingPeriod::Weekly),    604_800);
    assert_eq!(renewable_energy::period_duration_seconds(MeterReadingPeriod::Monthly),   2_592_000);
    assert_eq!(renewable_energy::period_duration_seconds(MeterReadingPeriod::Quarterly), 7_776_000);
    assert_eq!(renewable_energy::period_duration_seconds(MeterReadingPeriod::Annual),    31_536_000);
}

#[test]
fn unit_wh_multiplier_matches_spec() {
    assert_eq!(renewable_energy::unit_wh_multiplier(EnergyUnit::Wh),  1);
    assert_eq!(renewable_energy::unit_wh_multiplier(EnergyUnit::KWh), 1_000);
    assert_eq!(renewable_energy::unit_wh_multiplier(EnergyUnit::MWh), 1_000_000);
    assert_eq!(renewable_energy::unit_wh_multiplier(EnergyUnit::GWh), 1_000_000_000);
}

// ── failure / boundary cases ──────────────────────────────────────────────────

#[test]
#[should_panic]
fn reading_value_zero_rejected() {
    let env = Env::default();
    renewable_energy::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        MeterReadingConfig {
            meter_id: Symbol::new(&env, "M"),
            period: MeterReadingPeriod::Hourly,
            unit: EnergyUnit::KWh,
            start_timestamp: 0,
            end_timestamp: 3_600,
            reading_value: 0,
        },
    );
}

#[test]
#[should_panic]
fn reading_value_negative_rejected() {
    let env = Env::default();
    renewable_energy::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        MeterReadingConfig {
            meter_id: Symbol::new(&env, "M"),
            period: MeterReadingPeriod::Hourly,
            unit: EnergyUnit::KWh,
            start_timestamp: 0,
            end_timestamp: 3_600,
            reading_value: -1,
        },
    );
}

#[test]
#[should_panic]
fn end_before_start_rejected() {
    let env = Env::default();
    renewable_energy::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        MeterReadingConfig {
            meter_id: Symbol::new(&env, "M"),
            period: MeterReadingPeriod::Hourly,
            unit: EnergyUnit::KWh,
            start_timestamp: 1_000,
            end_timestamp: 500,
            reading_value: 100,
        },
    );
}

#[test]
#[should_panic]
fn end_equal_to_start_rejected() {
    let env = Env::default();
    renewable_energy::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        MeterReadingConfig {
            meter_id: Symbol::new(&env, "M"),
            period: MeterReadingPeriod::Hourly,
            unit: EnergyUnit::KWh,
            start_timestamp: 1_000,
            end_timestamp: 1_000,
            reading_value: 100,
        },
    );
}

#[test]
#[should_panic]
fn duration_mismatch_with_period_rejected() {
    let env = Env::default();
    // Hourly period but 2-hour window → invalid
    renewable_energy::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        MeterReadingConfig {
            meter_id: Symbol::new(&env, "M"),
            period: MeterReadingPeriod::Hourly,
            unit: EnergyUnit::KWh,
            start_timestamp: 0,
            end_timestamp: 7_200, // 2 hours, not 1
            reading_value: 100,
        },
    );
}

#[test]
#[should_panic]
fn daily_period_with_hourly_window_rejected() {
    let env = Env::default();
    renewable_energy::create_meter_reading_config(
        env.clone(),
        base_config(&env),
        MeterReadingConfig {
            meter_id: Symbol::new(&env, "M"),
            period: MeterReadingPeriod::Daily,
            unit: EnergyUnit::MWh,
            start_timestamp: 0,
            end_timestamp: 3_600, // 1 hour, not 24
            reading_value: 5,
        },
    );
}
