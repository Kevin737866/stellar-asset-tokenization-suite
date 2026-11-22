#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, Map, Symbol, Vec,
};

use crate::asset_class_handlers::AssetClassHandlers;
use crate::asset_factory::{AssetClass, AssetConfig, ComplianceRules};
use crate::art::ProvenanceEventType;
use crate::compliance_registry::{ComplianceRegistry, ComplianceRegistryClient};
use crate::fund::{self, FundConfig};
use crate::rwa_token::{RWAToken, RWATokenClient};

// ── helpers ──────────────────────────────────────────────────────────────────

fn base_config(env: &Env, asset_class: AssetClass) -> AssetConfig {
    AssetConfig {
        name: Symbol::new(env, "TestAsset"),
        symbol: Symbol::new(env, "TA"),
        decimals: 6,
        total_supply: 1_000_000i128,
        asset_class,
        compliance_rules: ComplianceRules {
            kyc_required: false,
            accredited_investor_only: false,
            geographic_restrictions: Vec::new(env),
            holding_period_days: 0,
            transfer_limits: 1_000_000i128,
        },
        dividend_schedule: Vec::new(env),
        metadata: Map::new(env),
    }
}

fn token_fixture(asset_type: &str) -> (Env, Address, RWATokenClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &false, &false);

    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &Symbol::new(&env, "TestAsset"),
        &Symbol::new(&env, "TA"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, asset_type),
        &Map::new(&env),
        &compliance_id,
        &admin,
    );

    let token: RWATokenClient<'static> = unsafe { core::mem::transmute(token) };
    (env, admin, token)
}

fn compliance_fixture() -> (Env, Address, ComplianceRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, ComplianceRegistry);
    let client = ComplianceRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &admin, &false, &false);

    let client: ComplianceRegistryClient<'static> = unsafe { core::mem::transmute(client) };
    (env, admin, client)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #174: fund / basket asset class
// ═══════════════════════════════════════════════════════════════════════════════

fn fund_config(env: &Env, weights: &[u32], fee: u32) -> FundConfig {
    let mut assets = Vec::new(env);
    let mut weight_vec = Vec::new(env);
    for _ in weights {
        assets.push_back(Address::generate(env));
    }
    for weight in weights {
        weight_vec.push_back(*weight);
    }

    FundConfig {
        underlying_assets: assets,
        weights: weight_vec,
        management_fee_bps: fee,
    }
}

#[test]
fn fund_config_records_basket_metadata() {
    let env = Env::default();
    let config = fund::create_fund_config(
        env.clone(),
        base_config(&env, AssetClass::Fund),
        fund_config(&env, &[6_000, 4_000], 150),
    );

    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "asset_subtype"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "fund")
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "weights_bps"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "6000,4000")
    );
    assert_eq!(
        config
            .metadata
            .get(Symbol::new(&env, "management_fee_bps"))
            .unwrap(),
        soroban_sdk::String::from_str(&env, "150")
    );
}

#[test]
#[should_panic]
fn fund_weights_must_sum_to_one_hundred_percent() {
    let env = Env::default();
    fund::create_fund_config(
        env.clone(),
        base_config(&env, AssetClass::Fund),
        fund_config(&env, &[6_000, 3_000], 100),
    );
}

#[test]
fn fund_nav_is_weighted_average_of_underlying_prices() {
    let env = Env::default();
    let prices = Vec::from_array(&env, [100i128, 200i128]);
    let weights = Vec::from_array(&env, [6_000u32, 4_000u32]);

    assert_eq!(fund::calculate_nav(&env, prices, weights), 140);
}

#[test]
fn fund_shares_can_be_created_and_redeemed() {
    let env = Env::default();
    env.mock_all_auths();

    let harness = env.register_contract(None, AssetClassHandlers);
    let admin = Address::generate(&env);
    let holder = Address::generate(&env);
    let fund_addr = Address::generate(&env);
    let config = fund_config(&env, &[5_000, 5_000], 200);

    let total = env.as_contract(&harness, || {
        fund::initialize_fund(env.clone(), admin.clone(), fund_addr.clone(), config);
        fund::create_fund_shares(env.clone(), holder.clone(), fund_addr.clone(), 100, 140)
    });
    assert_eq!(total, 100);
    assert_eq!(
        env.as_contract(&harness, || fund::get_fund_shares(
            env.clone(),
            fund_addr.clone(),
            holder.clone()
        )),
        100
    );

    let payout = env.as_contract(&harness, || {
        fund::redeem_fund_shares(env.clone(), holder.clone(), fund_addr.clone(), 40)
    });
    assert_eq!(payout, 40 * 140);

    let state = env.as_contract(&harness, || {
        fund::get_fund_state(env.clone(), fund_addr.clone())
    });
    assert_eq!(state.total_shares, 60);
    assert_eq!(state.nav_per_share, 140);
}

#[test]
fn fund_nav_updates_from_underlying_prices() {
    let env = Env::default();
    env.mock_all_auths();

    let harness = env.register_contract(None, AssetClassHandlers);
    let admin = Address::generate(&env);
    let fund_addr = Address::generate(&env);
    let config = fund_config(&env, &[7_000, 3_000], 100);

    env.as_contract(&harness, || {
        fund::initialize_fund(env.clone(), admin.clone(), fund_addr.clone(), config);
    });

    let nav = env.as_contract(&harness, || {
        fund::update_nav(
            env.clone(),
            admin.clone(),
            fund_addr.clone(),
            Vec::from_array(&env, [10i128, 20i128]),
        )
    });

    assert_eq!(nav, (10 * 7_000 + 20 * 3_000) / 10_000);
}

#[test]
fn fund_rebalance_replaces_weights() {
    let env = Env::default();
    env.mock_all_auths();

    let harness = env.register_contract(None, AssetClassHandlers);
    let admin = Address::generate(&env);
    let fund_addr = Address::generate(&env);
    let config = fund_config(&env, &[5_000, 5_000], 100);

    env.as_contract(&harness, || {
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &admin);
        fund::initialize_fund(env.clone(), admin.clone(), fund_addr.clone(), config);
    });

    env.as_contract(&harness, || {
        fund::rebalance_fund(
            env.clone(),
            admin.clone(),
            fund_addr.clone(),
            Vec::from_array(&env, [2_000u32, 8_000u32]),
        );
    });

    let updated = env.as_contract(&harness, || {
        fund::get_fund_config(env.clone(), fund_addr.clone())
    });
    assert_eq!(updated.weights.get(0).unwrap(), 2_000);
    assert_eq!(updated.weights.get(1).unwrap(), 8_000);
}

#[test]
fn fund_asset_class_defaults_are_registered() {
    let env = Env::default();
    let rules = AssetClassHandlers::get_default_compliance_rules(env.clone(), AssetClass::Fund);
    assert!(rules.kyc_required);
    assert!(rules.accredited_investor_only);

    assert!(AssetClassHandlers::get_default_dividend_schedule(env, AssetClass::Fund).is_some());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #175: carbon credit retirement
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn retiring_credits_reduces_balance_and_total_supply() {
    let (env, admin, token) = token_fixture("CarbonCredit");

    token.retire_credits(&admin, &1_000i128);

    assert_eq!(token.get_balance(&admin).amount, 999_000);
    assert_eq!(token.get_token_info().total_supply, 999_000);
}

#[test]
fn retirement_certificate_records_every_retirement() {
    let (env, admin, token) = token_fixture("CarbonCredit");

    token.retire_credits(&admin, &1_000i128);
    token.retire_credits_with_purpose(&admin, &500i128, &Symbol::new(&env, "offset"));

    let certificate = token.get_retirement_certificate(&admin);
    assert_eq!(certificate.len(), 2);
    assert_eq!(certificate.get(0).unwrap().amount, 1_000);
    assert_eq!(
        certificate.get(0).unwrap().purpose,
        Symbol::new(&env, "retire")
    );
    assert_eq!(
        certificate.get(1).unwrap().purpose,
        Symbol::new(&env, "offset")
    );
    assert_eq!(token.get_total_retired(&admin), 1_500);
}

#[test]
fn retired_credits_cannot_be_transferred() {
    let (env, admin, token) = token_fixture("CarbonCredit");
    let recipient = Address::generate(&env);

    token.retire_credits(&admin, &1_000i128);

    // Only the 999_000 credits still in circulation can move.
    let result = token.try_transfer(&admin, &recipient, &999_001i128);
    assert!(result.is_err());
}

#[test]
#[should_panic]
fn only_carbon_credit_tokens_can_be_retired() {
    let (_env, admin, token) = token_fixture("Art");
    token.retire_credits(&admin, &100i128);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #176: art provenance
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn transfer_appends_a_provenance_entry() {
    let (env, admin, token) = token_fixture("Art");
    env.ledger().set_timestamp(10_000);
    let alice = Address::generate(&env);

    token.transfer(&admin, &alice, &100i128);

    let history = token.get_provenance_history(&token.address);
    assert_eq!(history.len(), 1);

    let entry = history.get(0).unwrap();
    assert_eq!(entry.owner, alice);
    assert_eq!(entry.acquired_date, 10_000);
    assert_eq!(entry.method, Symbol::new(&env, "purchase"));
    assert_eq!(entry.event_type, ProvenanceEventType::Purchase);
}

#[test]
fn art_transfer_records_method_and_price() {
    let (env, admin, token) = token_fixture("Art");
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    token.transfer(&admin, &alice, &100i128);
    token.transfer_art(
        &alice,
        &bob,
        &40i128,
        &Symbol::new(&env, "inheritance"),
        &5_000i128,
        &Symbol::new(&env, "gallery"),
        &ProvenanceEventType::Inheritance,
    );

    let history = token.get_provenance_history(&token.address);
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(1).unwrap().owner, bob);
    assert_eq!(history.get(1).unwrap().price, 5_000);
    assert_eq!(
        history.get(1).unwrap().event_type,
        ProvenanceEventType::Inheritance
    );

    // The first link is unchanged: the chain is append-only.
    assert_eq!(history.get(0).unwrap().owner, alice);
    assert_eq!(history.get(0).unwrap().price, 0);
}

#[test]
fn admin_can_record_offchain_acquisition_events() {
    let (env, admin, token) = token_fixture("Art");
    let alice = Address::generate(&env);

    token.record_art_provenance(
        &admin,
        &alice,
        &Symbol::new(&env, "auction"),
        &12_000i128,
        &Symbol::new(&env, "london"),
        &ProvenanceEventType::Auction,
    );

    let history = token.get_provenance_history(&token.address);
    assert_eq!(history.len(), 1);
    assert_eq!(history.get(0).unwrap().method, Symbol::new(&env, "auction"));
    assert_eq!(
        history.get(0).unwrap().event_type,
        ProvenanceEventType::Auction
    );
}

#[test]
#[should_panic]
fn invalid_provenance_method_is_rejected() {
    let (env, admin, token) = token_fixture("Art");
    token.record_art_provenance(
        &admin,
        &admin,
        &Symbol::new(&env, "stolen"),
        &0i128,
        &Symbol::new(&env, "unknown"),
        &ProvenanceEventType::Purchase,
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #173: invoice credit rating monitoring
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn investment_grade_rating_does_not_flag_or_restrict() {
    let (env, admin, client) = compliance_fixture();
    let invoice = Address::generate(&env);

    client.update_credit_rating(&admin, &invoice, &Symbol::new(&env, "BBB"));
    let status = client.get_invoice_rating(&invoice);
    assert_eq!(status.current_rating, Symbol::new(&env, "BBB"));
    assert!(!status.compliance_flagged);
    assert!(!status.transfer_restricted);
}

#[test]
fn rating_below_bbb_flags_the_invoice() {
    let (env, admin, client) = compliance_fixture();
    let invoice = Address::generate(&env);

    client.update_credit_rating(&admin, &invoice, &Symbol::new(&env, "BB"));
    let status = client.get_invoice_rating(&invoice);
    assert!(status.compliance_flagged);
    assert!(!status.transfer_restricted);
    assert!(client.is_invoice_flagged(&invoice));
}

#[test]
fn rating_below_b_restricts_transfers() {
    let (env, admin, client) = compliance_fixture();
    let invoice = Address::generate(&env);

    client.update_credit_rating(&admin, &invoice, &Symbol::new(&env, "CCC"));
    let status = client.get_invoice_rating(&invoice);
    assert!(status.compliance_flagged);
    assert!(status.transfer_restricted);
    assert!(client.is_invoice_transfer_restricted(&invoice));
}

#[test]
fn rating_history_keeps_only_the_last_ten_changes() {
    let (env, admin, client) = compliance_fixture();
    let invoice = Address::generate(&env);

    let ratings = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];
    for index in 0..12 {
        client.update_credit_rating(
            &admin,
            &invoice,
            &Symbol::new(&env, ratings[index % ratings.len()]),
        );
    }

    let history = client.get_invoice_rating_history(&invoice);
    assert_eq!(history.len(), 10);

    // The retained window starts at the 3rd change (index 2 -> "A").
    assert_eq!(history.get(0).unwrap().rating, Symbol::new(&env, "A"));
    assert_eq!(history.get(9).unwrap().rating, Symbol::new(&env, "BB"));
}

#[test]
#[should_panic]
fn invalid_credit_rating_is_rejected() {
    let (env, admin, client) = compliance_fixture();
    client.update_credit_rating(
        &admin,
        &Address::generate(&env),
        &Symbol::new(&env, "D"),
    );
}

#[test]
fn rating_upgrade_clears_the_flags() {
    let (env, admin, client) = compliance_fixture();
    let invoice = Address::generate(&env);

    client.update_credit_rating(&admin, &invoice, &Symbol::new(&env, "CCC"));
    assert!(client.is_invoice_transfer_restricted(&invoice));

    client.update_credit_rating(&admin, &invoice, &Symbol::new(&env, "A"));
    let status = client.get_invoice_rating(&invoice);
    assert!(!status.compliance_flagged);
    assert!(!status.transfer_restricted);
}
