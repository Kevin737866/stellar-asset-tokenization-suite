#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Symbol, Vec,
};

use crate::compliance_registry::{
    ComplianceRegistry, ComplianceRegistryClient, ComplianceError, KYCStatus, TransferLimits,
};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, ComplianceRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, ComplianceRegistry);
    let client = ComplianceRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &admin, &true, &false);
    // SAFETY: env lifetime is tied to the test scope; the client borrows it.
    let client: ComplianceRegistryClient<'static> = unsafe { core::mem::transmute(client) };
    (env, admin, client)
}

fn verified_kyc(env: &Env) -> KYCStatus {
    KYCStatus {
        is_verified: true,
        verification_level: 2,
        expiry_date: env.ledger().timestamp() + 86400 * 365,
        jurisdiction: Symbol::new(env, "US"),
        is_accredited: true,
        risk_score: 1,
        aml_flags: Vec::new(env),
    }
}

// ── initialize ───────────────────────────────────────────────────────────────

#[test]
fn initialize_sets_kyc_required_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, ComplianceRegistry);
    let client = ComplianceRegistryClient::new(&env, &contract_id);
    client.initialize(&admin, &admin, &true, &false);
    // Compliance check with unverified users should fail (kyc_required = true)
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    assert!(!client.check_compliance(&user_a, &user_b, &100));
}

#[test]
#[should_panic]
fn initialize_twice_panics() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &admin, &true, &false);
}

// ── KYC status ───────────────────────────────────────────────────────────────

#[test]
fn update_and_get_kyc_status() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let kyc = verified_kyc(&env);
    client.update_kyc_status(&admin, &user, &kyc);
    let stored = client.get_kyc_status(&user);
    assert!(stored.is_verified);
    assert_eq!(stored.verification_level, 2);
}

#[test]
fn get_kyc_status_returns_default_for_unknown_user() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    let kyc = client.get_kyc_status(&user);
    assert!(!kyc.is_verified);
    assert_eq!(kyc.verification_level, 0);
}

#[test]
#[should_panic]
fn update_kyc_status_rejects_non_admin() {
    let (env, _, client) = setup();
    let attacker = Address::generate(&env);
    let user = Address::generate(&env);
    client.update_kyc_status(&attacker, &user, &verified_kyc(&env));
}

// ── blacklist ─────────────────────────────────────────────────────────────────

#[test]
fn blacklisted_address_fails_compliance() {
    let (env, admin, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    // Give both users valid KYC so the only failure is the blacklist
    client.update_kyc_status(&admin, &user_a, &verified_kyc(&env));
    client.update_kyc_status(&admin, &user_b, &verified_kyc(&env));

    // Passes before blacklisting
    assert!(client.check_compliance(&user_a, &user_b, &100));

    client.add_to_blacklist(&admin, &user_a, &Symbol::new(&env, "fraud"));
    assert!(!client.check_compliance(&user_a, &user_b, &100));
}

#[test]
fn remove_from_blacklist_restores_compliance() {
    let (env, admin, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    client.update_kyc_status(&admin, &user_a, &verified_kyc(&env));
    client.update_kyc_status(&admin, &user_b, &verified_kyc(&env));
    client.add_to_blacklist(&admin, &user_a, &Symbol::new(&env, "fraud"));
    assert!(!client.check_compliance(&user_a, &user_b, &100));

    client.remove_from_blacklist(&admin, &user_a);
    assert!(client.check_compliance(&user_a, &user_b, &100));
}

#[test]
#[should_panic]
fn add_to_blacklist_rejects_non_admin() {
    let (env, _, client) = setup();
    let attacker = Address::generate(&env);
    let victim = Address::generate(&env);
    client.add_to_blacklist(&attacker, &victim, &Symbol::new(&env, "test"));
}

// ── whitelist ─────────────────────────────────────────────────────────────────

#[test]
fn whitelisted_address_bypasses_kyc_check() {
    let (env, admin, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    // No KYC set — normally would fail
    assert!(!client.check_compliance(&user_a, &user_b, &100));

    client.add_to_whitelist(&admin, &user_a);
    client.add_to_whitelist(&admin, &user_b);

    // Both whitelisted — should pass
    assert!(client.check_compliance(&user_a, &user_b, &100));
}

#[test]
fn remove_from_whitelist_re_enforces_kyc() {
    let (env, admin, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    client.add_to_whitelist(&admin, &user_a);
    client.add_to_whitelist(&admin, &user_b);
    assert!(client.check_compliance(&user_a, &user_b, &100));

    client.remove_from_whitelist(&admin, &user_a);
    // user_a no longer whitelisted and has no KYC
    assert!(!client.check_compliance(&user_a, &user_b, &100));
}

// ── transfer limits ───────────────────────────────────────────────────────────

#[test]
fn transfer_within_daily_limit_passes() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    let limits = TransferLimits {
        daily_limit: 1000,
        monthly_limit: 10000,
        annual_limit: 100000,
        remaining_daily: 1000,
        remaining_monthly: 10000,
        remaining_annual: 100000,
        last_reset_daily: 0,
        last_reset_monthly: 0,
        last_reset_annual: 0,
    };
    client.set_transfer_limits(&admin, &user, &limits);
    assert!(client.check_transfer_limits(&user, &500));
}

#[test]
fn transfer_exceeding_daily_limit_fails() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    let limits = TransferLimits {
        daily_limit: 100,
        monthly_limit: 10000,
        annual_limit: 100000,
        remaining_daily: 100,
        remaining_monthly: 10000,
        remaining_annual: 100000,
        last_reset_daily: 0,
        last_reset_monthly: 0,
        last_reset_annual: 0,
    };
    client.set_transfer_limits(&admin, &user, &limits);
    assert!(!client.check_transfer_limits(&user, &500));
}

// ── compliance rules ──────────────────────────────────────────────────────────

#[test]
fn get_compliance_rules_returns_seeded_rules() {
    let (_, _, client) = setup();
    let rules = client.get_compliance_rules();
    // initialize() seeds 3 rules: rule_144, reg_d, reg_s
    assert_eq!(rules.len(), 3);
}

#[test]
fn update_compliance_rule_modifies_existing_rule() {
    let (env, admin, client) = setup();
    let rules = client.get_compliance_rules();
    let mut rule = rules.get(0).unwrap();
    rule.is_active = false;
    client.update_compliance_rule(&admin, &rule);
    let updated = client.get_compliance_rules();
    let first = updated.get(0).unwrap();
    assert!(!first.is_active);
}

// ── check_compliance integration ─────────────────────────────────────────────

#[test]
fn compliance_passes_for_two_verified_users() {
    let (env, admin, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    client.update_kyc_status(&admin, &user_a, &verified_kyc(&env));
    client.update_kyc_status(&admin, &user_b, &verified_kyc(&env));
    assert!(client.check_compliance(&user_a, &user_b, &100));
}

#[test]
fn compliance_fails_when_kyc_expired() {
    let (env, admin, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    let mut expired_kyc = verified_kyc(&env);
    expired_kyc.expiry_date = 0; // already expired

    client.update_kyc_status(&admin, &user_a, &expired_kyc);
    client.update_kyc_status(&admin, &user_b, &verified_kyc(&env));
    assert!(!client.check_compliance(&user_a, &user_b, &100));
}
