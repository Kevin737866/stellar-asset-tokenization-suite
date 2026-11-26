//! Asset-class configuration handlers (Issue #387).
//!
//! # Metadata contract
//!
//! Every `create_*_config` entry point is a *pure builder*: it receives a base
//! [`AssetConfig`] plus a class-specific configuration, validates the class
//! fields, and returns a new `AssetConfig` whose `metadata` map has been
//! extended with the class-specific keys listed below. Keys are Soroban
//! [`Symbol`]s and values are decimal/boolean/hex strings so that they can be
//! read uniformly by clients.
//!
//! | Handler | Required metadata keys written |
//! | --- | --- |
//! | [`AssetClassHandlers::create_real_estate_config`] | `property_address`, `location_oracle`, `rental_yield`, `insurance_status`, `appraisal_value` |
//! | [`AssetClassHandlers::create_commodity_config`] | `commodity_type`, `vault_location`, `purity_grade`, `redemption_window` |
//! | [`AssetClassHandlers::create_agricultural_config`] | `commodity_subtype`, `crop_type`, `planting_date`, `harvest_date`, `expected_yield`, `price_adjustment_bps` |
//! | [`AssetClassHandlers::create_invoice_config`] | `invoice_number`, `debtor_address`, `due_date`, `credit_rating`, `invoice_amount` |
//! | [`AssetClassHandlers::create_security_config`] | `equity_type`, `regulation_framework`, `isin`, `regulatory_reporting`, `dividend_rights` |
//! | [`AssetClassHandlers::create_art_config`] | `artist_name`, `provenance_hash`, `insurance_status`, `exhibition_voting`, `appraisal_value` |
//! | [`AssetClassHandlers::create_carbon_credit_config`] | `project_id`, `vintage_year`, `retirement_functionality`, `verification_standard`, `carbon_offset_amount`, plus one entry per `project_metadata` key |
//! | [`AssetClassHandlers::create_rec_config`] | `energy_source`, `mwh_amount`, `grid_region`, `compliance_period_expiry` |
//! | [`AssetClassHandlers::create_ip_config`] | `ip_type`, `registration_number`, `jurisdiction`, `owner`, `filing_date`, `expiry_date`, `valuation`, `holding_period_days`, `transfer_limit` |
//!
//! Common rules for all handlers:
//!
//! * A base config with more than **100** metadata entries is rejected with
//!   [`AssetClassError::InvalidParameters`] before any metadata is written.
//!   The renewable-energy handler is the one historical exception and does not
//!   apply this cap.
//! * Validation happens before the returned metadata map is constructed. A
//!   failed call panics with a typed error and therefore produces **no** new
//!   config; the caller's base config is left untouched.
//! * These builders do not read or write contract storage and perform no
//!   authorization checks. Authorization is the caller's responsibility (the
//!   asset factory checks its admin before invoking a handler). Passing a
//!   `location_oracle`, `custody_vault`, `debtor_address`,
//!   `authenticity_certificate` or IP `owner` is metadata, not permission to
//!   act on that address.
//! * Timestamps are Unix seconds taken from `env.ledger().timestamp()`.

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

#[contract]
pub struct AssetClassHandlers;

#[contractimpl]
impl AssetClassHandlers {
    /// Build a real-estate asset configuration.
    ///
    /// # Required fields and constraints
    /// - `property_address`: symbolic street address (e.g. `123MainSt`).
    /// - `location_oracle`: address of the location oracle; must be non-zero.
    /// - `rental_yield_rate`: basis points, inclusive range `0..=10000`.
    /// - `property_management_voting`: boolean flag (not written to metadata).
    /// - `insurance_status`: boolean flag, written as `"true"`/`"false"`.
    /// - `appraisal_value`: `10_000..=10_000_000_000` in base currency units.
    ///
    /// Writes `property_address`, `location_oracle`, `rental_yield`,
    /// `insurance_status` and `appraisal_value` into `base_config.metadata`.
    ///
    /// # Failure semantics
    /// Panics with `AssetClassError::InvalidParameters` when the yield rate or
    /// base metadata size is invalid, or `RealEstateError::AppraisalValueOutOfRange`
    /// when the appraisal is outside the allowed range. No config is returned.
    ///
    /// # Valid example
    /// ```text
    /// RealEstateConfig {
    ///     property_address: Symbol::new(&env, "123MainSt"),
    ///     location_oracle: Address::generate(&env),
    ///     rental_yield_rate: 500,          // 5.00%
    ///     property_management_voting: true,
    ///     insurance_status: true,
    ///     appraisal_value: 250_000_000,
    /// }
    /// ```
    pub fn create_real_estate_config(
        env: Env,
        base_config: AssetConfig,
        real_estate_config: real_estate::RealEstateConfig,
    ) -> AssetConfig {
        real_estate::create_real_estate_config(env, base_config, real_estate_config)
    }

    /// Build a generic commodity configuration.
    ///
    /// # Required fields and constraints
    /// - `commodity_type`, `vault_location`: free-form symbols.
    /// - `custody_vault`, `quality_attestation`: non-zero addresses; used for
    ///   validation only and not copied into metadata.
    /// - `purity_grade`: one of `999`, `995`, `990`, `750`.
    /// - `physical_redemption_window`: Unix seconds during which physical
    ///   redemption is allowed.
    ///
    /// Writes `commodity_type`, `vault_location`, `purity_grade` and
    /// `redemption_window` into `base_config.metadata`.
    ///
    /// # Failure semantics
    /// Panics with `AssetClassError::InvalidPurityGrade` for an unsupported
    /// grade, or `AssetClassError::InvalidParameters` when the base metadata is
    /// too large. No config is returned.
    ///
    /// # Valid example
    /// ```text
    /// CommodityConfig {
    ///     commodity_type: Symbol::new(&env, "gold"),
    ///     vault_location: Symbol::new(&env, "ZURICH"),
    ///     custody_vault: Address::generate(&env),
    ///     purity_grade: Symbol::new(&env, "999"),
    ///     physical_redemption_window: 2_592_000,
    ///     quality_attestation: Address::generate(&env),
    /// }
    /// ```
    pub fn create_commodity_config(
        env: Env,
        base_config: AssetConfig,
        commodity_config: commodity::CommodityConfig,
    ) -> AssetConfig {
        commodity::create_commodity_config(env, base_config, commodity_config)
    }

    /// Build an agricultural commodity configuration (Issue #172).
    ///
    /// # Required fields and constraints
    /// - `crop_type`: free-form symbol (e.g. `wheat`).
    /// - `planting_date`, `harvest_date`: Unix seconds; `harvest_date` must be
    ///   strictly greater than `planting_date`.
    /// - `expected_yield`: strictly positive whole crop units (e.g. bushels).
    ///
    /// Writes `commodity_subtype = "agricultural"`, `crop_type`,
    /// `planting_date`, `harvest_date`, `expected_yield` and
    /// `price_adjustment_bps` into `base_config.metadata`. The adjustment is
    /// `0..=1000` basis points: it grows linearly with the time left until
    /// harvest over a 365-day horizon and is `0` once harvest has arrived.
    ///
    /// # Failure semantics
    /// Panics with `CommodityError::InvalidHarvestDate`,
    /// `CommodityError::InvalidExpectedYield`, or
    /// `AssetClassError::InvalidParameters` for oversized base metadata. No
    /// config is returned.
    ///
    /// # Valid example
    /// ```text
    /// AgriculturalConfig {
    ///     crop_type: Symbol::new(&env, "wheat"),
    ///     planting_date: 1_700_000_000,
    ///     harvest_date: 1_701_000_000,
    ///     expected_yield: 12_500,
    /// }
    /// ```
    pub fn create_agricultural_config(
        env: Env,
        base_config: AssetConfig,
        agricultural_config: commodity::AgriculturalConfig,
    ) -> AssetConfig {
        commodity::create_agricultural_config(env, base_config, agricultural_config)
    }

    /// Build an invoice configuration.
    ///
    /// # Required fields and constraints
    /// - `invoice_number`: free-form symbol.
    /// - `debtor_address`: non-zero address (validated, not written verbatim
    ///   beyond the debug-format string in metadata).
    /// - `due_date`: Unix seconds strictly greater than the current ledger
    ///   timestamp.
    /// - `credit_rating`: one of `AAA`, `AA`, `A`, `BBB`, `BB`, `B`, `CCC`.
    /// - `automatic_settlement`: boolean flag (not written to metadata).
    /// - `invoice_amount`: face value in base currency units.
    ///
    /// Writes `invoice_number`, `debtor_address`, `due_date`, `credit_rating`
    /// and `invoice_amount` into `base_config.metadata`.
    ///
    /// # Failure semantics
    /// Panics with `AssetClassError::InvalidDueDate` when the due date is in
    /// the past/now, `AssetClassError::InvalidCreditRating` for an unsupported
    /// rating, or `AssetClassError::InvalidParameters` for oversized metadata.
    /// No config is returned.
    ///
    /// # Valid example
    /// ```text
    /// InvoiceConfig {
    ///     invoice_number: Symbol::new(&env, "INV-2026-001"),
    ///     debtor_address: Address::generate(&env),
    ///     due_date: env.ledger().timestamp() + 30 * 86_400,
    ///     credit_rating: Symbol::new(&env, "BBB"),
    ///     automatic_settlement: false,
    ///     invoice_amount: 75_000_000,
    /// }
    /// ```
    pub fn create_invoice_config(
        env: Env,
        base_config: AssetConfig,
        invoice_config: invoice::InvoiceConfig,
    ) -> AssetConfig {
        invoice::create_invoice_config(env, base_config, invoice_config)
    }

    /// Build a security (equity/debt) configuration.
    ///
    /// # Required fields and constraints
    /// - `equity_type`, `isin`: free-form symbols describing the instrument.
    /// - `regulation_framework`: one of `REG_D`, `REG_S`, `RULE_144`, `REG_A+`.
    /// - `accreditation_required`: boolean; overrides
    ///   `compliance_rules.accredited_investor_only`.
    /// - `holding_period_days`: overrides `compliance_rules.holding_period_days`.
    /// - `regulatory_reporting`: boolean flag.
    /// - `dividend_rights`: `Cumulative`, `NonCumulative`, `Participating` or
    ///   `NonParticipating`.
    ///
    /// Writes `equity_type`, `regulation_framework`, `isin`,
    /// `regulatory_reporting` and `dividend_rights` into
    /// `base_config.metadata`, and updates the two compliance fields above.
    ///
    /// # Failure semantics
    /// Panics with `AssetClassError::InvalidRegulationFramework` for an unknown
    /// framework or `AssetClassError::InvalidParameters` for oversized base
    /// metadata. No config is returned, so compliance rules are never partially
    /// updated.
    ///
    /// # Valid example
    /// ```text
    /// SecurityConfig {
    ///     equity_type: Symbol::new(&env, "common"),
    ///     regulation_framework: Symbol::new(&env, "REG_D"),
    ///     accreditation_required: true,
    ///     holding_period_days: 365,
    ///     regulatory_reporting: true,
    ///     isin: Symbol::new(&env, "US0378331005"),
    ///     dividend_rights: DividendRights::Cumulative,
    /// }
    /// ```
    pub fn create_security_config(
        env: Env,
        base_config: AssetConfig,
        security_config: security::SecurityConfig,
    ) -> AssetConfig {
        security::create_security_config(env, base_config, security_config)
    }

    /// Build an art configuration.
    ///
    /// # Required fields and constraints
    /// - `artist_name`: free-form symbol.
    /// - `provenance_hash`: 32-byte hash; an all-zero hash is rejected.
    /// - `insurance_status`, `exhibition_voting`: boolean flags.
    /// - `appraisal_value`: appraised value in base currency units (positive).
    /// - `authenticity_certificate`: non-zero attesting address.
    ///
    /// Writes `artist_name`, `provenance_hash` (debug hex), `insurance_status`,
    /// `exhibition_voting` and `appraisal_value` into `base_config.metadata`.
    ///
    /// # Failure semantics
    /// Panics with `AssetClassError::InvalidProvenance` for a zero hash or
    /// `AssetClassError::InvalidParameters` for oversized metadata. No config
    /// is returned.
    ///
    /// # Valid example
    /// ```text
    /// ArtConfig {
    ///     artist_name: Symbol::new(&env, "AdaLovelace"),
    ///     provenance_hash: BytesN::from_array(&env, &[7u8; 32]),
    ///     insurance_status: true,
    ///     exhibition_voting: false,
    ///     appraisal_value: 1_200_000,
    ///     authenticity_certificate: Address::generate(&env),
    /// }
    /// ```
    pub fn create_art_config(
        env: Env,
        base_config: AssetConfig,
        art_config: art::ArtConfig,
    ) -> AssetConfig {
        art::create_art_config(env, base_config, art_config)
    }

    /// Build a carbon-credit configuration.
    ///
    /// # Required fields and constraints
    /// - `project_id`: free-form symbol.
    /// - `vintage_year`: `1990..=` the year derived from the ledger timestamp.
    /// - `retirement_functionality`: boolean flag.
    /// - `verification_standard`: one of `VCS`, `GS`, `CDM`, `ACR`.
    /// - `carbon_offset_amount`: positive amount of offset tonnes.
    /// - `project_metadata`: map of symbol keys to symbol values; each entry is
    ///   copied into metadata after the standard keys and therefore overrides a
    ///   standard key when the names collide.
    ///
    /// Writes `project_id`, `vintage_year`, `retirement_functionality`,
    /// `verification_standard`, `carbon_offset_amount` and every
    /// `project_metadata` entry into `base_config.metadata`.
    ///
    /// # Failure semantics
    /// Panics with `AssetClassError::InvalidVintage`,
    /// `AssetClassError::InvalidVerificationStandard`, or
    /// `AssetClassError::InvalidParameters` for oversized base metadata. No
    /// config is returned.
    ///
    /// # Valid example
    /// ```text
    /// CarbonCreditConfig {
    ///     project_id: Symbol::new(&env, "PROJ-42"),
    ///     vintage_year: 2024,
    ///     retirement_functionality: true,
    ///     project_metadata: Map::new(&env),
    ///     verification_standard: Symbol::new(&env, "VCS"),
    ///     carbon_offset_amount: 10_000,
    /// }
    /// ```
    pub fn create_carbon_credit_config(
        env: Env,
        base_config: AssetConfig,
        carbon_config: carbon_credit::CarbonCreditConfig,
    ) -> AssetConfig {
        carbon_credit::create_carbon_credit_config(env, base_config, carbon_config)
    }

    /// Build a renewable-energy certificate (REC) configuration.
    ///
    /// # Required fields and constraints
    /// - `energy_source`: one of `SOLAR`, `WIND`, `HYDRO`, `GEOTHERMAL`.
    /// - `mwh_amount`: strictly positive megawatt hours.
    /// - `grid_region`: free-form symbol identifying the grid region.
    /// - `compliance_period_expiry`: Unix seconds strictly greater than the
    ///   current ledger timestamp.
    ///
    /// Writes `energy_source`, `mwh_amount`, `grid_region` and
    /// `compliance_period_expiry` into `base_config.metadata`, and forces
    /// `compliance_rules.holding_period_days = 0` and
    /// `compliance_rules.accredited_investor_only = false`.
    ///
    /// # Failure semantics
    /// Panics with `RECError::InvalidEnergySource`, `RECError::InvalidMWhAmount`
    /// or `RECError::ExpiredCompliancePeriod`. No config is returned, so
    /// compliance rules are never partially updated. Unlike the other
    /// handlers this builder does not enforce the 100-entry metadata cap.
    ///
    /// # Valid example
    /// ```text
    /// RECConfig {
    ///     energy_source: Symbol::new(&env, "SOLAR"),
    ///     mwh_amount: 500,
    ///     grid_region: Symbol::new(&env, "EU"),
    ///     compliance_period_expiry: env.ledger().timestamp() + 365 * 86_400,
    /// }
    /// ```
    pub fn create_rec_config(
        env: Env,
        base_config: AssetConfig,
        rec_config: renewable_energy::RECConfig,
    ) -> AssetConfig {
        renewable_energy::create_rec_config(env, base_config, rec_config)
    }

    /// Build an intellectual-property configuration (Issue #170).
    ///
    /// # Required fields and constraints
    /// - `ip_type`: one of `patent`, `trademark`, `copyright`, `trade_secret`.
    /// - `registration_number`, `jurisdiction`: free-form symbols.
    /// - `owner`: address of the rights holder (validated, not authorized).
    /// - `filing_date`: Unix seconds strictly less than `expiry_date`.
    /// - `expiry_date`: Unix seconds strictly greater than the current ledger
    ///   timestamp (a lapsed right cannot back a token).
    /// - `valuation`: strictly positive value in base currency units.
    ///
    /// Writes `ip_type`, `registration_number`, `jurisdiction`, `owner`,
    /// `filing_date`, `expiry_date`, `valuation`, plus the constants
    /// `holding_period_days = 180` and `transfer_limit = 1_000_000`, into
    /// `base_config.metadata`.
    ///
    /// # Failure semantics
    /// Panics with `IntellectualPropertyError::InvalidIpType`, `ExpiredIp`,
    /// `InvalidDates`, `InvalidValuation`, or
    /// `AssetClassError::InvalidParameters` for oversized metadata. No config
    /// is returned.
    ///
    /// # Valid example
    /// ```text
    /// IPConfig {
    ///     ip_type: Symbol::new(&env, "patent"),
    ///     registration_number: Symbol::new(&env, "US1234567"),
    ///     jurisdiction: Symbol::new(&env, "US"),
    ///     owner: Address::generate(&env),
    ///     filing_date: 1_700_000_000,
    ///     expiry_date: 1_900_000_000,
    ///     valuation: 2_500_000,
    /// }
    /// ```
    pub fn create_ip_config(
        env: Env,
        base_config: AssetConfig,
        ip_config: intellectual_property::IPConfig,
    ) -> AssetConfig {
        intellectual_property::create_ip_config(env, base_config, ip_config)
    }

    /// Return the default compliance rules for an asset class.
    ///
    /// KYC is required for every class. Accreditation is required for invoices,
    /// securities and IP; securities additionally restrict transfers to
    /// `US`, `EU` and `UK` and impose a 365-day holding period. All other
    /// classes use an empty geographic restriction list. These defaults are
    /// advisory: a class handler may override accreditation and holding period
    /// (security, REC) when building the final config.
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

    /// Return the default dividend schedule for an asset class.
    ///
    /// Real estate (90 days), invoices (30 days) and securities (90 days)
    /// receive an active schedule whose next distribution is offset from the
    /// current ledger timestamp. Commodities, art, carbon credits, renewable
    /// energy and IP return `None`.
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

#[cfg(test)]
mod metadata_tests {
    use super::*;
    use crate::asset_factory::{AssetClass, ComplianceRules};
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::BytesN;

    const NOW: u64 = 1_710_000_000;

    fn test_env() -> Env {
        let env = Env::default();
        env.ledger().set_timestamp(NOW);
        env
    }

    fn base(env: &Env) -> AssetConfig {
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

    fn assert_meta(env: &Env, config: &AssetConfig, key: &str, expected: &str) {
        let actual = config
            .metadata
            .get(Symbol::new(env, key))
            .unwrap_or_else(|| panic!("missing documented metadata key `{key}`"));
        assert_eq!(actual, String::from_str(env, expected));
    }

    #[test]
    fn asset_class_handlers_real_estate_example_writes_documented_metadata() {
        let env = test_env();
        let cfg = AssetClassHandlers::create_real_estate_config(
            env.clone(),
            base(&env),
            real_estate::RealEstateConfig {
                property_address: Symbol::new(&env, "123MainSt"),
                location_oracle: Address::generate(&env),
                rental_yield_rate: 500,
                property_management_voting: true,
                insurance_status: true,
                appraisal_value: 250_000_000,
            },
        );

        assert_eq!(cfg.metadata.len(), 5);
        assert_meta(&env, &cfg, "property_address", "123MainSt");
        assert_meta(&env, &cfg, "rental_yield", "500");
        assert_meta(&env, &cfg, "insurance_status", "true");
        assert_meta(&env, &cfg, "appraisal_value", "250000000");
        assert!(cfg
            .metadata
            .contains_key(Symbol::new(&env, "location_oracle")));
    }

    #[test]
    fn asset_class_handlers_commodity_example_writes_documented_metadata() {
        let env = test_env();
        let cfg = AssetClassHandlers::create_commodity_config(
            env.clone(),
            base(&env),
            commodity::CommodityConfig {
                commodity_type: Symbol::new(&env, "gold"),
                vault_location: Symbol::new(&env, "ZURICH"),
                custody_vault: Address::generate(&env),
                purity_grade: Symbol::new(&env, "999"),
                physical_redemption_window: 2_592_000,
                quality_attestation: Address::generate(&env),
            },
        );

        assert_eq!(cfg.metadata.len(), 4);
        assert_meta(&env, &cfg, "commodity_type", "gold");
        assert_meta(&env, &cfg, "vault_location", "ZURICH");
        assert_meta(&env, &cfg, "purity_grade", "999");
        assert_meta(&env, &cfg, "redemption_window", "2592000");
    }

    #[test]
    fn asset_class_handlers_agricultural_example_writes_documented_metadata() {
        let env = test_env();
        let harvest_date = NOW + 11 * 86_400;
        let cfg = AssetClassHandlers::create_agricultural_config(
            env.clone(),
            base(&env),
            commodity::AgriculturalConfig {
                crop_type: Symbol::new(&env, "wheat"),
                planting_date: NOW - 30 * 86_400,
                harvest_date,
                expected_yield: 12_500,
            },
        );

        assert_eq!(cfg.metadata.len(), 6);
        assert_meta(&env, &cfg, "commodity_subtype", "agricultural");
        assert_meta(&env, &cfg, "crop_type", "wheat");
        assert_meta(&env, &cfg, "expected_yield", "12500");
        assert_meta(
            &env,
            &cfg,
            "price_adjustment_bps",
            &commodity::harvest_price_adjustment_bps(NOW, harvest_date).to_string(),
        );
    }

    #[test]
    fn asset_class_handlers_invoice_example_writes_documented_metadata() {
        let env = test_env();
        let due_date = NOW + 30 * 86_400;
        let cfg = AssetClassHandlers::create_invoice_config(
            env.clone(),
            base(&env),
            invoice::InvoiceConfig {
                invoice_number: Symbol::new(&env, "INV-2026-001"),
                debtor_address: Address::generate(&env),
                due_date,
                credit_rating: Symbol::new(&env, "BBB"),
                automatic_settlement: false,
                invoice_amount: 75_000_000,
            },
        );

        assert_eq!(cfg.metadata.len(), 5);
        assert_meta(&env, &cfg, "invoice_number", "INV-2026-001");
        assert_meta(&env, &cfg, "due_date", &due_date.to_string());
        assert_meta(&env, &cfg, "credit_rating", "BBB");
        assert_meta(&env, &cfg, "invoice_amount", "75000000");
    }

    #[test]
    fn asset_class_handlers_security_example_updates_documented_fields() {
        let env = test_env();
        let cfg = AssetClassHandlers::create_security_config(
            env.clone(),
            base(&env),
            security::SecurityConfig {
                equity_type: Symbol::new(&env, "common"),
                regulation_framework: Symbol::new(&env, "REG_D"),
                accreditation_required: true,
                holding_period_days: 365,
                regulatory_reporting: true,
                isin: Symbol::new(&env, "US0378331005"),
                dividend_rights: security::DividendRights::Cumulative,
            },
        );

        assert_eq!(cfg.metadata.len(), 5);
        assert_meta(&env, &cfg, "equity_type", "common");
        assert_meta(&env, &cfg, "regulation_framework", "REG_D");
        assert_meta(&env, &cfg, "isin", "US0378331005");
        assert_meta(&env, &cfg, "regulatory_reporting", "true");
        assert_meta(&env, &cfg, "dividend_rights", "Cumulative");
        assert!(cfg.compliance_rules.accredited_investor_only);
        assert_eq!(cfg.compliance_rules.holding_period_days, 365);
    }

    #[test]
    fn asset_class_handlers_art_example_writes_documented_metadata() {
        let env = test_env();
        let cfg = AssetClassHandlers::create_art_config(
            env.clone(),
            base(&env),
            art::ArtConfig {
                artist_name: Symbol::new(&env, "AdaLovelace"),
                provenance_hash: BytesN::from_array(&env, &[7u8; 32]),
                insurance_status: true,
                exhibition_voting: false,
                appraisal_value: 1_200_000,
                authenticity_certificate: Address::generate(&env),
            },
        );

        assert_eq!(cfg.metadata.len(), 5);
        assert_meta(&env, &cfg, "artist_name", "AdaLovelace");
        assert_meta(&env, &cfg, "insurance_status", "true");
        assert_meta(&env, &cfg, "exhibition_voting", "false");
        assert_meta(&env, &cfg, "appraisal_value", "1200000");
        assert!(cfg
            .metadata
            .contains_key(Symbol::new(&env, "provenance_hash")));
    }

    #[test]
    fn asset_class_handlers_carbon_credit_example_writes_project_metadata() {
        let env = test_env();
        let mut project_metadata = Map::new(&env);
        project_metadata.set(Symbol::new(&env, "country"), Symbol::new(&env, "Kenya"));
        let cfg = AssetClassHandlers::create_carbon_credit_config(
            env.clone(),
            base(&env),
            carbon_credit::CarbonCreditConfig {
                project_id: Symbol::new(&env, "PROJ-42"),
                vintage_year: 2024,
                retirement_functionality: true,
                project_metadata,
                verification_standard: Symbol::new(&env, "VCS"),
                carbon_offset_amount: 10_000,
            },
        );

        assert_eq!(cfg.metadata.len(), 6);
        assert_meta(&env, &cfg, "project_id", "PROJ-42");
        assert_meta(&env, &cfg, "vintage_year", "2024");
        assert_meta(&env, &cfg, "verification_standard", "VCS");
        assert_meta(&env, &cfg, "carbon_offset_amount", "10000");
        assert_meta(&env, &cfg, "country", "Kenya");
    }

    #[test]
    fn asset_class_handlers_rec_example_updates_documented_fields() {
        let env = test_env();
        let expiry = NOW + 365 * 86_400;
        let mut cfg = base(&env);
        cfg.compliance_rules.holding_period_days = 90;
        cfg.compliance_rules.accredited_investor_only = true;
        let cfg = AssetClassHandlers::create_rec_config(
            env.clone(),
            cfg,
            renewable_energy::RECConfig {
                energy_source: Symbol::new(&env, "SOLAR"),
                mwh_amount: 500,
                grid_region: Symbol::new(&env, "EU"),
                compliance_period_expiry: expiry,
            },
        );

        assert_eq!(cfg.metadata.len(), 4);
        assert_meta(&env, &cfg, "energy_source", "SOLAR");
        assert_meta(&env, &cfg, "mwh_amount", "500");
        assert_meta(&env, &cfg, "grid_region", "EU");
        assert_meta(&env, &cfg, "compliance_period_expiry", &expiry.to_string());
        assert_eq!(cfg.compliance_rules.holding_period_days, 0);
        assert!(!cfg.compliance_rules.accredited_investor_only);
    }

    #[test]
    fn asset_class_handlers_ip_example_writes_documented_metadata() {
        let env = test_env();
        let cfg = AssetClassHandlers::create_ip_config(
            env.clone(),
            base(&env),
            intellectual_property::IPConfig {
                ip_type: Symbol::new(&env, "patent"),
                registration_number: Symbol::new(&env, "US1234567"),
                jurisdiction: Symbol::new(&env, "US"),
                owner: Address::generate(&env),
                filing_date: 1_700_000_000,
                expiry_date: 1_900_000_000,
                valuation: 2_500_000,
            },
        );

        assert_eq!(cfg.metadata.len(), 9);
        assert_meta(&env, &cfg, "ip_type", "patent");
        assert_meta(&env, &cfg, "registration_number", "US1234567");
        assert_meta(&env, &cfg, "jurisdiction", "US");
        assert_meta(&env, &cfg, "filing_date", "1700000000");
        assert_meta(&env, &cfg, "expiry_date", "1900000000");
        assert_meta(&env, &cfg, "valuation", "2500000");
        assert_meta(&env, &cfg, "holding_period_days", "180");
        assert_meta(&env, &cfg, "transfer_limit", "1000000");
    }

    #[test]
    #[should_panic]
    fn asset_class_handlers_invalid_purity_grade_is_rejected() {
        let env = test_env();
        AssetClassHandlers::create_commodity_config(
            env.clone(),
            base(&env),
            commodity::CommodityConfig {
                commodity_type: Symbol::new(&env, "gold"),
                vault_location: Symbol::new(&env, "ZURICH"),
                custody_vault: Address::generate(&env),
                purity_grade: Symbol::new(&env, "800"),
                physical_redemption_window: 2_592_000,
                quality_attestation: Address::generate(&env),
            },
        );
    }

    #[test]
    fn asset_class_handlers_failed_validation_leaves_base_config_unchanged() {
        let env = test_env();
        let mut initial = base(&env);
        initial.metadata.set(
            Symbol::new(&env, "existing"),
            String::from_str(&env, "kept"),
        );
        let snapshot = initial.clone();

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            AssetClassHandlers::create_invoice_config(
                env.clone(),
                initial,
                invoice::InvoiceConfig {
                    invoice_number: Symbol::new(&env, "BAD"),
                    debtor_address: Address::generate(&env),
                    due_date: NOW,
                    credit_rating: Symbol::new(&env, "BBB"),
                    automatic_settlement: false,
                    invoice_amount: 1,
                },
            )
        }));

        assert!(outcome.is_err());
        assert_eq!(snapshot.metadata.len(), 1);
        assert_meta(&env, &snapshot, "existing", "kept");
    }

    #[test]
    fn asset_class_handlers_oversized_base_metadata_is_rejected_before_writes() {
        let env = test_env();
        let mut initial = base(&env);
        for i in 0..101 {
            initial.metadata.set(
                Symbol::new(&env, &format!("k{i}")),
                String::from_str(&env, "v"),
            );
        }
        let snapshot = initial.clone();

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            AssetClassHandlers::create_commodity_config(
                env.clone(),
                initial,
                commodity::CommodityConfig {
                    commodity_type: Symbol::new(&env, "gold"),
                    vault_location: Symbol::new(&env, "ZURICH"),
                    custody_vault: Address::generate(&env),
                    purity_grade: Symbol::new(&env, "999"),
                    physical_redemption_window: 2_592_000,
                    quality_attestation: Address::generate(&env),
                },
            )
        }));

        assert!(outcome.is_err());
        assert_eq!(snapshot.metadata.len(), 101);
    }
}
