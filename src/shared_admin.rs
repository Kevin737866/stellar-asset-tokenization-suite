use soroban_sdk::{contracterror, contracttype, Address, Env, Symbol, Vec, panic_with_error};
use crate::auth::{assert_admin, AuthError};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AdminError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

/// Errors for the multi-factor admin authorization (MFA) action flow.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum MfaError {
    Unauthorized = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    DuplicateAction = 4,
    ActionNotFound = 5,
    AlreadyApproved = 6,
    AlreadyExecuted = 7,
    InsufficientApprovals = 8,
    TimelockNotExpired = 9,
    InvalidApprovalCount = 10,
}

/// A time-locked, multi-signature (MFA) admin action.
///
/// Security model:
/// - Only registered authorized parties can initiate / approve / execute.
/// - `required_approvals` distinct approvals (configurable 2-5) are needed
///   before an action becomes eligible for execution.
/// - The action cannot be executed before `executable_after` (a configured
///   timelock applied at initiation).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MfaAction {
    pub action_type: Symbol,
    pub initiator: Address,
    pub required_approvals: u32,
    pub approved_by: Vec<Address>,
    pub executable_after: u64,
    pub executed: bool,
}

const KEY_REQUIRED_APPROVALS: &str = "mfa_required_approvals";
const KEY_TIMELOCK_SECONDS: &str = "mfa_timelock_seconds";
const KEY_AUTHORIZED: &str = "mfa_authorized";
const KEY_ACTIONS: &str = "mfa_actions";

// ── admin primitives ──────────────────────────────────────────────────────────

pub fn write_admin(env: &Env, auth: &Address, admin: &Address) {
    auth.require_auth();
    let admin_key = Symbol::new(env, "admin");
    if env.storage().instance().has(&admin_key) {
        panic_with_error!(env, AuthError::AlreadyInitialized);
    }
    env.storage().instance().set(&admin_key, admin);
}

pub fn require_admin(env: &Env, auth: &Address) {
    let admin: Address = env
        .storage()
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
