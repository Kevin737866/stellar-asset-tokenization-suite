use soroban_sdk::{contracterror, Address, Env, Symbol, panic_with_error};
use crate::auth::{assert_admin, AuthError};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AdminError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

pub fn write_admin(env: &Env, auth: &Address, admin: &Address) {
    auth.require_auth();
    let admin_key = Symbol::new(env, "admin");
    if env.storage().instance().has(&admin_key) {
        panic_with_error!(env, AuthError::AlreadyInitialized);
    }
    env.storage().instance().set(&admin_key, admin);
}

pub fn require_admin(env: &Env, auth: &Address) {
    let admin: Address = env.storage()
        .instance()
        .get(&Symbol::new(env, "admin"))
        .unwrap_or_else(|| panic_with_error!(env, AuthError::NotInitialized));
    assert_admin(env, auth, &admin);
}

/// Issue #187: non-panicking admin check. Returns `true` when `auth` is the
/// stored admin (and their auth requirement succeeds, which itself may panic
/// on an invalid signature), `false` when `auth` is not the admin or the
/// contract has not been initialized.
///
/// Use this when a call should branch on admin status; use `require_admin`
/// when an admin-only action must hard-fail with `AuthError::Unauthorized`.
pub fn check_admin(env: &Env, auth: &Address) -> bool {
    auth.require_auth();
    let admin: Option<Address> = env.storage().instance().get(&Symbol::new(env, "admin"));
    match admin {
        Some(stored) => stored == *auth,
        None => false,
    }
}
