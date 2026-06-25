#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, Symbol, Vec,
};

use crate::{
    compliance_registry::{ComplianceRegistry, ComplianceRegistryClient, KYCStatus},
    dividend_distributor::{DividendDistributor, DividendDistributorClient},
    rwa_token::{RWAToken, RWATokenClient},
    secondary_market::{MarketError, SecondaryMarket, SecondaryMarketClient},
};

// ── helpers ──────────────────────────────────────────────────────────────────

struct TestEnv {
    env: Env,
    admin: Address,
    market: SecondaryMarketClient<'static>,
    token: RWATokenClient<'static>,
    base_token: TokenClient<'static>,
    compliance: ComplianceRegistryClient<'static>,
}

fn setup() -> TestEnv {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Base currency (USDC-like)
    let base_id = env.register_stellar_asset_contract_v2(admin.clone());
    let base_token = TokenClient::new(&env, &base_id.address());
    let base_admin = StellarAssetClient::new(&env, &base_id.address());
    base_admin.mint(&admin, &1_000_000i128);

    // Compliance registry (kyc_required = false for most tests)
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &false, &false);

    // Dividend distributor (placeholder)
    let dist_id = env.register_contract(None, DividendDistributor);
    let dist = DividendDistributorClient::new(&env, &dist_id);
    dist.initialize(&admin, &admin, &Vec::new(&env));

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

    // Secondary market
    let market_id = env.register_contract(None, SecondaryMarket);
    let market = SecondaryMarketClient::new(&env, &market_id);
    market.initialize(
        &admin,
        &base_id.address(),
        &compliance_id,
        &dist_id,
        &50i64,   // 0.5% fee
        &10i128,  // min order size
        &2000i64, // 20% max price deviation
    );

    // SAFETY: env lifetime is tied to the test scope.
    let market: SecondaryMarketClient<'static> = unsafe { core::mem::transmute(market) };
    let token: RWATokenClient<'static> = unsafe { core::mem::transmute(token) };
    let base_token: TokenClient<'static> = unsafe { core::mem::transmute(base_token) };
    let compliance: ComplianceRegistryClient<'static> = unsafe { core::mem::transmute(compliance) };

    TestEnv { env, admin, market, token, base_token, compliance }
}

fn future_expiry(env: &Env) -> u64 {
    env.ledger().timestamp() + 3600
}

// ── initialize ───────────────────────────────────────────────────────────────

#[test]
fn initialize_succeeds() {
    // setup() calls initialize; if we reach here it worked
    let _ = setup();
}

#[test]
#[should_panic]
fn initialize_twice_panics() {
    let t = setup();
    let other = Address::generate(&t.env);
    t.market.initialize(
        &t.admin,
        &other,
        &other,
        &other,
        &50i64,
        &10i128,
        &2000i64,
    );
}

// ── place_order (buy) ─────────────────────────────────────────────────────────

#[test]
fn place_buy_order_returns_order_id() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    // Fund buyer with base currency
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);

    let order_id = t.market.place_order(
        &buyer,
        &t.token.address,
        &Symbol::new(&t.env, "buy"),
        &100i128,  // price
        &50i128,   // amount
        &future_expiry(&t.env),
        &0i128,    // min_fill
    );
    assert_eq!(order_id, 1);
}

#[test]
fn place_multiple_orders_increments_ids() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &100_000i128);

    let id1 = t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &100i128, &50i128, &future_expiry(&t.env), &0i128,
    );
    let id2 = t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &100i128, &50i128, &future_expiry(&t.env), &0i128,
    );
    assert_eq!(id2, id1 + 1);
}

#[test]
#[should_panic]
fn place_order_below_min_size_panics() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);

    // amount = 5, min_order_size = 10
    t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &100i128, &5i128, &future_expiry(&t.env), &0i128,
    );
}

#[test]
#[should_panic]
fn place_order_with_zero_price_panics() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);

    t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &0i128, &50i128, &future_expiry(&t.env), &0i128,
    );
}

#[test]
#[should_panic]
fn place_order_with_expired_expiry_panics() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);

    // expiry in the past
    t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &100i128, &50i128, &0u64, &0i128,
    );
}

#[test]
#[should_panic]
fn place_order_with_invalid_side_panics() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);

    t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "invalid"),
        &100i128, &50i128, &future_expiry(&t.env), &0i128,
    );
}

// ── place_order (sell) ────────────────────────────────────────────────────────

#[test]
fn place_sell_order_escrows_rwa_tokens() {
    let t = setup();
    let seller = Address::generate(&t.env);
    t.token.transfer(&t.admin, &seller, &200i128);

    let balance_before = t.token.get_balance(&seller).amount;
    t.market.place_order(
        &seller, &t.token.address, &Symbol::new(&t.env, "sell"),
        &100i128, &100i128, &future_expiry(&t.env), &0i128,
    );
    let balance_after = t.token.get_balance(&seller).amount;
    assert_eq!(balance_before - balance_after, 100);
}

// ── cancel_order ──────────────────────────────────────────────────────────────

#[test]
fn cancel_buy_order_refunds_base_currency() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);

    let balance_before = t.base_token.balance(&buyer);
    let order_id = t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &100i128, &50i128, &future_expiry(&t.env), &0i128,
    );
    t.market.cancel_order(&buyer, &order_id);
    let balance_after = t.base_token.balance(&buyer);
    assert_eq!(balance_after, balance_before);
}

#[test]
fn cancel_sell_order_refunds_rwa_tokens() {
    let t = setup();
    let seller = Address::generate(&t.env);
    t.token.transfer(&t.admin, &seller, &200i128);

    let balance_before = t.token.get_balance(&seller).amount;
    let order_id = t.market.place_order(
        &seller, &t.token.address, &Symbol::new(&t.env, "sell"),
        &100i128, &100i128, &future_expiry(&t.env), &0i128,
    );
    t.market.cancel_order(&seller, &order_id);
    let balance_after = t.token.get_balance(&seller).amount;
    assert_eq!(balance_after, balance_before);
}

#[test]
#[should_panic]
fn cancel_order_by_non_maker_panics() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let attacker = Address::generate(&t.env);
    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);

    let order_id = t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &100i128, &50i128, &future_expiry(&t.env), &0i128,
    );
    t.market.cancel_order(&attacker, &order_id);
}

#[test]
#[should_panic]
fn cancel_nonexistent_order_panics() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    t.market.cancel_order(&buyer, &999u64);
}

// ── fill_order ────────────────────────────────────────────────────────────────

#[test]
fn fill_buy_order_settles_correctly() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let seller = Address::generate(&t.env);

    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);
    t.token.transfer(&t.admin, &seller, &200i128);

    // Buyer places buy order: 100 tokens at price 10 each = 1000 base
    let order_id = t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &10i128, &100i128, &future_expiry(&t.env), &0i128,
    );

    let seller_rwa_before = t.token.get_balance(&seller).amount;
    let buyer_rwa_before = t.token.get_balance(&buyer).amount;

    // Seller fills the order
    t.market.fill_order(&seller, &order_id, &100i128);

    // Seller should have 100 fewer RWA tokens
    assert_eq!(t.token.get_balance(&seller).amount, seller_rwa_before - 100);
    // Buyer should have 100 more RWA tokens
    assert_eq!(t.token.get_balance(&buyer).amount, buyer_rwa_before + 100);
}

#[test]
#[should_panic]
fn fill_order_exceeding_remaining_amount_panics() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let seller = Address::generate(&t.env);

    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);
    t.token.transfer(&t.admin, &seller, &500i128);

    let order_id = t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &10i128, &50i128, &future_expiry(&t.env), &0i128,
    );

    // Try to fill 100 when order is only for 50
    t.market.fill_order(&seller, &order_id, &100i128);
}

#[test]
#[should_panic]
fn fill_nonexistent_order_panics() {
    let t = setup();
    let taker = Address::generate(&t.env);
    t.market.fill_order(&taker, &999u64, &10i128);
}

// ── VWAP ─────────────────────────────────────────────────────────────────────

#[test]
fn get_vwap_returns_zero_before_any_trades() {
    let t = setup();
    let vwap = t.market.get_vwap(&t.token.address);
    assert_eq!(vwap, 0);
}

#[test]
fn get_vwap_reflects_trade_price_after_fill() {
    let t = setup();
    let buyer = Address::generate(&t.env);
    let seller = Address::generate(&t.env);

    let base_admin = StellarAssetClient::new(&t.env, &t.base_token.address());
    base_admin.mint(&buyer, &10_000i128);
    t.token.transfer(&t.admin, &seller, &200i128);

    let order_id = t.market.place_order(
        &buyer, &t.token.address, &Symbol::new(&t.env, "buy"),
        &50i128, &100i128, &future_expiry(&t.env), &0i128,
    );
    t.market.fill_order(&seller, &order_id, &100i128);

    let vwap = t.market.get_vwap(&t.token.address);
    assert_eq!(vwap, 50); // single trade at price 50
}

// ── compliance enforcement ────────────────────────────────────────────────────

#[test]
#[should_panic]
fn place_order_by_unverified_user_when_kyc_required_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let base_id = env.register_stellar_asset_contract_v2(admin.clone());
    let base_admin = StellarAssetClient::new(&env, &base_id.address());

    // Compliance with kyc_required = true
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &true, &false);

    let dist_id = env.register_contract(None, DividendDistributor);
    let dist = DividendDistributorClient::new(&env, &dist_id);
    dist.initialize(&admin, &admin, &Vec::new(&env));

    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &Symbol::new(&env, "T"),
        &Symbol::new(&env, "T"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &dist_id,
    );

    let market_id = env.register_contract(None, SecondaryMarket);
    let market = SecondaryMarketClient::new(&env, &market_id);
    market.initialize(
        &admin, &base_id.address(), &compliance_id, &dist_id,
        &50i64, &10i128, &2000i64,
    );

    let unverified_buyer = Address::generate(&env);
    base_admin.mint(&unverified_buyer, &10_000i128);

    // Should panic because KYC is required and buyer is not verified
    market.place_order(
        &unverified_buyer, &token_id,
        &Symbol::new(&env, "buy"),
        &100i128, &50i128,
        &(env.ledger().timestamp() + 3600),
        &0i128,
    );
}
