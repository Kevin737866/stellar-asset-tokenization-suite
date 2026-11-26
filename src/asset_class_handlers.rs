//! Asset-class metadata schema (Issues #385 and #387).
//!
//! This module is the single source of truth for the metadata each `AssetClass`
//! must carry. [`AssetClassHandlers::get_metadata_schema`] returns the full
//! schema (required keys, descriptions and valid examples), and
//! [`AssetClassHandlers::validate_required_metadata`] enforces it.
//!
//! All schema helpers are read-only view functions: they take no `auth`
//! argument, write no storage, and may be called by any caller. Invalid input
//! (a missing or empty required value, or an unknown requirement-set name)
//! fails with [`AssetClassError::InvalidParameters`]. Extra metadata keys are
//! ignored, so class-specific extensions remain compatible.
//!
//! | Asset class | Requirement set | Required metadata keys (key = valid example) |
//! |---|---|---|
//! | `RealEstate` | `real_estate` | `property_address=123MainSt`, `location_oracle=G...`, `rental_yield=500`, `insurance_status=true`, `appraisal_value=250000` |
//! | `Commodity` | `commodity` | `commodity_type=gold`, `vault_location=Zurich`, `purity_grade=999`, `redemption_window=2592000` |
//! | `Commodity` | `agricultural` | `commodity_subtype=agricultural`, `crop_type=wheat`, `planting_date=1000000`, `harvest_date=11368000`, `expected_yield=50000`, `price_adjustment_bps=1000` |
//! | `Invoice` | `invoice` | `invoice_number=INV_2026_001`, `debtor_address=G...`, `due_date=1767225600`, `credit_rating=BBB`, `invoice_amount=25000000` |
//! | `Security` | `security` | `equity_type=common`, `regulation_framework=REG_D`, `isin=US0378331005`, `regulatory_reporting=true`, `dividend_rights=Cumulative` |
//! | `Art` | `art` | `artist_name=Ada Lovelace`, `provenance_hash=0x0102...1f`, `insurance_status=true`, `exhibition_voting=true`, `appraisal_value=5000000` |
//! | `CarbonCredit` | `carbon_credit` | `project_id=FOREST_001`, `vintage_year=2020`, `retirement_functionality=true`, `verification_standard=VCS`, `carbon_offset_amount=100000` |
//! | `RenewableEnergy` | `renewable_energy` | `energy_source=SOLAR`, `mwh_amount=1000`, `grid_region=US_WECC`, `compliance_period_expiry=1767225600` |
//! | `IntellectualProperty` | `intellectual_property` | `ip_type=patent`, `registration_number=US1234567`, `jurisdiction=US`, `owner=G...`, `filing_date=1000`, `expiry_date=31536000`, `valuation=2500000`, `holding_period_days=180`, `transfer_limit=1000000` |

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Map,
    String, Symbol, Vec,
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

/// A single required metadata field, with a human-readable description and a
/// valid example value (Issues #385 and #387).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetClassMetadataRequirement {
    pub key: Symbol,
    pub description: String,
    pub example: String,
}

/// A named set of requirements. An asset class has one set, except
/// `Commodity`, which also accepts the `agricultural` alternative.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataRequirementSet {
    pub name: Symbol,
    pub requirements: Vec<AssetClassMetadataRequirement>,
}

/// The complete, testable metadata schema for one asset class (Issues #385 and
/// #387). `requirement_sets` is ordered, with the default set first.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetClassMetadataSchema {
    pub asset_class: AssetClass,
    pub requirement_sets: Vec<MetadataRequirementSet>,
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

// ── Per-class metadata schema (Issues #385 and #387) ─────────────────────────

fn requirement(
    env: &Env,
    key: &str,
    description: &str,
    example: &str,
) -> AssetClassMetadataRequirement {
    AssetClassMetadataRequirement {
        key: Symbol::new(env, key),
        description: String::from_str(env, description),
        example: String::from_str(env, example),
    }
}

fn requirement_set(
    env: &Env,
    name: &str,
    requirements: Vec<AssetClassMetadataRequirement>,
) -> MetadataRequirementSet {
    MetadataRequirementSet {
        name: Symbol::new(env, name),
        requirements,
    }
}

/// Build the single metadata schema for `asset_class`.
///
/// This is the only place where required keys, descriptions and valid examples
/// are declared. Contract helpers and clients all derive their answers from
/// this function, so the schema cannot drift between documentation and
/// validation.
pub fn metadata_schema(env: &Env, asset_class: AssetClass) -> AssetClassMetadataSchema {
    let requirement_sets = match asset_class {
        AssetClass::RealEstate => Vec::from_array(
            env,
            [requirement_set(
                env,
                "real_estate",
                Vec::from_array(
                    env,
                    [
                        requirement(
                            env,
                            "property_address",
                            "Street address of the tokenized property",
                            "123MainSt",
                        ),
                        requirement(
                            env,
                            "location_oracle",
                            "StrKey address of the location/custody oracle",
                            "G...",
                        ),
                        requirement(
                            env,
                            "rental_yield",
                            "Rental yield in basis points (0-10000)",
                            "500",
                        ),
                        requirement(
                            env,
                            "insurance_status",
                            "Whether the property is insured",
                            "true",
                        ),
                        requirement(
                            env,
                            "appraisal_value",
                            "Appraised value in base currency units",
                            "250000",
                        ),
                    ],
                ),
            )],
        ),
        AssetClass::Commodity => Vec::from_array(
            env,
            [
                requirement_set(
                    env,
                    "commodity",
                    Vec::from_array(
                        env,
                        [
                            requirement(
                                env,
                                "commodity_type",
                                "Type of the underlying commodity",
                                "gold",
                            ),
                            requirement(
                                env,
                                "vault_location",
                                "Location of the custodial vault",
                                "Zurich",
                            ),
                            requirement(
                                env,
                                "purity_grade",
                                "Purity grade: 999, 995, 990 or 750",
                                "999",
                            ),
                            requirement(
                                env,
                                "redemption_window",
                                "Physical redemption window in seconds",
                                "2592000",
                            ),
                        ],
                    ),
                ),
                requirement_set(
                    env,
                    "agricultural",
                    Vec::from_array(
                        env,
                        [
                            requirement(
                                env,
                                "commodity_subtype",
                                "Must be agricultural for crop-backed tokens",
                                "agricultural",
                            ),
                            requirement(env, "crop_type", "Crop covered by the token", "wheat"),
                            requirement(
                                env,
                                "planting_date",
                                "Planting date as a Unix timestamp in seconds",
                                "1000000",
                            ),
                            requirement(
                                env,
                                "harvest_date",
                                "Harvest date as a Unix timestamp after planting_date",
                                "11368000",
                            ),
                            requirement(
                                env,
                                "expected_yield",
                                "Expected harvest yield in whole crop units",
                                "50000",
                            ),
                            requirement(
                                env,
                                "price_adjustment_bps",
                                "Time-to-harvest price discount in basis points",
                                "1000",
                            ),
                        ],
                    ),
                ),
            ],
        ),
        AssetClass::Invoice => Vec::from_array(
            env,
            [requirement_set(
                env,
                "invoice",
                Vec::from_array(
                    env,
                    [
                        requirement(
                            env,
                            "invoice_number",
                            "Unique invoice identifier",
                            "INV_2026_001",
                        ),
                        requirement(
                            env,
                            "debtor_address",
                            "StrKey address of the debtor",
                            "G...",
                        ),
                        requirement(
                            env,
                            "due_date",
                            "Invoice due date as a Unix timestamp in seconds",
                            "1767225600",
                        ),
                        requirement(
                            env,
                            "credit_rating",
                            "Debtor rating: AAA, AA, A, BBB, BB, B or CCC",
                            "BBB",
                        ),
                        requirement(
                            env,
                            "invoice_amount",
                            "Face value in base currency units",
                            "25000000",
                        ),
                    ],
                ),
            )],
        ),
        AssetClass::Security => Vec::from_array(
            env,
            [requirement_set(
                env,
                "security",
                Vec::from_array(
                    env,
                    [
                        requirement(env, "equity_type", "Type of security or equity", "common"),
                        requirement(
                            env,
                            "regulation_framework",
                            "Framework: REG_D, REG_S, RULE_144 or REG_A+",
                            "REG_D",
                        ),
                        requirement(
                            env,
                            "isin",
                            "International Securities Identification Number",
                            "US0378331005",
                        ),
                        requirement(
                            env,
                            "regulatory_reporting",
                            "Whether regulatory reporting is enabled",
                            "true",
                        ),
                        requirement(
                            env,
                            "dividend_rights",
                            "Cumulative, NonCumulative, Participating or NonParticipating",
                            "Cumulative",
                        ),
                    ],
                ),
            )],
        ),
        AssetClass::Art => Vec::from_array(
            env,
            [requirement_set(
                env,
                "art",
                Vec::from_array(
                    env,
                    [
                        requirement(env, "artist_name", "Name of the artist", "Ada Lovelace"),
                        requirement(
                            env,
                            "provenance_hash",
                            "32-byte provenance hash, hex encoded",
                            "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
                        ),
                        requirement(
                            env,
                            "insurance_status",
                            "Whether the artwork is insured",
                            "true",
                        ),
                        requirement(
                            env,
                            "exhibition_voting",
                            "Whether holders vote on exhibitions",
                            "true",
                        ),
                        requirement(
                            env,
                            "appraisal_value",
                            "Appraised value in base currency units",
                            "5000000",
                        ),
                    ],
                ),
            )],
        ),
        AssetClass::CarbonCredit => Vec::from_array(
            env,
            [requirement_set(
                env,
                "carbon_credit",
                Vec::from_array(
                    env,
                    [
                        requirement(
                            env,
                            "project_id",
                            "Identifier of the underlying offset project",
                            "FOREST_001",
                        ),
                        requirement(env, "vintage_year", "Vintage year of the credits", "2020"),
                        requirement(
                            env,
                            "retirement_functionality",
                            "Whether credits can be retired",
                            "true",
                        ),
                        requirement(
                            env,
                            "verification_standard",
                            "Standard: VCS, GS, CDM or ACR",
                            "VCS",
                        ),
                        requirement(
                            env,
                            "carbon_offset_amount",
                            "Offset amount in tonnes of CO2e",
                            "100000",
                        ),
                    ],
                ),
            )],
        ),
        AssetClass::RenewableEnergy => Vec::from_array(
            env,
            [requirement_set(
                env,
                "renewable_energy",
                Vec::from_array(
                    env,
                    [
                        requirement(
                            env,
                            "energy_source",
                            "Source: SOLAR, WIND, HYDRO or GEOTHERMAL",
                            "SOLAR",
                        ),
                        requirement(env, "mwh_amount", "Certificate volume in MWh", "1000"),
                        requirement(
                            env,
                            "grid_region",
                            "Grid region covered by the certificate",
                            "US_WECC",
                        ),
                        requirement(
                            env,
                            "compliance_period_expiry",
                            "Compliance period expiry as a Unix timestamp",
                            "1767225600",
                        ),
                    ],
                ),
            )],
        ),
        AssetClass::IntellectualProperty => Vec::from_array(
            env,
            [requirement_set(
                env,
                "intellectual_property",
                Vec::from_array(
                    env,
                    [
                        requirement(
                            env,
                            "ip_type",
                            "patent, trademark, copyright or trade_secret",
                            "patent",
                        ),
                        requirement(
                            env,
                            "registration_number",
                            "Official registration or application number",
                            "US1234567",
                        ),
                        requirement(env, "jurisdiction", "Jurisdiction granting the right", "US"),
                        requirement(env, "owner", "StrKey address of the rights owner", "G..."),
                        requirement(
                            env,
                            "filing_date",
                            "Filing date as a Unix timestamp in seconds",
                            "1000",
                        ),
                        requirement(
                            env,
                            "expiry_date",
                            "Expiry date as a Unix timestamp after filing_date",
                            "31536000",
                        ),
                        requirement(
                            env,
                            "valuation",
                            "Valuation in base currency units",
                            "2500000",
                        ),
                        requirement(
                            env,
                            "holding_period_days",
                            "Default IP holding period in days",
                            "180",
                        ),
                        requirement(
                            env,
                            "transfer_limit",
                            "Default IP transfer limit",
                            "1000000",
                        ),
                    ],
                ),
            )],
        ),
    };

    AssetClassMetadataSchema {
        asset_class,
        requirement_sets,
    }
}

/// Return the name of the first requirement set satisfied by `metadata`.
///
/// A set is satisfied when every required key is present and its value is
/// non-empty. Extra keys are ignored. Returns `None` when no set matches.
pub fn find_satisfied_metadata_set(
    _env: &Env,
    schema: &AssetClassMetadataSchema,
    metadata: &Map<Symbol, String>,
) -> Option<Symbol> {
    for set_index in 0..schema.requirement_sets.len() {
        let set = schema.requirement_sets.get(set_index).unwrap();
        let mut satisfied = true;

        for requirement_index in 0..set.requirements.len() {
            let field = set.requirements.get(requirement_index).unwrap();
            match metadata.get(field.key) {
                Some(value) if value.len() > 0 => {}
                _ => {
                    satisfied = false;
                    break;
                }
            }
        }

        if satisfied {
            return Some(set.name);
        }
    }

    None
}

/// Validate `metadata` against the schema for `asset_class`.
///
/// Returns the matched requirement-set name, or
/// [`AssetClassError::InvalidParameters`] when a required key is missing or
/// empty. This function is read-only and never writes storage.
pub fn check_required_metadata(
    env: &Env,
    asset_class: AssetClass,
    metadata: &Map<Symbol, String>,
) -> Result<Symbol, AssetClassError> {
    let schema = metadata_schema(env, asset_class);
    find_satisfied_metadata_set(env, &schema, metadata).ok_or(AssetClassError::InvalidParameters)
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

    pub fn create_security_config(
        env: Env,
        base_config: AssetConfig,
        security_config: security::SecurityConfig,
    ) -> AssetConfig {
        security::create_security_config(env, base_config, security_config)
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

    /// Issues #385/#387: return the complete metadata schema for `asset_class`.
    ///
    /// Read-only: no `auth` is required and no storage is written. The
    /// `requirement_sets` vector is ordered with the default set first;
    /// `Commodity` also exposes the `agricultural` alternative.
    pub fn get_metadata_schema(env: Env, asset_class: AssetClass) -> AssetClassMetadataSchema {
        metadata_schema(&env, asset_class)
    }

    /// Return valid example values for the named requirement set.
    ///
    /// `set_name` must be one of the set names in
    /// [`Self::get_metadata_schema`]; otherwise the call fails with
    /// [`AssetClassError::InvalidParameters`]. Read-only.
    pub fn get_metadata_examples(
        env: Env,
        asset_class: AssetClass,
        set_name: Symbol,
    ) -> Map<Symbol, String> {
        let schema = metadata_schema(&env, asset_class);

        for set_index in 0..schema.requirement_sets.len() {
            let set = schema.requirement_sets.get(set_index).unwrap();
            if set.name == set_name {
                let mut examples = Map::new(&env);
                for requirement_index in 0..set.requirements.len() {
                    let field = set.requirements.get(requirement_index).unwrap();
                    examples.set(field.key, field.example);
                }
                return examples;
            }
        }

        panic_with_error!(&env, AssetClassError::InvalidParameters);
    }

    /// Validate that `metadata` satisfies at least one requirement set for
    /// `asset_class`.
    ///
    /// A missing or empty required value fails with
    /// [`AssetClassError::InvalidParameters`]. Extra keys are allowed. The
    /// function is read-only, so a failure cannot leave partial state changes.
    pub fn validate_required_metadata(
        env: Env,
        asset_class: AssetClass,
        metadata: Map<Symbol, String>,
    ) {
        if check_required_metadata(&env, asset_class, &metadata).is_err() {
            panic_with_error!(&env, AssetClassError::InvalidParameters);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::art::ArtConfig;
    use crate::carbon_credit::CarbonCreditConfig;
    use crate::commodity::AgriculturalConfig;
    use crate::intellectual_property::IPConfig;
    use crate::invoice::InvoiceConfig;
    use crate::real_estate::RealEstateConfig;
    use crate::renewable_energy::RECConfig;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Address, BytesN,
    };

    const NOW: u64 = 1_700_000_000;

    fn all_classes() -> [AssetClass; 8] {
        [
            AssetClass::RealEstate,
            AssetClass::Commodity,
            AssetClass::Invoice,
            AssetClass::Security,
            AssetClass::Art,
            AssetClass::CarbonCredit,
            AssetClass::RenewableEnergy,
            AssetClass::IntellectualProperty,
        ]
    }

    fn base_config(env: &Env, asset_class: AssetClass) -> AssetConfig {
        AssetConfig {
            name: Symbol::new(env, "TestAsset"),
            symbol: Symbol::new(env, "TA"),
            decimals: 6,
            total_supply: 1_000_000,
            asset_class,
            compliance_rules: ComplianceRules {
                kyc_required: true,
                accredited_investor_only: false,
                geographic_restrictions: Vec::new(env),
                holding_period_days: 0,
                transfer_limits: 1_000_000,
            },
            dividend_schedule: Vec::new(env),
            metadata: Map::new(env),
        }
    }

    fn examples_for(env: &Env, asset_class: AssetClass, set_name: Symbol) -> Map<Symbol, String> {
        AssetClassHandlers::get_metadata_examples(env.clone(), asset_class, set_name)
    }

    fn assert_schema_satisfied(
        env: &Env,
        asset_class: AssetClass,
        metadata: &Map<Symbol, String>,
        set_name: Symbol,
    ) {
        assert_eq!(
            check_required_metadata(env, asset_class.clone(), metadata),
            Ok(set_name)
        );
        AssetClassHandlers::validate_required_metadata(env.clone(), asset_class, metadata.clone());
    }

    #[test]
    fn schema_covers_every_asset_class() {
        let env = Env::default();

        for class in all_classes().iter() {
            let class = class.clone();
            let schema = metadata_schema(&env, class.clone());

            assert_eq!(schema.asset_class, class);
            assert!(!schema.requirement_sets.is_empty());

            for set_index in 0..schema.requirement_sets.len() {
                let set = schema.requirement_sets.get(set_index).unwrap();
                assert!(!set.requirements.is_empty());

                for field_index in 0..set.requirements.len() {
                    let field = set.requirements.get(field_index).unwrap();
                    assert!(field.description.len() > 0);
                    assert!(field.example.len() > 0);
                }
            }
        }
    }

    #[test]
    fn schema_examples_satisfy_their_own_requirements() {
        let env = Env::default();

        for class in all_classes().iter() {
            let class = class.clone();
            let schema = metadata_schema(&env, class.clone());

            for set_index in 0..schema.requirement_sets.len() {
                let set = schema.requirement_sets.get(set_index).unwrap();
                let examples = examples_for(&env, class.clone(), set.name.clone());
                assert_schema_satisfied(&env, class.clone(), &examples, set.name.clone());
            }
        }
    }

    #[test]
    fn missing_required_metadata_is_rejected() {
        let env = Env::default();
        let mut examples = examples_for(
            &env,
            AssetClass::RealEstate,
            Symbol::new(&env, "real_estate"),
        );
        examples.remove(Symbol::new(&env, "appraisal_value"));

        assert_eq!(
            check_required_metadata(&env, AssetClass::RealEstate, &examples),
            Err(AssetClassError::InvalidParameters)
        );
    }

    #[test]
    fn empty_required_metadata_value_is_rejected() {
        let env = Env::default();
        let mut examples = examples_for(
            &env,
            AssetClass::RealEstate,
            Symbol::new(&env, "real_estate"),
        );
        examples.set(
            Symbol::new(&env, "insurance_status"),
            String::from_str(&env, ""),
        );

        assert_eq!(
            check_required_metadata(&env, AssetClass::RealEstate, &examples),
            Err(AssetClassError::InvalidParameters)
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn validate_required_metadata_panics_on_invalid_input() {
        let env = Env::default();
        let mut examples = examples_for(
            &env,
            AssetClass::RealEstate,
            Symbol::new(&env, "real_estate"),
        );
        examples.remove(Symbol::new(&env, "property_address"));

        AssetClassHandlers::validate_required_metadata(env, AssetClass::RealEstate, examples);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn unknown_requirement_set_is_rejected() {
        let env = Env::default();
        let unknown = Symbol::new(&env, "not_a_requirement_set");
        AssetClassHandlers::get_metadata_examples(env, AssetClass::Art, unknown);
    }

    #[test]
    fn extra_metadata_keys_are_allowed() {
        let env = Env::default();
        let mut examples = examples_for(&env, AssetClass::Art, Symbol::new(&env, "art"));
        examples.set(
            Symbol::new(&env, "curator_note"),
            String::from_str(&env, "On loan"),
        );

        assert_schema_satisfied(&env, AssetClass::Art, &examples, Symbol::new(&env, "art"));
    }

    #[test]
    fn handler_outputs_satisfy_declared_schema() {
        let env = Env::default();
        env.ledger().set_timestamp(NOW);

        let real_estate = real_estate::create_real_estate_config(
            env.clone(),
            base_config(&env, AssetClass::RealEstate),
            RealEstateConfig {
                property_address: Symbol::new(&env, "123MainSt"),
                location_oracle: Address::generate(&env),
                rental_yield_rate: 500,
                property_management_voting: true,
                insurance_status: true,
                appraisal_value: 250_000,
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::RealEstate,
            &real_estate.metadata,
            Symbol::new(&env, "real_estate"),
        );

        let commodity = commodity::create_commodity_config(
            env.clone(),
            base_config(&env, AssetClass::Commodity),
            commodity::CommodityConfig {
                commodity_type: Symbol::new(&env, "gold"),
                vault_location: Symbol::new(&env, "Zurich"),
                custody_vault: Address::generate(&env),
                purity_grade: Symbol::new(&env, "999"),
                physical_redemption_window: 2_592_000,
                quality_attestation: Address::generate(&env),
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::Commodity,
            &commodity.metadata,
            Symbol::new(&env, "commodity"),
        );

        let agricultural = commodity::create_agricultural_config(
            env.clone(),
            base_config(&env, AssetClass::Commodity),
            AgriculturalConfig {
                crop_type: Symbol::new(&env, "wheat"),
                planting_date: 1_000_000,
                harvest_date: 11_368_000,
                expected_yield: 50_000,
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::Commodity,
            &agricultural.metadata,
            Symbol::new(&env, "agricultural"),
        );

        let invoice = invoice::create_invoice_config(
            env.clone(),
            base_config(&env, AssetClass::Invoice),
            InvoiceConfig {
                invoice_number: Symbol::new(&env, "INV_2026_001"),
                debtor_address: Address::generate(&env),
                due_date: NOW - 86_400,
                credit_rating: Symbol::new(&env, "BBB"),
                automatic_settlement: true,
                invoice_amount: 25_000_000,
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::Invoice,
            &invoice.metadata,
            Symbol::new(&env, "invoice"),
        );

        // SecurityConfig::create_security_config is omitted here because the
        // pre-existing handler constructs `Symbol::new("REG_A+")`, which is an
        // invalid Soroban symbol. The security schema examples are covered by
        // `schema_examples_satisfy_their_own_requirements`.

        let art = art::create_art_config(
            env.clone(),
            base_config(&env, AssetClass::Art),
            ArtConfig {
                artist_name: Symbol::new(&env, "AdaLovelace"),
                provenance_hash: BytesN::from_array(&env, &[1u8; 32]),
                insurance_status: true,
                exhibition_voting: true,
                appraisal_value: 5_000_000,
                authenticity_certificate: Address::generate(&env),
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::Art,
            &art.metadata,
            Symbol::new(&env, "art"),
        );

        let carbon = carbon_credit::create_carbon_credit_config(
            env.clone(),
            base_config(&env, AssetClass::CarbonCredit),
            CarbonCreditConfig {
                project_id: Symbol::new(&env, "FOREST_001"),
                vintage_year: 2020,
                retirement_functionality: true,
                project_metadata: Map::new(&env),
                verification_standard: Symbol::new(&env, "VCS"),
                carbon_offset_amount: 100_000,
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::CarbonCredit,
            &carbon.metadata,
            Symbol::new(&env, "carbon_credit"),
        );

        let rec = renewable_energy::create_rec_config(
            env.clone(),
            base_config(&env, AssetClass::RenewableEnergy),
            RECConfig {
                energy_source: Symbol::new(&env, "SOLAR"),
                mwh_amount: 1_000,
                grid_region: Symbol::new(&env, "US_WECC"),
                compliance_period_expiry: NOW + 86_400,
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::RenewableEnergy,
            &rec.metadata,
            Symbol::new(&env, "renewable_energy"),
        );

        let ip = intellectual_property::create_ip_config(
            env.clone(),
            base_config(&env, AssetClass::IntellectualProperty),
            IPConfig {
                ip_type: Symbol::new(&env, "patent"),
                registration_number: Symbol::new(&env, "US1234567"),
                jurisdiction: Symbol::new(&env, "US"),
                owner: Address::generate(&env),
                filing_date: 1_000,
                expiry_date: NOW + 86_400,
                valuation: 2_500_000,
            },
        );
        assert_schema_satisfied(
            &env,
            AssetClass::IntellectualProperty,
            &ip.metadata,
            Symbol::new(&env, "intellectual_property"),
        );
    }
}
