#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Symbol, Vec,
};

use crate::{
    compliance_registry::{ComplianceRegistry, ComplianceRegistryClient},
    dividend_distributor::{
        DividendConfig, DividendDistributor, DividendDistributorClient, DividendError,
    },
    rwa_token::{RWAToken, RWATokenClient},
};

// ── helpers ──────────────────────────────────────────────────────────────────

struct TestEnv {
    env: Env,
    admin: Address,
    distributor: DividendDistributorClient<'static>,
    token: RWATokenClient<'static>,
    currency_token: TokenClient<'static>,
    currency_symbol: Symbol,
}

fn setup() -> TestEnv {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Deploy a native Stellar asset as the dividend currency
    let currency_id = env.register_stellar_asset_contract_v2(admin.clone());
    let currency_token = TokenClient::new(&env, &currency_id.address());
    let currency_admin = StellarAssetClient::new(&env, &currency_id.address());
    // Mint 10_000 currency tokens to admin for distributions
    currency_admin.mint(&admin, &10_000i128);

    let currency_symbol = Symbol::new(&env, "USDC");

    // Deploy compliance registry (kyc_required = false for simplicity)
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &false, &false);

    // Deploy RWA token
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
        &admin, // placeholder — will be replaced by distributor below
    );

    // Deploy dividend distributor
    let dist_id = env.register_contract(None, DividendDistributor);
    let distributor = DividendDistributorClient::new(&env, &dist_id);
    let mut currencies = Vec::new(&env);
    currencies.push_back(currency_symbol.clone());
    distributor.initialize(&admin, &admin, &currencies);

    // Register the currency token address
    distributor.register_currency_token(&admin, &currency_symbol, &currency_id.address());

    // SAFETY: env lifetime is tied to the test scope.
    let distributor: DividendDistributorClient<'static> =
        unsafe { core::mem::transmute(distributor) };
    let token: RWATokenClient<'static> = unsafe { core::mem::transmute(token) };
    let currency_token: TokenClient<'static> = unsafe { core::mem::transmute(currency_token) };

    TestEnv {
        env,
        admin,
        distributor,
        token,
        currency_token,
        currency_symbol,
    }
}

fn advance_ledger(env: &Env, seconds: u64) {
    env.ledger().set(LedgerInfo {
        timestamp: env.ledger().timestamp() + seconds,
        ..env.ledger().get()
    });
}

// ── initialize ───────────────────────────────────────────────────────────────

#[test]
fn initialize_succeeds() {
    let t = setup();
    // If we get here without panic, initialize worked
    assert_eq!(t.distributor.get_active_distributions(&t.token.address).len(), 0);
}

#[test]
#[should_panic]
fn initialize_twice_panics() {
    let t = setup();
    let currencies = Vec::new(&t.env);
    t.distributor.initialize(&t.admin, &t.admin, &currencies);
}

// ── create_distribution ───────────────────────────────────────────────────────

#[test]
fn create_distribution_returns_id_one() {
    let t = setup();
    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );
    assert_eq!(id, 1);
}

#[test]
fn create_distribution_increments_id() {
    let t = setup();
    let deadline = t.env.ledger().timestamp() + 86400;
    let id1 = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );
    let id2 = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );
    assert_eq!(id2, id1 + 1);
}

#[test]
#[should_panic]
fn create_distribution_with_zero_amount_panics() {
    let t = setup();
    let deadline = t.env.ledger().timestamp() + 86400;
    t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &0i128,
        &deadline,
        &Map::new(&t.env),
    );
}

#[test]
#[should_panic]
fn create_distribution_with_unsupported_currency_panics() {
    let t = setup();
    let deadline = t.env.ledger().timestamp() + 86400;
    t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &Symbol::new(&t.env, "UNKNOWN"),
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );
}

#[test]
#[should_panic]
fn create_distribution_by_non_admin_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    let deadline = t.env.ledger().timestamp() + 86400;
    t.distributor.create_distribution(
        &attacker,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );
}

// ── get_distribution ─────────────────────────────────────────────────────────

#[test]
fn get_distribution_returns_correct_data() {
    let t = setup();
    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );
    let dist = t.distributor.get_distribution(&id);
    assert_eq!(dist.distribution_id, id);
    assert_eq!(dist.total_amount, 1000);
    assert!(dist.is_active);
}

#[test]
#[should_panic]
fn get_distribution_for_nonexistent_id_panics() {
    let t = setup();
    t.distributor.get_distribution(&999u64);
}

// ── claim_dividend ────────────────────────────────────────────────────────────

#[test]
fn claim_dividend_transfers_net_amount_to_claimer() {
    let t = setup();
    let claimer = Address::generate(&t.env);

    // Give claimer 500_000 tokens (50% of supply)
    t.token.transfer(&t.admin, &claimer, &500_000i128);

    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );

    let claimed = t.distributor.claim_dividend(&id, &claimer);
    // 50% of 1000 = 500, minus 0.5% fee (fee_rate=50 bps) = ~497
    assert!(claimed > 0);
    assert!(claimed <= 500);
}

#[test]
#[should_panic]
fn claim_dividend_twice_panics() {
    let t = setup();
    let claimer = Address::generate(&t.env);
    t.token.transfer(&t.admin, &claimer, &100_000i128);

    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );

    t.distributor.claim_dividend(&id, &claimer);
    t.distributor.claim_dividend(&id, &claimer); // second claim should panic
}

#[test]
#[should_panic]
fn claim_dividend_after_deadline_panics() {
    let t = setup();
    let claimer = Address::generate(&t.env);
    t.token.transfer(&t.admin, &claimer, &100_000i128);

    let deadline = t.env.ledger().timestamp() + 10;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );

    // Advance past deadline
    advance_ledger(&t.env, 100);
    t.distributor.claim_dividend(&id, &claimer);
}

#[test]
#[should_panic]
fn claim_dividend_with_zero_balance_panics() {
    let t = setup();
    let claimer = Address::generate(&t.env); // no tokens

    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );

    t.distributor.claim_dividend(&id, &claimer);
}

// ── calculate_available_dividend ─────────────────────────────────────────────

#[test]
fn calculate_available_dividend_returns_proportional_amount() {
    let t = setup();
    let claimer = Address::generate(&t.env);
    t.token.transfer(&t.admin, &claimer, &500_000i128); // 50%

    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );

    let available = t.distributor.calculate_available_dividend(&id, &claimer);
    assert!(available > 0);
    assert!(available <= 500);
}

#[test]
fn calculate_available_dividend_returns_zero_after_claim() {
    let t = setup();
    let claimer = Address::generate(&t.env);
    t.token.transfer(&t.admin, &claimer, &500_000i128);

    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );

    t.distributor.claim_dividend(&id, &claimer);
    let available = t.distributor.calculate_available_dividend(&id, &claimer);
    assert_eq!(available, 0);
}

// ── deactivate_distribution ───────────────────────────────────────────────────

#[test]
#[should_panic]
fn claim_on_deactivated_distribution_panics() {
    let t = setup();
    let claimer = Address::generate(&t.env);
    t.token.transfer(&t.admin, &claimer, &100_000i128);

    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );

    t.distributor.deactivate_distribution(&t.admin, &id);
    t.distributor.claim_dividend(&id, &claimer);
}

// ── update_config ─────────────────────────────────────────────────────────────

#[test]
fn update_config_changes_fee_rate() {
    let t = setup();
    let mut currencies = Vec::new(&t.env);
    currencies.push_back(t.currency_symbol.clone());
    let new_config = DividendConfig {
        supported_currencies: currencies,
        auto_distribute: false,
        min_distribution_amount: 1000,
        max_distribution_frequency: 86400,
        fee_rate: 100, // changed from 50 to 100 bps
        fee_recipient: t.admin.clone(),
    };
    t.distributor.update_config(&t.admin, &new_config);
    // Verify by creating a distribution and checking the claimed amount reflects new fee
    let claimer = Address::generate(&t.env);
    t.token.transfer(&t.admin, &claimer, &1_000_000i128);
    let deadline = t.env.ledger().timestamp() + 86400;
    let id = t.distributor.create_distribution(
        &t.admin,
        &t.token.address,
        &t.currency_symbol,
        &1000i128,
        &deadline,
        &Map::new(&t.env),
    );
    let claimed = t.distributor.claim_dividend(&id, &claimer);
    // 100% of supply → 1000 total, minus 1% fee = 990
    assert_eq!(claimed, 990);
}
