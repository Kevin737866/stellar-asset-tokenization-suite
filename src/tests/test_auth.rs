#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::auth::{assert_admin, AuthError};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    (env, admin, other)
}

// ── assert_admin ─────────────────────────────────────────────────────────────

#[test]
fn assert_admin_passes_when_caller_is_admin() {
    let (env, admin, _) = setup();
    // Should not panic
    assert_admin(&env, &admin, &admin);
}

#[test]
#[should_panic]
fn assert_admin_panics_when_caller_is_not_admin() {
    let (env, admin, other) = setup();
    assert_admin(&env, &other, &admin);
}
