use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, Address, Env, Map, String, Symbol, Vec,
};

use crate::asset_factory::{AssetClass, AssetConfig, ComplianceRules, DividendSchedule};

pub use crate::art;
pub use crate::carbon_credit;
pub use crate::commodity;
pub use crate::intellectual_property;
pub use crate::invoice;
pub use crate::real_estate;
pub use crate::renewable_energy;
pub use crate::security;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AssetClassError {
    InvalidLocation = 1,
    InvalidPurityGrade = 2,
    InvalidDueDate = 3,
    InvalidCreditRating = 4,
    InvalidProvenance = 5,
    InvalidVintage = 6,
    UnauthorizedAccess = 7,
    InvalidParameters = 8,
    InvalidRegulationFramework = 9,
    InvalidVerificationStandard = 10,
    /// A debt security was configured without a valid coupon schedule
    /// (Issue #381). The numeric code is 12 so this addition does not reuse
    /// code 11, which is reserved for other in-flight validation work.
    InvalidCouponSchedule = 12,
}

// ── Shared Validation Helpers (Issue #179) ───────────────────────────────────

pub fn validate_metadata_size(env: &Env, metadata_len: u32, max_size: u32) {
    if metadata_len > max_size {
        panic_with_error!(env, AssetClassError::InvalidParameters);
    }
}

pub fn validate_address_not_zero(_env: &Env, _address: &Address) {
    // Address validity is guaranteed by Soroban SDK's Address type.
}

pub fn validate_date_range(env: &Env, start: u64, end: u64) {
    if start >= end {
        panic_with_error!(env, AssetClassError::InvalidDueDate);
    }
}

// ── Security coupon schedules (Issue #381) ───────────────────────────────────

/// `equity_type` values that identify a debt instrument rather than equity.
///
/// The existing `SecurityConfig::equity_type` field is reused so this change
/// needs no config-struct or storage migration. Clients tokenizing bonds pass
/// one of these values in that field.
pub const DEBT_SECURITY_TYPES: [&str; 5] = ["bond", "debt", "debenture", "note", "fixed_income"];

/// Inclusive bounds for a coupon period, in days. Monthly, quarterly,
/// semi-annual and annual coupons all fit inside this range.
pub const MIN_COUPON_FREQUENCY_DAYS: u32 = 1;
pub const MAX_COUPON_FREQUENCY_DAYS: u32 = 365;

/// Metadata key holding the debt instrument's maturity date (Unix seconds).
/// Debt securities must provide it so coupon dates can be checked against the
/// life of the instrument.
pub const MATURITY_DATE_KEY: &str = "maturity_date";
/// Metadata key for the validated coupon period in days.
pub const COUPON_FREQUENCY_DAYS_KEY: &str = "coupon_frequency_days";
/// Metadata key for the first validated coupon payment date.
pub const FIRST_COUPON_DATE_KEY: &str = "first_coupon_date";

/// Normalized coupon data shared by validation and metadata recording.
#[derive(Copy, Clone)]
struct CouponScheduleInfo {
    frequency_days: u32,
    first_coupon_date: u64,
    maturity_date: u64,
}

/// Whether a security type denotes a debt instrument.
pub fn is_debt_security(env: &Env, equity_type: &Symbol) -> bool {
    for candidate in DEBT_SECURITY_TYPES {
        if &Symbol::new(env, candidate) == equity_type {
            return true;
        }
    }
    false
}

fn read_maturity_date(env: &Env, base_config: &AssetConfig) -> u64 {
    let value = base_config
        .metadata
        .get(Symbol::new(env, MATURITY_DATE_KEY))
        .unwrap_or_else(|| panic_with_error!(env, AssetClassError::InvalidCouponSchedule));

    value
        .to_string()
        .parse::<u64>()
        .unwrap_or_else(|_| panic_with_error!(env, AssetClassError::InvalidCouponSchedule))
}

/// Validate a debt instrument's coupon schedule before any config is changed.
///
/// For debt securities (`equity_type` in [`DEBT_SECURITY_TYPES`]) the caller
/// must supply exactly one active entry in `AssetConfig::dividend_schedule`
/// and a parseable future `maturity_date` metadata value. The first coupon
/// date must be strictly after the current ledger timestamp and no later than
/// maturity; the coupon frequency must be 1..=365 days and previously
/// distributed coupons must not be negative. Equity securities are untouched.
///
/// This is a pure check: it neither requires authorization nor writes storage.
/// Authorization remains with the asset factory that invokes these handlers.
pub fn validate_security_coupon_schedule(
    env: &Env,
    base_config: &AssetConfig,
    security_config: &security::SecurityConfig,
) {
    if !is_debt_security(env, &security_config.equity_type) {
        return;
    }

    let _ = validated_coupon_info(env, base_config);
}

fn validated_coupon_info(env: &Env, base_config: &AssetConfig) -> CouponScheduleInfo {
    if base_config.dividend_schedule.len() != 1 {
        panic_with_error!(env, AssetClassError::InvalidCouponSchedule);
    }

    let schedule = base_config
        .dividend_schedule
        .get(0)
        .unwrap_or_else(|| panic_with_error!(env, AssetClassError::InvalidCouponSchedule));
    let now = env.ledger().timestamp();
    let maturity_date = read_maturity_date(env, base_config);

    if !schedule.is_active
        || schedule.frequency_days < MIN_COUPON_FREQUENCY_DAYS
        || schedule.frequency_days > MAX_COUPON_FREQUENCY_DAYS
        || schedule.next_distribution_date <= now
        || schedule.next_distribution_date > maturity_date
        || maturity_date <= now
        || schedule.total_distributed < 0
    {
        panic_with_error!(env, AssetClassError::InvalidCouponSchedule);
    }

    CouponScheduleInfo {
        frequency_days: schedule.frequency_days,
        first_coupon_date: schedule.next_distribution_date,
        maturity_date,
    }
}

fn record_coupon_schedule(env: &Env, metadata: &mut Map<Symbol, String>, info: CouponScheduleInfo) {
    metadata.set(
        Symbol::new(env, COUPON_FREQUENCY_DAYS_KEY),
        String::from_str(env, &info.frequency_days.to_string()),
    );
    metadata.set(
        Symbol::new(env, FIRST_COUPON_DATE_KEY),
        String::from_str(env, &info.first_coupon_date.to_string()),
    );
    metadata.set(
        Symbol::new(env, MATURITY_DATE_KEY),
        String::from_str(env, &info.maturity_date.to_string()),
    );
}

#[contract]
pub struct AssetClassHandlers;

#[contractimpl]
impl AssetClassHandlers {
    pub fn create_real_estate_config(
        env: Env,
        base_config: AssetConfig,
        real_estate_config: real_estate::RealEstateConfig,
    ) -> AssetConfig {
        real_estate::create_real_estate_config(env, base_config, real_estate_config)
    }

    pub fn create_commodity_config(
        env: Env,
        base_config: AssetConfig,
        commodity_config: commodity::CommodityConfig,
    ) -> AssetConfig {
        commodity::create_commodity_config(env, base_config, commodity_config)
    }

    /// Issue #172: agricultural commodity sub-type with harvest cycle metadata.
    pub fn create_agricultural_config(
        env: Env,
        base_config: AssetConfig,
        agricultural_config: commodity::AgriculturalConfig,
    ) -> AssetConfig {
        commodity::create_agricultural_config(env, base_config, agricultural_config)
    }

    pub fn create_invoice_config(
        env: Env,
        base_config: AssetConfig,
        invoice_config: invoice::InvoiceConfig,
    ) -> AssetConfig {
        invoice::create_invoice_config(env, base_config, invoice_config)
    }

    /// Create a security config. Debt instruments (bonds, debentures, notes,
    /// fixed-income and generic debt types) must include a valid coupon
    /// schedule; see [`validate_security_coupon_schedule`] for the rules.
    pub fn create_security_config(
        env: Env,
        base_config: AssetConfig,
        security_config: security::SecurityConfig,
    ) -> AssetConfig {
        // Validate everything before delegating so a rejected config cannot
        // produce a partially initialized security.
        let coupon_info = if is_debt_security(&env, &security_config.equity_type) {
            Some(validated_coupon_info(&env, &base_config))
        } else {
            None
        };

        let mut config =
            security::create_security_config(env.clone(), base_config, security_config);

        if let Some(info) = coupon_info {
            record_coupon_schedule(&env, &mut config.metadata, info);
        }

        config
    }

    pub fn create_art_config(
        env: Env,
        base_config: AssetConfig,
        art_config: art::ArtConfig,
    ) -> AssetConfig {
        art::create_art_config(env, base_config, art_config)
    }

    pub fn create_carbon_credit_config(
        env: Env,
        base_config: AssetConfig,
        carbon_config: carbon_credit::CarbonCreditConfig,
    ) -> AssetConfig {
        carbon_credit::create_carbon_credit_config(env, base_config, carbon_config)
    }

    pub fn create_rec_config(
        env: Env,
        base_config: AssetConfig,
        rec_config: renewable_energy::RECConfig,
    ) -> AssetConfig {
        renewable_energy::create_rec_config(env, base_config, rec_config)
    }

    /// Issue #170: intellectual property asset class (patents, trademarks,
    /// copyrights and trade secrets).
    pub fn create_ip_config(
        env: Env,
        base_config: AssetConfig,
        ip_config: intellectual_property::IPConfig,
    ) -> AssetConfig {
        intellectual_property::create_ip_config(env, base_config, ip_config)
    }

    /// Get default compliance rules for asset class
    pub fn get_default_compliance_rules(env: Env, asset_class: AssetClass) -> ComplianceRules {
        match asset_class {
            AssetClass::RealEstate => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: false,
                geographic_restrictions: Vec::new(&env),
                holding_period_days: 90,
                transfer_limits: 1000000,
            },
            AssetClass::Commodity => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: false,
                geographic_restrictions: Vec::new(&env),
                holding_period_days: 0,
                transfer_limits: 5000000,
            },
            AssetClass::Invoice => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: true,
                geographic_restrictions: Vec::new(&env),
                holding_period_days: 30,
                transfer_limits: 2500000,
            },
            AssetClass::Security => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: true,
                geographic_restrictions: Vec::from_array(
                    &env,
                    [
                        Symbol::new(&env, "US"),
                        Symbol::new(&env, "EU"),
                        Symbol::new(&env, "UK"),
                    ],
                ),
                holding_period_days: 365,
                transfer_limits: 100000,
            },
            AssetClass::Art => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: false,
                geographic_restrictions: Vec::new(&env),
                holding_period_days: 180,
                transfer_limits: 500000,
            },
            AssetClass::CarbonCredit => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: false,
                geographic_restrictions: Vec::new(&env),
                holding_period_days: 0,
                transfer_limits: 10000000,
            },
            AssetClass::RenewableEnergy => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: false,
                geographic_restrictions: Vec::new(&env),
                holding_period_days: 0,
                transfer_limits: 10000000,
            },
            AssetClass::IntellectualProperty => ComplianceRules {
                kyc_required: true,
                accredited_investor_only: false,
                geographic_restrictions: Vec::new(&env),
                holding_period_days: intellectual_property::IP_HOLDING_PERIOD_DAYS,
                transfer_limits: intellectual_property::IP_TRANSFER_LIMIT,
            },
        }
    }

    /// Get default dividend schedule for asset class
    pub fn get_default_dividend_schedule(
        env: Env,
        asset_class: AssetClass,
    ) -> Option<DividendSchedule> {
        match asset_class {
            AssetClass::RealEstate => Some(DividendSchedule {
                frequency_days: 90,
                next_distribution_date: env.ledger().timestamp() + (90 * 86400),
                total_distributed: 0,
                is_active: true,
            }),
            AssetClass::Commodity => None,
            AssetClass::Invoice => Some(DividendSchedule {
                frequency_days: 30,
                next_distribution_date: env.ledger().timestamp() + (30 * 86400),
                total_distributed: 0,
                is_active: true,
            }),
            AssetClass::Security => Some(DividendSchedule {
                frequency_days: 90,
                next_distribution_date: env.ledger().timestamp() + (90 * 86400),
                total_distributed: 0,
                is_active: true,
            }),
            AssetClass::Art => None,
            AssetClass::CarbonCredit => None,
            AssetClass::RenewableEnergy => None,
            AssetClass::IntellectualProperty => None,
        }
    }
}
