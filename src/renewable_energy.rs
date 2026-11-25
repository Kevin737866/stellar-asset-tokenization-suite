use soroban_sdk::{contracterror, contracttype, Env, Symbol, panic_with_error, String};
use crate::asset_factory::AssetConfig;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum RECError {
    InvalidEnergySource = 1,
    InvalidMWhAmount = 2,
    ExpiredCompliancePeriod = 3,
    InvalidReadingPeriod = 4,
    InvalidEnergyUnit = 5,
    InvalidMeterReading = 6,
    ReadingPeriodEndBeforeStart = 7,
}

/// Issue #383: Supported meter-reading billing/settlement periods for
/// renewable-energy assets.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum MeterReadingPeriod {
    Hourly = 0,
    Daily = 1,
    Weekly = 2,
    Monthly = 3,
    Quarterly = 4,
    Annual = 5,
}

/// Issue #383: Supported energy measurement units for meter readings.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum EnergyUnit {
    Wh = 0,
    KWh = 1,
    MWh = 2,
    GWh = 3,
}

/// Issue #383: Configuration for a renewable-energy meter reading interval.
/// `start_timestamp` and `end_timestamp` are Unix timestamps (seconds).
/// `reading_value` is expressed in the given `unit` as a fixed-point integer
/// (e.g. milliwatt-hours when `unit == Wh`); it must be strictly positive.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MeterReadingConfig {
    pub meter_id: Symbol,
    pub period: MeterReadingPeriod,
    pub unit: EnergyUnit,
    pub start_timestamp: u64,
    pub end_timestamp: u64,
    pub reading_value: i128,
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

// ── Meter-reading period helpers ─────────────────────────────────────────────

/// Returns the nominal duration in seconds for each `MeterReadingPeriod`.
/// Monthly uses 30 days and Annual uses 365 days as standard approximations.
pub fn period_duration_seconds(period: MeterReadingPeriod) -> u64 {
    match period {
        MeterReadingPeriod::Hourly    =>       3_600,
        MeterReadingPeriod::Daily     =>      86_400,
        MeterReadingPeriod::Weekly    =>     604_800,
        MeterReadingPeriod::Monthly   =>   2_592_000,  // 30 × 86 400
        MeterReadingPeriod::Quarterly =>   7_776_000,  // 90 × 86 400
        MeterReadingPeriod::Annual    =>  31_536_000,  // 365 × 86 400
    }
}

/// Returns the SI multiplier (relative to Wh) for each `EnergyUnit`.
pub fn unit_wh_multiplier(unit: EnergyUnit) -> u64 {
    match unit {
        EnergyUnit::Wh  =>           1,
        EnergyUnit::KWh =>       1_000,
        EnergyUnit::MWh =>   1_000_000,
        EnergyUnit::GWh => 1_000_000_000,
    }
}

/// Issue #383: Validate and record a meter reading interval in the asset
/// metadata.  Rules:
///   - `end_timestamp` must be strictly after `start_timestamp`
///   - the interval must equal the nominal duration of `period` exactly
///   - `reading_value` must be strictly positive
pub fn create_meter_reading_config(
    env: Env,
    base_config: AssetConfig,
    meter_config: MeterReadingConfig,
) -> AssetConfig {
    if meter_config.end_timestamp <= meter_config.start_timestamp {
        panic_with_error!(&env, RECError::ReadingPeriodEndBeforeStart);
    }

    let expected_duration = period_duration_seconds(meter_config.period);
    let actual_duration = meter_config.end_timestamp - meter_config.start_timestamp;
    if actual_duration != expected_duration {
        panic_with_error!(&env, RECError::InvalidReadingPeriod);
    }

    if meter_config.reading_value <= 0 {
        panic_with_error!(&env, RECError::InvalidMeterReading);
    }

    let period_str = match meter_config.period {
        MeterReadingPeriod::Hourly    => "hourly",
        MeterReadingPeriod::Daily     => "daily",
        MeterReadingPeriod::Weekly    => "weekly",
        MeterReadingPeriod::Monthly   => "monthly",
        MeterReadingPeriod::Quarterly => "quarterly",
        MeterReadingPeriod::Annual    => "annual",
    };

    let unit_str = match meter_config.unit {
        EnergyUnit::Wh  => "Wh",
        EnergyUnit::KWh => "kWh",
        EnergyUnit::MWh => "MWh",
        EnergyUnit::GWh => "GWh",
    };

    let mut metadata = base_config.metadata;
    metadata.set(
        Symbol::new(&env, "meter_id"),
        String::from_str(&env, &meter_config.meter_id.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "reading_period"),
        String::from_str(&env, period_str),
    );
    metadata.set(
        Symbol::new(&env, "energy_unit"),
        String::from_str(&env, unit_str),
    );
    metadata.set(
        Symbol::new(&env, "period_start"),
        String::from_str(&env, &meter_config.start_timestamp.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "period_end"),
        String::from_str(&env, &meter_config.end_timestamp.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "reading_value"),
        String::from_str(&env, &meter_config.reading_value.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "reading_wh"),
        String::from_str(
            &env,
            &(meter_config.reading_value * unit_wh_multiplier(meter_config.unit) as i128)
                .to_string(),
        ),
    );

    AssetConfig {
        metadata,
        ..base_config
    }
}
