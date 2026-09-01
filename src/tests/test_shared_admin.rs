#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Map, Symbol, Vec,
};

use crate::{
    compliance_registry::{ComplianceRegistry, ComplianceRegistryClient},
    dividend_distributor::{DividendConfig, DividendDistributor, DividendDistributorClient},
    rwa_token::{RWAToken, RWATokenClient},
    secondary_market::{MarketConfig, SecondaryMarket, SecondaryMarketClient},
};

// ── helpers ──────────────────────────────────────────────────────────────────

struct Deployed {
    env: Env,
    admin: Address,
    attacker: Address,
    token_id: Address,
    compliance_id: Address,
    dist_id: Address,
    market_id: Address,
    currency: Address,
    currency_symbol: Symbol,
}

fn deploy() -> Deployed {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    // Compliance registry
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &false, &false);

    // Dividend distributor
    let dist_id = env.register_contract(None, DividendDistributor);
    let dist = DividendDistributorClient::new(&env, &dist_id);
    let mut currencies = Vec::new(&env);
    currencies.push_back(Symbol::new(&env, "USDC"));
    dist.initialize(&admin, &admin, &currencies);

    // RWA token
    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &Symbol::new(&env, "RWAToken"),
        &Symbol::new(&env, "RWA"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &dist_id,
    );

    // Secondary market (uses shared_admin admin key after #187)
    let market_id = env.register_contract(None, SecondaryMarket);
    let market = SecondaryMarketClient::new(&env, &market_id);
    market.initialize(
        &admin,
        &token_id,
        &compliance_id,
        &dist_id,
        &50i64,
        &10i128,
        &2000i64,
    );

    let currency = Address::generate(&env);
    let currency_symbol = Symbol::new(&env, "USDC");

    Deployed {
        env,
        admin,
        attacker,
        token_id,
        compliance_id,
        dist_id,
        market_id,
        currency,
        currency_symbol,
    }
}

fn market_config(d: &Deployed) -> MarketConfig {
    MarketConfig {
        admin: d.admin.clone(),
        fee_rate_bps: 100,
        fee_recipient: d.admin.clone(),
        min_order_size: 100,
        max_price_deviation_bps: 2000,
        is_paused: false,
        base_currency: d.token_id.clone(),
        compliance_registry: d.compliance_id.clone(),
        dividend_distributor: d.dist_id.clone(),
    }
}

fn dividend_config(d: &Deployed) -> DividendConfig {
    DividendConfig {
        supported_currencies: Vec::new(&d.env),
        auto_distribute: false,
        min_distribution_amount: 100,
        max_distribution_frequency: 60,
        fee_rate: 0,
        fee_recipient: d.admin.clone(),
    }
}

// ── check_admin vs require_admin (shared_admin) ───────────────────────────────

#[test]
fn check_admin_returns_true_for_admin_and_false_for_others() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    crate::shared_admin::write_admin(&env, &admin, &admin);

    assert!(crate::shared_admin::check_admin(&env, &admin));
    assert!(!crate::shared_admin::check_admin(&env, &attacker));
}

#[test]
fn check_admin_returns_false_when_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    assert!(!crate::shared_admin::check_admin(&env, &admin));
}

#[test]
#[should_panic]
fn require_admin_panics_for_non_admin_while_check_admin_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    crate::shared_admin::write_admin(&env, &admin, &admin);
    assert!(!crate::shared_admin::check_admin(&env, &attacker));

    // check_admin returned false without panicking; require_admin must hard-fail.
    crate::shared_admin::require_admin(&env, &attacker);
}

// ── cross-contract: admin-gated calls must reject non-admins ─────────────────

#[test]
#[should_panic]
fn rwa_token_rejects_non_admin_freeze() {
    let d = deploy();
    let token = RWATokenClient::new(&d.env, &d.token_id);
    token.freeze(&d.attacker);
}

#[test]
#[should_panic]
fn rwa_token_rejects_non_admin_mint() {
    let d = deploy();
    let token = RWATokenClient::new(&d.env, &d.token_id);
    token.mint(&d.attacker, &d.attacker, &100i128);
}

#[test]
#[should_panic]
fn compliance_registry_rejects_non_admin_blacklist() {
    let d = deploy();
    let compliance = ComplianceRegistryClient::new(&d.env, &d.compliance_id);
    compliance.add_to_blacklist(&d.attacker, &d.attacker, &Symbol::new(&d.env, "test"));
}

#[test]
#[should_panic]
fn dividend_distributor_rejects_non_admin_update_config() {
    let d = deploy();
    let dist = DividendDistributorClient::new(&d.env, &d.dist_id);
    dist.update_config(&d.attacker, &dividend_config(&d));
}

#[test]
#[should_panic]
fn secondary_market_rejects_non_admin_update_config() {
    let d = deploy();
    let market = SecondaryMarketClient::new(&d.env, &d.market_id);
    market.update_config(&d.attacker, &market_config(&d));
}

// ── cross-contract: admin-gated calls succeed for the admin ──────────────────

#[test]
fn admin_ops_succeed_across_contracts() {
    let d = deploy();

    let token = RWATokenClient::new(&d.env, &d.token_id);
    token.pause(&d.admin);
    let info = token.get_token_info();
    assert!(info.is_paused);

    let compliance = ComplianceRegistryClient::new(&d.env, &d.compliance_id);
    compliance.update_kyc_status(
        &d.admin,
        &d.attacker,
        &crate::compliance_registry::KYCStatus {
            is_verified: true,
            verification_level: 1,
            expiry_date: u64::MAX,
            jurisdiction: Symbol::new(&d.env, "US"),
            is_accredited: false,
            risk_score: 0,
            aml_flags: Vec::new(&d.env),
        },
    );
    assert!(
        compliance
            .get_kyc_status(&d.attacker)
            .is_verified
    );

    let dist = DividendDistributorClient::new(&d.env, &d.dist_id);
    dist.register_currency_token(&d.admin, &d.currency_symbol, &d.currency);
    dist.update_config(&d.admin, &dividend_config(&d));

    let market = SecondaryMarketClient::new(&d.env, &d.market_id);
    market.update_config(&d.admin, &market_config(&d));
}

// ── secondary_market admin transfer (shared_admin key) ───────────────────────

#[test]
fn secondary_market_update_admin_transfers_control() {
    let d = deploy();
    let market = SecondaryMarketClient::new(&d.env, &d.market_id);
    let new_admin = Address::generate(&d.env);

    market.update_admin(&d.admin, &new_admin);
    market.update_config(&new_admin, &market_config(&d));
}

#[test]
#[should_panic]
fn secondary_market_old_admin_rejected_after_transfer() {
    let d = deploy();
    let market = SecondaryMarketClient::new(&d.env, &d.market_id);
    let new_admin = Address::generate(&d.env);

    market.update_admin(&d.admin, &new_admin);
    market.update_config(&d.admin, &market_config(&d));
}