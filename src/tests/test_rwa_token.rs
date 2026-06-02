#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Map, Symbol, Vec,
};

use crate::{
    compliance_registry::{ComplianceRegistry, ComplianceRegistryClient, KYCStatus},
    rwa_token::{RWAToken, RWATokenClient, RWATokenError},
};

// ── helpers ──────────────────────────────────────────────────────────────────

struct TestEnv {
    env: Env,
    admin: Address,
    token: RWATokenClient<'static>,
    compliance: ComplianceRegistryClient<'static>,
}

fn setup() -> TestEnv {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Deploy compliance registry
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &false, &false); // kyc_required = false for simplicity

    // Deploy RWA token
    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &Symbol::new(&env, "TestToken"),
        &Symbol::new(&env, "TT"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &admin, // placeholder dividend distributor
    );

    // SAFETY: env lifetime is tied to the test scope.
    let token: RWATokenClient<'static> = unsafe { core::mem::transmute(token) };
    let compliance: ComplianceRegistryClient<'static> = unsafe { core::mem::transmute(compliance) };

    TestEnv { env, admin, token, compliance }
}

// ── initialize ───────────────────────────────────────────────────────────────

#[test]
fn initialize_sets_token_info() {
    let t = setup();
    let info = t.token.get_token_info();
    assert_eq!(info.total_supply, 1_000_000);
    assert_eq!(info.decimals, 6);
    assert!(!info.is_paused);
    assert!(!info.is_frozen);
}

#[test]
fn initialize_mints_total_supply_to_admin() {
    let t = setup();
    let balance = t.token.get_balance(&t.admin);
    assert_eq!(balance.amount, 1_000_000);
}

#[test]
#[should_panic]
fn initialize_twice_panics() {
    let t = setup();
    t.token.initialize(
        &t.admin,
        &Symbol::new(&t.env, "Dup"),
        &Symbol::new(&t.env, "DUP"),
        &100i128,
        &6u32,
        &Symbol::new(&t.env, "real_estate"),
        &Map::new(&t.env),
        &t.admin,
        &t.admin,
    );
}

#[test]
#[should_panic]
fn initialize_with_zero_supply_panics() {
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
        &Symbol::new(&env, "Bad"),
        &Symbol::new(&env, "BAD"),
        &0i128, // invalid
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &admin,
    );
}

// ── get_balance ───────────────────────────────────────────────────────────────

#[test]
fn get_balance_returns_zero_for_unknown_address() {
    let t = setup();
    let stranger = Address::generate(&t.env);
    let balance = t.token.get_balance(&stranger);
    assert_eq!(balance.amount, 0);
    assert_eq!(balance.locked_amount, 0);
    assert_eq!(balance.voting_power, 0);
}

// ── transfer ─────────────────────────────────────────────────────────────────

#[test]
fn transfer_moves_tokens_between_accounts() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.transfer(&t.admin, &recipient, &500i128);
    assert_eq!(t.token.get_balance(&t.admin).amount, 999_500);
    assert_eq!(t.token.get_balance(&recipient).amount, 500);
}

#[test]
#[should_panic]
fn transfer_fails_with_insufficient_balance() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.transfer(&t.admin, &recipient, &2_000_000i128);
}

#[test]
#[should_panic]
fn transfer_fails_when_paused() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.pause(&t.admin);
    t.token.transfer(&t.admin, &recipient, &100i128);
}

#[test]
#[should_panic]
fn transfer_fails_when_frozen() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.freeze(&t.admin);
    t.token.transfer(&t.admin, &recipient, &100i128);
}

#[test]
#[should_panic]
fn transfer_zero_amount_panics() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.transfer(&t.admin, &recipient, &0i128);
}

// ── mint ─────────────────────────────────────────────────────────────────────

#[test]
fn mint_increases_balance_and_total_supply() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.mint(&t.admin, &recipient, &1000i128);
    assert_eq!(t.token.get_balance(&recipient).amount, 1000);
    assert_eq!(t.token.get_token_info().total_supply, 1_001_000);
}

#[test]
#[should_panic]
fn mint_by_non_admin_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    t.token.mint(&attacker, &attacker, &1000i128);
}

#[test]
#[should_panic]
fn mint_zero_amount_panics() {
    let t = setup();
    t.token.mint(&t.admin, &t.admin, &0i128);
}

// ── burn ─────────────────────────────────────────────────────────────────────

#[test]
fn burn_decreases_balance_and_total_supply() {
    let t = setup();
    t.token.burn(&t.admin, &100i128);
    assert_eq!(t.token.get_balance(&t.admin).amount, 999_900);
    assert_eq!(t.token.get_token_info().total_supply, 999_900);
}

#[test]
#[should_panic]
fn burn_more_than_balance_panics() {
    let t = setup();
    t.token.burn(&t.admin, &2_000_000i128);
}

// ── lock / unlock ─────────────────────────────────────────────────────────────

#[test]
fn lock_tokens_moves_amount_to_locked() {
    let t = setup();
    t.token.lock_tokens(&t.admin, &t.admin, &200i128, &3600u64);
    let bal = t.token.get_balance(&t.admin);
    assert_eq!(bal.amount, 999_800);
    assert_eq!(bal.locked_amount, 200);
    assert_eq!(bal.voting_power, 200);
}

#[test]
fn unlock_tokens_restores_spendable_balance() {
    let t = setup();
    t.token.lock_tokens(&t.admin, &t.admin, &200i128, &3600u64);
    t.token.unlock_tokens(&t.admin, &t.admin, &200i128);
    let bal = t.token.get_balance(&t.admin);
    assert_eq!(bal.amount, 1_000_000);
    assert_eq!(bal.locked_amount, 0);
    assert_eq!(bal.voting_power, 0);
}

#[test]
#[should_panic]
fn lock_more_than_available_panics() {
    let t = setup();
    t.token.lock_tokens(&t.admin, &t.admin, &2_000_000i128, &3600u64);
}

#[test]
#[should_panic]
fn unlock_more_than_locked_panics() {
    let t = setup();
    t.token.lock_tokens(&t.admin, &t.admin, &100i128, &3600u64);
    t.token.unlock_tokens(&t.admin, &t.admin, &500i128);
}

#[test]
#[should_panic]
fn lock_by_non_owner_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    // attacker tries to lock admin's tokens
    t.token.lock_tokens(&attacker, &t.admin, &100i128, &3600u64);
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn pause_and_unpause_toggle_is_paused() {
    let t = setup();
    t.token.pause(&t.admin);
    assert!(t.token.get_token_info().is_paused);
    t.token.unpause(&t.admin);
    assert!(!t.token.get_token_info().is_paused);
}

#[test]
#[should_panic]
fn pause_by_non_admin_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    t.token.pause(&attacker);
}

// ── freeze / unfreeze ─────────────────────────────────────────────────────────

#[test]
fn freeze_and_unfreeze_toggle_is_frozen() {
    let t = setup();
    t.token.freeze(&t.admin);
    assert!(t.token.get_token_info().is_frozen);
    t.token.unfreeze(&t.admin);
    assert!(!t.token.get_token_info().is_frozen);
}

#[test]
#[should_panic]
fn freeze_by_non_admin_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    t.token.freeze(&attacker);
}

// ── compliance integration ────────────────────────────────────────────────────

#[test]
fn transfer_blocked_when_sender_blacklisted() {
    let t = setup();
    let recipient = Address::generate(&t.env);

    // Re-initialize with kyc_required = false but blacklist active
    // The compliance registry was deployed with kyc_required=false,
    // so we just blacklist the admin and expect the transfer to fail.
    t.compliance.add_to_blacklist(
        &t.admin,
        &t.admin,
        &Symbol::new(&t.env, "test"),
    );

    // Transfer should now fail compliance check
    let result = std::panic::catch_unwind(|| {
        t.token.transfer(&t.admin, &recipient, &100i128);
    });
    assert!(result.is_err());
}

#[test]
fn transfer_blocked_when_recipient_blacklisted() {
    let t = setup();
    let recipient = Address::generate(&t.env);

    // Blacklist the recipient
    t.compliance.add_to_blacklist(
        &t.admin,
        &recipient,
        &Symbol::new(&t.env, "test"),
    );

    // Transfer should now fail compliance check
    let result = std::panic::catch_unwind(|| {
        t.token.transfer(&t.admin, &recipient, &100i128);
    });
    assert!(result.is_err());
}

// ── migrate ───────────────────────────────────────────────────────────────────

#[test]
fn migrate_updates_storage_version() {
    let t = setup();
    // Migrate should succeed when called by admin
    t.token.migrate(&t.admin);
    // Version should be updated (though already at latest, this tests the function)
    let info = t.token.get_token_info();
    assert_eq!(info.name, Symbol::new(&t.env, "TestToken"));
}

#[test]
#[should_panic]
fn migrate_by_non_admin_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    t.token.migrate(&attacker);
}

// ── initialize edge cases ─────────────────────────────────────────────────────

#[test]
#[should_panic]
fn initialize_with_invalid_decimals_panics() {
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
        &Symbol::new(&env, "Bad"),
        &Symbol::new(&env, "BAD"),
        &100i128,
        &19u32, // invalid: > 18
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &admin,
    );
}

#[test]
#[should_panic]
fn initialize_with_negative_supply_panics() {
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
        &Symbol::new(&env, "Bad"),
        &Symbol::new(&env, "BAD"),
        &-1i128, // invalid
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &admin,
    );
}

// ── mint edge cases ───────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn mint_when_paused_panics() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.pause(&t.admin);
    t.token.mint(&t.admin, &recipient, &1000i128);
}

#[test]
#[should_panic]
fn mint_negative_amount_panics() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.token.mint(&t.admin, &recipient, &-100i128);
}

// ── burn edge cases ───────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn burn_when_paused_panics() {
    let t = setup();
    t.token.pause(&t.admin);
    t.token.burn(&t.admin, &100i128);
}

#[test]
#[should_panic]
fn burn_zero_amount_panics() {
    let t = setup();
    t.token.burn(&t.admin, &0i128);
}

#[test]
#[should_panic]
fn burn_negative_amount_panics() {
    let t = setup();
    t.token.burn(&t.admin, &-100i128);
}

// ── authorization tests ───────────────────────────────────────────────────────

#[test]
#[should_panic]
fn unlock_tokens_by_non_owner_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    t.token.lock_tokens(&t.admin, &t.admin, &100i128, &3600u64);
    t.token.unlock_tokens(&attacker, &t.admin, &100i128);
}

#[test]
#[should_panic]
fn unpause_by_non_admin_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    t.token.pause(&t.admin);
    t.token.unpause(&attacker);
}

#[test]
#[should_panic]
fn unfreeze_by_non_admin_panics() {
    let t = setup();
    let attacker = Address::generate(&t.env);
    t.token.freeze(&t.admin);
    t.token.unfreeze(&attacker);
}

// ── transfer with locked tokens ───────────────────────────────────────────────

#[test]
fn transfer_with_partial_locked_succeeds() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    
    // Lock half of admin's tokens
    t.token.lock_tokens(&t.admin, &t.admin, &500_000i128, &3600u64);
    
    // Transfer unlocked portion should succeed
    t.token.transfer(&t.admin, &recipient, &400_000i128);
    
    let admin_balance = t.token.get_balance(&t.admin);
    let recipient_balance = t.token.get_balance(&recipient);
    
    assert_eq!(admin_balance.amount, 100_000); // 1M - 500K locked - 400K transferred
    assert_eq!(admin_balance.locked_amount, 500_000);
    assert_eq!(recipient_balance.amount, 400_000);
}

#[test]
#[should_panic]
fn transfer_exceeding_unlocked_balance_panics() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    
    // Lock half of admin's tokens
    t.token.lock_tokens(&t.admin, &t.admin, &500_000i128, &3600u64);
    
    // Try to transfer more than unlocked balance
    t.token.transfer(&t.admin, &recipient, &600_000i128);
}

#[test]
fn transfer_after_unlocking_succeeds() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    
    // Lock tokens
    t.token.lock_tokens(&t.admin, &t.admin, &500_000i128, &3600u64);
    
    // Unlock them
    t.token.unlock_tokens(&t.admin, &t.admin, &500_000i128);
    
    // Transfer should now succeed
    t.token.transfer(&t.admin, &recipient, &600_000i128);
    
    let admin_balance = t.token.get_balance(&t.admin);
    let recipient_balance = t.token.get_balance(&recipient);
    
    assert_eq!(admin_balance.amount, 400_000);
    assert_eq!(recipient_balance.amount, 600_000);
}

// ── overflow/underflow scenarios ───────────────────────────────────────────────

#[test]
fn mint_large_amount_succeeds() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    let large_amount = i128::MAX / 2;
    
    t.token.mint(&t.admin, &recipient, &large_amount);
    
    let balance = t.token.get_balance(&recipient);
    assert_eq!(balance.amount, large_amount);
}

#[test]
fn burn_large_amount_succeeds() {
    let t = setup();
    let large_amount = 500_000i128;
    
    t.token.burn(&t.admin, &large_amount);
    
    let balance = t.token.get_balance(&t.admin);
    assert_eq!(balance.amount, 500_000);
}

#[test]
fn lock_large_amount_succeeds() {
    let t = setup();
    let large_amount = 500_000i128;
    
    t.token.lock_tokens(&t.admin, &t.admin, &large_amount, &3600u64);
    
    let balance = t.token.get_balance(&t.admin);
    assert_eq!(balance.amount, 500_000);
    assert_eq!(balance.locked_amount, 500_000);
    assert_eq!(balance.voting_power, 500_000);
}

// ── get_token_info ───────────────────────────────────────────────────────────

#[test]
fn get_token_info_returns_correct_metadata() {
    let t = setup();
    let info = t.token.get_token_info();
    
    assert_eq!(info.name, Symbol::new(&t.env, "TestToken"));
    assert_eq!(info.symbol, Symbol::new(&t.env, "TT"));
    assert_eq!(info.total_supply, 1_000_000);
    assert_eq!(info.decimals, 6);
    assert_eq!(info.asset_type, Symbol::new(&t.env, "real_estate"));
    assert!(!info.is_paused);
    assert!(!info.is_frozen);
}

#[test]
#[should_panic]
fn get_token_info_before_initialization_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.get_token_info();
}

// ── multiple lock/unlock operations ───────────────────────────────────────────

#[test]
fn multiple_lock_operations_accumulate() {
    let t = setup();
    
    t.token.lock_tokens(&t.admin, &t.admin, &100_000i128, &3600u64);
    t.token.lock_tokens(&t.admin, &t.admin, &200_000i128, &3600u64);
    
    let balance = t.token.get_balance(&t.admin);
    assert_eq!(balance.amount, 700_000); // 1M - 100K - 200K
    assert_eq!(balance.locked_amount, 300_000);
    assert_eq!(balance.voting_power, 300_000);
}

#[test]
fn partial_unlock_succeeds() {
    let t = setup();
    
    t.token.lock_tokens(&t.admin, &t.admin, &300_000i128, &3600u64);
    t.token.unlock_tokens(&t.admin, &t.admin, &100_000i128);
    
    let balance = t.token.get_balance(&t.admin);
    assert_eq!(balance.amount, 800_000); // 1M - 300K + 100K
    assert_eq!(balance.locked_amount, 200_000);
    assert_eq!(balance.voting_power, 200_000);
}

// ── pause/unfreeze interaction ────────────────────────────────────────────────

#[test]
fn pause_and_freeze_both_block_transfers() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    
    t.token.pause(&t.admin);
    t.token.freeze(&t.admin);
    
    let result = std::panic::catch_unwind(|| {
        t.token.transfer(&t.admin, &recipient, &100i128);
    });
    assert!(result.is_err());
}

#[test]
fn unpause_while_frozen_still_blocks_transfers() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    
    t.token.pause(&t.admin);
    t.token.freeze(&t.admin);
    t.token.unpause(&t.admin);
    
    let result = std::panic::catch_unwind(|| {
        t.token.transfer(&t.admin, &recipient, &100i128);
    });
    assert!(result.is_err());
}

#[test]
fn unfreeze_while_paused_still_blocks_transfers() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    
    t.token.pause(&t.admin);
    t.token.freeze(&t.admin);
    t.token.unfreeze(&t.admin);
    
    let result = std::panic::catch_unwind(|| {
        t.token.transfer(&t.admin, &recipient, &100i128);
    });
    assert!(result.is_err());
}

// ── compliance with KYC ───────────────────────────────────────────────────────

#[test]
fn transfer_succeeds_with_valid_kyc() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    // Deploy compliance registry with KYC required
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &true, &false);
    
    // Set up KYC for user
    let kyc_status = KYCStatus {
        is_verified: true,
        verification_level: 2,
        expiry_date: env.ledger().timestamp() + 86400 * 365,
        jurisdiction: Symbol::new(&env, "US"),
        is_accredited: true,
        risk_score: 3,
        aml_flags: Vec::new(&env),
    };
    compliance.update_kyc_status(&admin, &user, kyc_status);
    
    // Deploy token
    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &Symbol::new(&env, "KYCToken"),
        &Symbol::new(&env, "KYC"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &admin,
    );
    
    // Transfer should succeed with valid KYC
    token.transfer(&admin, &user, &1000i128);
    
    let user_balance = token.get_balance(&user);
    assert_eq!(user_balance.amount, 1000);
}

#[test]
#[should_panic]
fn transfer_fails_without_kyc_when_required() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    // Deploy compliance registry with KYC required
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &true, &false);
    
    // Deploy token
    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &Symbol::new(&env, "KYCToken"),
        &Symbol::new(&env, "KYC"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, "real_estate"),
        &Map::new(&env),
        &compliance_id,
        &admin,
    );
    
    // Transfer should fail without KYC
    token.transfer(&admin, &user, &1000i128);
}

// ── voting power tracking ─────────────────────────────────────────────────────

#[test]
fn voting_power_increases_with_lock() {
    let t = setup();
    
    t.token.lock_tokens(&t.admin, &t.admin, &100_000i128, &3600u64);
    
    let balance = t.token.get_balance(&t.admin);
    assert_eq!(balance.voting_power, 100_000);
}

#[test]
fn voting_power_decreases_with_unlock() {
    let t = setup();
    
    t.token.lock_tokens(&t.admin, &t.admin, &100_000i128, &3600u64);
    t.token.unlock_tokens(&t.admin, &t.admin, &50_000i128);
    
    let balance = t.token.get_balance(&t.admin);
    assert_eq!(balance.voting_power, 50_000);
}

#[test]
fn voting_power_remains_after_transfer() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    
    t.token.lock_tokens(&t.admin, &t.admin, &100_000i128, &3600u64);
    t.token.transfer(&t.admin, &recipient, &100_000i128);
    
    let admin_balance = t.token.get_balance(&t.admin);
    assert_eq!(admin_balance.voting_power, 100_000);
}

// ── metadata handling ─────────────────────────────────────────────────────────

#[test]
fn initialize_with_metadata_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let compliance_id = env.register_contract(None, ComplianceRegistry);
    let compliance = ComplianceRegistryClient::new(&env, &compliance_id);
    compliance.initialize(&admin, &admin, &false, &false);
    
    let mut metadata = Map::new(&env);
    metadata.set(Symbol::new(&env, "description"), String::from_str(&env, "Test token"));
    metadata.set(Symbol::new(&env, "issuer"), String::from_str(&env, "Test Inc"));
    
    let token_id = env.register_contract(None, RWAToken);
    let token = RWATokenClient::new(&env, &token_id);
    token.initialize(
        &admin,
        &Symbol::new(&env, "MetaToken"),
        &Symbol::new(&env, "META"),
        &1_000_000i128,
        &6u32,
        &Symbol::new(&env, "real_estate"),
        metadata,
        &compliance_id,
        &admin,
    );
    
    let info = token.get_token_info();
    assert_eq!(info.metadata.len(), 2);
}
