#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Map, Symbol, Vec,
};
use std::fs;
use std::path::Path;

use crate::{
    compliance_registry::{ComplianceRegistry, ComplianceRegistryClient, KYCStatus},
    rwa_token::{RWAToken, RWATokenClient},
    secondary_market::{SecondaryMarket, SecondaryMarketClient},
    dividend_distributor::{DividendDistributor, DividendDistributorClient},
    custody_validator::{CustodyValidator, CustodyValidatorClient},
};

/// Baseline file for gas consumption regression detection
const BASELINE_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/gas-baseline.json");

/// Maximum allowed increase from baseline (5%)
const GAS_REGRESSION_THRESHOLD_PCT: f64 = 5.0;

/// Read the gas baseline from disk
fn load_baseline() -> serde_json::Value {
    if Path::new(BASELINE_PATH).exists() {
        let contents = fs::read_to_string(BASELINE_PATH)
            .expect("Failed to read gas baseline");
        serde_json::from_str(&contents).expect("Failed to parse gas baseline")
    } else {
        serde_json::json!({})
    }
}

/// Write the gas baseline to disk
fn save_baseline(baseline: &serde_json::Value) {
    let contents = serde_json::to_string_pretty(baseline)
        .expect("Failed to serialize gas baseline");
    fs::write(BASELINE_PATH, contents).expect("Failed to write gas baseline");
}

/// Check a gas measurement against the baseline, reporting regressions
fn check_gas_regression(operation: &str, gas_used: u64) {
    let baseline = load_baseline();
    let baseline_gas = baseline.get(operation)
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if baseline_gas == 0 {
        // First run: record the baseline
        let mut new_baseline = baseline.clone();
        new_baseline[operation] = serde_json::json!(gas_used);
        save_baseline(&new_baseline);
        println!(
            "GAS BASELINE: {} = {} units (initial recording)",
            operation, gas_used
        );
        return;
    }

    let increase_pct = if baseline_gas == 0 {
        0.0
    } else {
        ((gas_used as f64 - baseline_gas as f64) / baseline_gas as f64) * 100.0
    };

    println!(
        "GAS BENCH: {} = {} (baseline: {}, delta: {:.1}%)",
        operation, gas_used, baseline_gas, increase_pct
    );

    if increase_pct > GAS_REGRESSION_THRESHOLD_PCT {
        panic!(
            "GAS REGRESSION DETECTED: {} increased by {:.1}% ({} -> {}). \
             Threshold is {}%.",
            operation, increase_pct, baseline_gas, gas_used, GAS_REGRESSION_THRESHOLD_PCT
        );
    }

    // Update baseline if improved
    if gas_used < baseline_gas {
        let mut new_baseline = baseline.clone();
        new_baseline[operation] = serde_json::json!(gas_used);
        save_baseline(&new_baseline);
        println!(
            "GAS BASELINE IMPROVED: {} reduced from {} to {} (updated)",
            operation, baseline_gas, gas_used
        );
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

struct GasTestEnv {
    env: Env,
    admin: Address,
    user: Address,
    token: RWATokenClient<'static>,
    compliance: ComplianceRegistryClient<'static>,
}

fn setup_gas_env() -> GasTestEnv {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Deploy compliance
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &false, &false);

    // Deploy token
    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);

    let mut metadata = Map::new(&env);
    metadata.set(Symbol::new(&env, "asset_type"), Symbol::new(&env, "real_estate"));

    token.initialize(
        &admin,
        &Symbol::new(&env, "GasToken"),
        &Symbol::new(&env, "GAS"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &metadata,
        &compliance_id,
        &admin,
    );

    // SAFETY: env lifetime is bound to test scope
    let token: RWATokenClient<'static> = unsafe { core::mem::transmute(token) };
    let compliance: ComplianceRegistryClient<'static> = unsafe { core::mem::transmute(compliance) };

    GasTestEnv { env, admin, user, token, compliance }
}

/// Get the gas budget consumed during execution.
/// Uses soroban-sdk's budget metering via the host function interface.
fn get_gas_consumed(env: &Env) -> u64 {
    // The soroban-sdk test environment tracks budget consumption.
    // We access it through the budget component.
    let budget = env.budget();
    // Return the total CPU instructions consumed so far.
    // In soroban-sdk 22.x, budget tracking is available via:
    // env.cost_estimate() returns the HostCostEstimate, but if unavailable
    // we fall back to a reasonable default for the benchmark comparison.
    budget.cpu_instruction_cost()
}

// ── Gas Benchmarks: RWA Token Operations ─────────────────────────────────────

#[test]
fn gas_bench_mint() {
    let t = setup_gas_env();
    let recipient = Address::generate(&t.env);

    t.env.budget().reset_default();
    t.token.mint(&t.admin, &recipient, &1000i128);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("mint", gas);
}

#[test]
fn gas_bench_transfer() {
    let t = setup_gas_env();
    let recipient = Address::generate(&t.env);

    // Pre-fund recipient with some tokens
    t.token.mint(&t.admin, &recipient, &5000i128);

    t.env.budget().reset_default();
    t.token.transfer(&t.admin, &recipient, &100i128);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("transfer", gas);
}

#[test]
fn gas_bench_burn() {
    let t = setup_gas_env();

    t.env.budget().reset_default();
    t.token.burn(&t.admin, &100i128);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("burn", gas);
}

#[test]
fn gas_bench_lock_tokens() {
    let t = setup_gas_env();

    t.env.budget().reset_default();
    t.token.lock_tokens(&t.admin, &t.admin, &100i128, &3600u64);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("lock_tokens", gas);
}

#[test]
fn gas_bench_unlock_tokens() {
    let t = setup_gas_env();

    t.token.lock_tokens(&t.admin, &t.admin, &100i128, &3600u64);

    t.env.budget().reset_default();
    t.token.unlock_tokens(&t.admin, &t.admin, &100i128);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("unlock_tokens", gas);
}

#[test]
fn gas_bench_pause() {
    let t = setup_gas_env();

    t.env.budget().reset_default();
    t.token.pause(&t.admin);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("pause", gas);
}

#[test]
fn gas_bench_get_token_info() {
    let t = setup_gas_env();

    t.env.budget().reset_default();
    let _info = t.token.get_token_info();
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("get_token_info", gas);
}

#[test]
fn gas_bench_get_balance() {
    let t = setup_gas_env();

    t.env.budget().reset_default();
    let _balance = t.token.get_balance(&t.admin);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("get_balance", gas);
}

// ── Gas Benchmarks: Compliance Registry ──────────────────────────────────────

#[test]
fn gas_bench_update_kyc() {
    let t = setup_gas_env();

    let kyc = KYCStatus {
        is_verified: true,
        verification_level: 2,
        expiry_date: t.env.ledger().timestamp() + 86400 * 365,
        jurisdiction: Symbol::new(&t.env, "US"),
        is_accredited: true,
        risk_score: 3,
        aml_flags: Vec::new(&t.env),
    };

    t.env.budget().reset_default();
    t.compliance.update_kyc_status(&t.admin, &t.user, kyc);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("update_kyc_status", gas);
}

#[test]
fn gas_bench_add_to_blacklist() {
    let t = setup_gas_env();

    t.env.budget().reset_default();
    t.compliance.add_to_blacklist(
        &t.admin,
        &t.user,
        &Symbol::new(&t.env, "compliance_violation"),
    );
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("add_to_blacklist", gas);
}

#[test]
fn gas_bench_remove_from_blacklist() {
    let t = setup_gas_env();

    t.compliance.add_to_blacklist(&t.admin, &t.user, &Symbol::new(&t.env, "test"));

    t.env.budget().reset_default();
    t.compliance.remove_from_blacklist(&t.admin, &t.user);
    let gas = get_gas_consumed(&t.env);

    check_gas_regression("remove_from_blacklist", gas);
}

// ── Gas Benchmarks: Secondary Market ─────────────────────────────────────────

#[test]
fn gas_bench_place_order() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let base_token = Address::generate(&env);

    // Deploy and initialize market
    let market_id = env.register_contract(None, SecondaryMarket);
    let market = SecondaryMarketClient::new(&env, &market_id);
    market.initialize(&admin, &base_token);

    // Add a supported token
    market.add_supported_token(&admin, &base_token);

    env.budget().reset_default();
    market.place_order(
        &admin,
        &base_token,
        &Symbol::new(&env, "buy"),
        &1000i128,
        &10_000_000i128, // 10 USDC (7 decimals)
        &(env.ledger().timestamp() + 86400 * 7),
    );
    let gas = get_gas_consumed(&env);

    check_gas_regression("place_order", gas);
}

#[test]
fn gas_bench_cancel_order() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let base_token = Address::generate(&env);

    let market_id = env.register_contract(None, SecondaryMarket);
    let market = SecondaryMarketClient::new(&env, &market_id);
    market.initialize(&admin, &base_token);
    market.add_supported_token(&admin, &base_token);

    market.place_order(
        &admin,
        &base_token,
        &Symbol::new(&env, "buy"),
        &1000i128,
        &10_000_000i128,
        &(env.ledger().timestamp() + 86400 * 7),
    );

    env.budget().reset_default();
    market.cancel_order(&admin, &1u64);
    let gas = get_gas_consumed(&env);

    check_gas_regression("cancel_order", gas);
}

#[test]
fn gas_bench_fill_order() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let seller = Address::generate(&env);
    let base_token = Address::generate(&env);

    let market_id = env.register_contract(None, SecondaryMarket);
    let market = SecondaryMarketClient::new(&env, &market_id);
    market.initialize(&admin, &base_token);
    market.add_supported_token(&admin, &base_token);

    // Place sell order
    market.place_order(
        &admin,
        &base_token,
        &Symbol::new(&env, "sell"),
        &1000i128,
        &10_000_000i128,
        &(env.ledger().timestamp() + 86400 * 7),
    );

    // Place buy order
    market.place_order(
        &seller,
        &base_token,
        &Symbol::new(&env, "buy"),
        &500i128,
        &10_000_000i128,
        &(env.ledger().timestamp() + 86400 * 7),
    );

    env.budget().reset_default();
    let _result = market.fill_order(&admin, &1u64, &2u64);
    let gas = get_gas_consumed(&env);

    check_gas_regression("fill_order", gas);
}

// ── Gas Benchmarks: Dividend Distributor ─────────────────────────────────────

#[test]
fn gas_bench_claim_dividend() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_addr = Address::generate(&env);

    let dividend_id = env.register_contract(None, DividendDistributor);
    let dividend = DividendDistributorClient::new(&env, &dividend_id);
    dividend.initialize(&admin, &token_addr);

    // Create a distribution
    dividend.create_distribution(
        &admin,
        &token_addr,
        &Symbol::new(&env, "USDC"),
        &1_000_000i128,
        &(env.ledger().timestamp() + 86400 * 30),
        &Map::new(&env),
    );

    env.budget().reset_default();
    dividend.claim_dividend(&admin, &1u64);
    let gas = get_gas_consumed(&env);

    check_gas_regression("claim_dividend", gas);
}

#[test]
fn gas_bench_create_distribution() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_addr = Address::generate(&env);

    let dividend_id = env.register_contract(None, DividendDistributor);
    let dividend = DividendDistributorClient::new(&env, &dividend_id);
    dividend.initialize(&admin, &token_addr);

    env.budget().reset_default();
    dividend.create_distribution(
        &admin,
        &token_addr,
        &Symbol::new(&env, "USDC"),
        &1_000_000i128,
        &(env.ledger().timestamp() + 86400 * 30),
        &Map::new(&env),
    );
    let gas = get_gas_consumed(&env);

    check_gas_regression("create_distribution", gas);
}

// ── Gas Benchmarks: Custody Validator ────────────────────────────────────────

#[test]
fn gas_bench_submit_attestation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let custody_id = env.register_contract(None, CustodyValidator);
    let custody = CustodyValidatorClient::new(&env, &custody_id);
    custody.initialize(&admin);

    let asset_id = Address::generate(&env);

    let mut proof_data = Map::new(&env);
    proof_data.set(Symbol::new(&env, "location"), Symbol::new(&env, "vault-42"));
    proof_data.set(Symbol::new(&env, "value"), Symbol::new(&env, "1000000"));
    proof_data.set(
        Symbol::new(&env, "proof_hash"),
        Symbol::new(&env, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"),
    );

    let signatures = Vec::new(&env);

    env.budget().reset_default();
    custody.submit_attestation(
        &admin,
        &asset_id,
        &Symbol::new(&env, "physical"),
        proof_data,
        signatures,
    );
    let gas = get_gas_consumed(&env);

    check_gas_regression("submit_attestation", gas);
}

// ── Gas Report Printer ───────────────────────────────────────────────────────

/// Run with `-- --nocapture` to see the gas report
#[test]
fn print_gas_report() {
    let baseline = load_baseline();
    if baseline.as_object().map(|o| o.is_empty()).unwrap_or(true) {
        println!("\n📊 GAS REPORT: No baseline data yet.");
        println!("   Run individual benchmarks first to populate the baseline.\n");
    } else {
        println!("\n📊 GAS CONSUMPTION REPORT");
        println!("{:=^60}", "");
        println!("{:<35} {:>10}", "Operation", "Gas (cpu insns)");
        println!("{:-^60}", "");

        let mut entries: Vec<(&str, u64)> = baseline
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_u64().unwrap_or(0)))
            .collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));

        for (op, gas) in &entries {
            println!("{:<35} {:>10}", op, gas);
        }
        println!("{:=^60}\n", "");
    }
}
