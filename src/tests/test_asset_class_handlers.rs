#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, Map, Symbol, Vec,
};

use crate::art::{self, ArtConfig};
use crate::asset_class_handlers::{self, AssetClassError};
use crate::asset_factory::{AssetClass, AssetConfig, ComplianceRules};
use crate::carbon_credit::{self, CarbonCreditConfig};
use crate::commodity::{self, AgriculturalConfig, CommodityConfig};
use crate::intellectual_property::{self, IPConfig};
use crate::invoice::{self, InvoiceConfig};
use crate::real_estate::{self, RealEstateConfig};
use crate::renewable_energy::{self, RECConfig};
use crate::security::{self, DividendRights, SecurityConfig};

// ── helpers ──────────────────────────────────────────────────────────────────

const NOW: u64 = 1_800_000_000;
const DAY: u64 = 86_400;

fn test_env() -> Env {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    env
}

fn hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

fn base_config(env: &Env) -> AssetConfig {
    AssetConfig {
        name: Symbol::new(env, "TestAsset"),
        symbol: Symbol::new(env, "TA"),
        decimals: 6,
        total_supply: 1_000_000i128,
        asset_class: AssetClass::Invoice,
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

fn invoice_config(env: &Env) -> InvoiceConfig {
    InvoiceConfig {
        invoice_number: Symbol::new(env, "INV001"),
        debtor_address: Address::generate(env),
        due_date: NOW + 30 * DAY,
        credit_rating: Symbol::new(env, "AAA"),
        automatic_settlement: false,
        invoice_amount: 1_000_000,
        outstanding_balance: 750_000,
        legal_document_hash: hash(env),
    }
}

fn art_config(env: &Env) -> ArtConfig {
    ArtConfig {
        artist_name: Symbol::new(env, "Artist"),
        provenance_hash: BytesN::from_array(env, &[3u8; 32]),
        insurance_status: true,
        exhibition_voting: false,
        appraisal_value: 2_500_000,
        valuation_timestamp: NOW - DAY,
        authenticity_certificate: Address::generate(env),
        legal_document_hash: hash(env),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #380: invoice maturity dates and outstanding balances
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn invoice_accepts_future_maturity_and_records_balance() {
    let env = test_env();
    let config =
        invoice::create_invoice_config(env.clone(), base_config(&env), invoice_config(&env));

    assert_eq!(
        config.metadata.get(Symbol::new(&env, "due_date")).unwrap(),
        soroban_sdk::String::from_str(&env, &(NOW + 30 * DAY).to_string())
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "outstanding_balance"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "750000")
    );
}

#[test]
#[should_panic]
fn invoice_rejects_matured_due_date() {
    let env = test_env();
    let mut config = invoice_config(&env);
    config.due_date = NOW - 1;
    invoice::create_invoice_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn invoice_rejects_due_date_equal_to_now() {
    let env = test_env();
    let mut config = invoice_config(&env);
    config.due_date = NOW;
    invoice::create_invoice_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn invoice_rejects_outstanding_balance_above_face_value() {
    let env = test_env();
    let mut config = invoice_config(&env);
    config.outstanding_balance = config.invoice_amount + 1;
    invoice::create_invoice_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn invoice_rejects_negative_outstanding_balance() {
    let env = test_env();
    let mut config = invoice_config(&env);
    config.outstanding_balance = -1;
    invoice::create_invoice_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn invoice_rejects_non_positive_face_value() {
    let env = test_env();
    let mut config = invoice_config(&env);
    config.invoice_amount = 0;
    config.outstanding_balance = 0;
    invoice::create_invoice_config(env.clone(), base_config(&env), config);
}

#[test]
fn invoice_accepts_zero_outstanding_balance() {
    let env = test_env();
    let mut config = invoice_config(&env);
    config.outstanding_balance = 0;
    let created = invoice::create_invoice_config(env.clone(), base_config(&env), config);
    assert_eq!(
        created
            .metadata
            .get(Symbol::new(&env, "outstanding_balance"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "0")
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #382: art appraisal provenance and valuation timestamps
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn art_accepts_past_valuation_timestamp_and_records_it() {
    let env = test_env();
    let config = art::create_art_config(env.clone(), base_config(&env), art_config(&env));

    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "valuation_timestamp"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, &(NOW - DAY).to_string())
    );
}

#[test]
#[should_panic]
fn art_rejects_future_valuation_timestamp() {
    let env = test_env();
    let mut config = art_config(&env);
    config.valuation_timestamp = NOW + 1;
    art::create_art_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn art_rejects_zero_valuation_timestamp() {
    let env = test_env();
    let mut config = art_config(&env);
    config.valuation_timestamp = 0;
    art::create_art_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn art_rejects_zero_provenance_hash() {
    let env = test_env();
    let mut config = art_config(&env);
    config.provenance_hash = BytesN::from_array(&env, &[0u8; 32]);
    art::create_art_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn art_rejects_non_positive_appraisal_value() {
    let env = test_env();
    let mut config = art_config(&env);
    config.appraisal_value = 0;
    art::create_art_config(env.clone(), base_config(&env), config);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #384: consistent legal-document hash across asset classes
// ═══════════════════════════════════════════════════════════════════════════════

/// Build one valid config per asset class and return the produced metadata.
fn all_asset_class_configs(env: &Env) -> Vec<AssetConfig> {
    let mut configs = Vec::new(env);

    configs.push_back(real_estate::create_real_estate_config(
        env.clone(),
        base_config(env),
        RealEstateConfig {
            property_address: Symbol::new(env, "123MainSt"),
            location_oracle: Address::generate(env),
            rental_yield_rate: 500,
            property_management_voting: true,
            insurance_status: true,
            appraisal_value: 500_000,
            legal_document_hash: hash(env),
        },
    ));

    configs.push_back(commodity::create_commodity_config(
        env.clone(),
        base_config(env),
        CommodityConfig {
            commodity_type: Symbol::new(env, "GOLD"),
            vault_location: Symbol::new(env, "NYC"),
            custody_vault: Address::generate(env),
            purity_grade: Symbol::new(env, "999"),
            physical_redemption_window: DAY,
            quality_attestation: Address::generate(env),
            legal_document_hash: hash(env),
        },
    ));

    configs.push_back(commodity::create_agricultural_config(
        env.clone(),
        base_config(env),
        AgriculturalConfig {
            crop_type: Symbol::new(env, "wheat"),
            planting_date: NOW - 30 * DAY,
            harvest_date: NOW + 90 * DAY,
            expected_yield: 10_000,
            legal_document_hash: hash(env),
        },
    ));

    configs.push_back(invoice::create_invoice_config(
        env.clone(),
        base_config(env),
        invoice_config(env),
    ));

    configs.push_back(security::create_security_config(
        env.clone(),
        base_config(env),
        SecurityConfig {
            equity_type: Symbol::new(env, "common"),
            regulation_framework: Symbol::new(env, "REG_D"),
            accreditation_required: true,
            holding_period_days: 90,
            regulatory_reporting: true,
            isin: Symbol::new(env, "US1234567890"),
            dividend_rights: DividendRights::Cumulative,
            legal_document_hash: hash(env),
        },
    ));

    configs.push_back(art::create_art_config(
        env.clone(),
        base_config(env),
        art_config(env),
    ));

    configs.push_back(carbon_credit::create_carbon_credit_config(
        env.clone(),
        base_config(env),
        CarbonCreditConfig {
            project_id: Symbol::new(env, "PROJ001"),
            vintage_year: 2020,
            retirement_functionality: true,
            project_metadata: Map::new(env),
            verification_standard: Symbol::new(env, "VCS"),
            carbon_offset_amount: 1_000,
            legal_document_hash: hash(env),
        },
    ));

    configs.push_back(renewable_energy::create_rec_config(
        env.clone(),
        base_config(env),
        RECConfig {
            energy_source: Symbol::new(env, "SOLAR"),
            mwh_amount: 100,
            grid_region: Symbol::new(env, "USWEST"),
            compliance_period_expiry: NOW + 365 * DAY,
            legal_document_hash: hash(env),
        },
    ));

    configs.push_back(intellectual_property::create_ip_config(
        env.clone(),
        base_config(env),
        IPConfig {
            ip_type: Symbol::new(env, "patent"),
            registration_number: Symbol::new(env, "US1234567"),
            jurisdiction: Symbol::new(env, "US"),
            owner: Address::generate(env),
            filing_date: NOW - 365 * DAY,
            expiry_date: NOW + 365 * DAY,
            valuation: 2_500_000,
            legal_document_hash: hash(env),
        },
    ));

    configs
}

#[test]
fn every_asset_class_records_the_same_legal_document_hash_key_and_value() {
    let env = test_env();
    let expected = soroban_sdk::String::from_str(&env, &format!("{:?}", hash(&env)));
    let key = Symbol::new(&env, asset_class_handlers::LEGAL_DOCUMENT_HASH_KEY);

    let configs = all_asset_class_configs(&env);
    assert_eq!(configs.len(), 9);

    for config in configs.iter() {
        assert_eq!(config.metadata.get(key.clone()).unwrap(), expected);
    }
}

#[test]
fn legal_document_hash_helper_accepts_non_zero_hash() {
    let env = test_env();
    asset_class_handlers::validate_legal_document_hash(&env, &hash(&env));
}

#[test]
#[should_panic]
fn legal_document_hash_helper_rejects_zero_hash() {
    let env = test_env();
    asset_class_handlers::validate_legal_document_hash(&env, &BytesN::from_array(&env, &[0u8; 32]));
}

#[test]
#[should_panic]
fn invoice_rejects_zero_legal_document_hash() {
    let env = test_env();
    let mut config = invoice_config(&env);
    config.legal_document_hash = BytesN::from_array(&env, &[0u8; 32]);
    invoice::create_invoice_config(env.clone(), base_config(&env), config);
}

#[test]
#[should_panic]
fn art_rejects_zero_legal_document_hash() {
    let env = test_env();
    let mut config = art_config(&env);
    config.legal_document_hash = BytesN::from_array(&env, &[0u8; 32]);
    art::create_art_config(env.clone(), base_config(&env), config);
}

#[test]
fn legal_document_hash_error_is_reported() {
    let env = test_env();
    // The shared error variant is stable so callers can map it.
    assert_eq!(AssetClassError::InvalidLegalDocumentHash as u32, 11);
    assert_eq!(
        asset_class_handlers::LEGAL_DOCUMENT_HASH_KEY,
        "legal_document_hash"
    );
    let _ = &env;
}
