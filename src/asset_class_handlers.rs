use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, Address, Env, Map, Symbol, String, Vec,
};

use crate::asset_factory::{AssetClass, AssetConfig, ComplianceRules, DividendSchedule};

pub use crate::art;
pub use crate::carbon_credit;
pub use crate::commodity;
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
        }
    }
}
