use soroban_sdk::{Address, Env, panic_with_error, contracterror};

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
