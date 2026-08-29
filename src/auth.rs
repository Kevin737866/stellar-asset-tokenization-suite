use soroban_sdk::{contracterror, panic_with_error, Address, Env, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AuthError {
    Unauthorized = 1,
    NotInitialized = 2,
    AlreadyInitialized = 3,
}

#[inline(always)]
pub fn assert_admin(env: &Env, auth: &Address, admin: &Address) {
    auth.require_auth();
    if auth != admin {
        panic_with_error!(env, AuthError::Unauthorized);
    }
}

/// Assert that `auth` is one of the authorized parties. Used by the MFA
/// admin-authorization flow in `shared_admin`.
#[inline(always)]
pub fn assert_authorized(env: &Env, auth: &Address, authorized: &Vec<Address>) {
    auth.require_auth();
    if !authorized.contains(auth) {
        panic_with_error!(env, AuthError::Unauthorized);
    }
}
