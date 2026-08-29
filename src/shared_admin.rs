use crate::auth::{assert_admin, assert_authorized, AuthError};
use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, Env, Map, Symbol, Vec};

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

pub fn is_admin(env: &Env, addr: &Address) -> bool {
    let admin: Option<Address> = env.storage().instance().get(&Symbol::new(env, "admin"));
    match admin {
        Some(admin) => *addr == admin,
        None => false,
    }
}

// ── MFA configuration ─────────────────────────────────────────────────────────

/// Configure the multi-factor admin authorization params.
///
/// `required_approvals` must be between 2 and 5 (inclusive).
/// `authorized` is the set of addresses allowed to initiate/approve/execute.
pub fn init_mfa(
    env: &Env,
    auth: &Address,
    required_approvals: u32,
    timelock_seconds: u64,
    authorized: &Vec<Address>,
) {
    auth.require_auth();

    if !(2..=5).contains(&required_approvals) {
        panic_with_error!(env, MfaError::InvalidApprovalCount);
    }

    let init_key = Symbol::new(env, "mfa_initialized");
    if env.storage().instance().has(&init_key) {
        panic_with_error!(env, MfaError::AlreadyInitialized);
    }

    env.storage().instance().set(
        &Symbol::new(env, KEY_REQUIRED_APPROVALS),
        &required_approvals,
    );
    env.storage()
        .instance()
        .set(&Symbol::new(env, KEY_TIMELOCK_SECONDS), &timelock_seconds);
    env.storage()
        .instance()
        .set(&Symbol::new(env, KEY_AUTHORIZED), authorized);
    env.storage().instance().set(&init_key, &true);
}

fn read_required_approvals(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, KEY_REQUIRED_APPROVALS))
        .unwrap_or_else(|| panic_with_error!(env, MfaError::NotInitialized))
}

fn read_timelock_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, KEY_TIMELOCK_SECONDS))
        .unwrap_or(0u64)
}

fn read_authorized(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, KEY_AUTHORIZED))
        .unwrap_or_else(|| panic_with_error!(env, MfaError::NotInitialized))
}

fn read_actions(env: &Env) -> Map<Symbol, MfaAction> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, KEY_ACTIONS))
        .unwrap_or(Map::new(env))
}

// ── MFA action lifecycle ──────────────────────────────────────────────────────

/// Begin a time-locked admin action. Only an authorized party may initiate.
pub fn initiate_mfa_action(env: &Env, auth: &Address, action_type: Symbol) {
    let authorized = read_authorized(env);
    assert_authorized(env, auth, &authorized);

    let mut actions = read_actions(env);
    if actions.contains_key(action_type.clone()) {
        panic_with_error!(env, MfaError::DuplicateAction);
    }

    let required = read_required_approvals(env);
    let timelock = read_timelock_seconds(env);
    let now = env.ledger().timestamp();

    let action = MfaAction {
        action_type: action_type.clone(),
        initiator: auth.clone(),
        required_approvals: required,
        approved_by: Vec::new(env),
        executable_after: now + timelock,
        executed: false,
    };

    actions.set(action_type, action);
    env.storage()
        .instance()
        .set(&Symbol::new(env, KEY_ACTIONS), &actions);
}

/// Record one distinct approval for an action. Only authorized parties may approve.
pub fn approve_mfa_action(env: &Env, approver: &Address, action_type: Symbol) {
    let authorized = read_authorized(env);
    assert_authorized(env, approver, &authorized);

    let mut actions = read_actions(env);
    let mut action = actions
        .get(action_type.clone())
        .unwrap_or_else(|| panic_with_error!(env, MfaError::ActionNotFound));

    if action.executed {
        panic_with_error!(env, MfaError::AlreadyExecuted);
    }

    if action.approved_by.contains(approver) {
        panic_with_error!(env, MfaError::AlreadyApproved);
    }

    action.approved_by.push_back(approver.clone());
    actions.set(action_type, action);
    env.storage()
        .instance()
        .set(&Symbol::new(env, KEY_ACTIONS), &actions);
}

/// Execute a fully-approved action after the timelock has elapsed.
/// Only an authorized party that has already approved (or initiated) may execute.
pub fn execute_mfa_action(env: &Env, executor: &Address, action_type: Symbol) {
    let authorized = read_authorized(env);
    assert_authorized(env, executor, &authorized);

    let mut actions = read_actions(env);
    let mut action = actions
        .get(action_type.clone())
        .unwrap_or_else(|| panic_with_error!(env, MfaError::ActionNotFound));

    let executed_by_approver =
        action.initiator == *executor || action.approved_by.contains(executor);
    if !executed_by_approver {
        panic_with_error!(env, MfaError::Unauthorized);
    }

    let now = env.ledger().timestamp();
    if now < action.executable_after {
        panic_with_error!(env, MfaError::TimelockNotExpired);
    }

    if action.approved_by.len() < action.required_approvals {
        panic_with_error!(env, MfaError::InsufficientApprovals);
    }

    if action.executed {
        panic_with_error!(env, MfaError::AlreadyExecuted);
    }

    action.executed = true;
    actions.set(action_type, action);
    env.storage()
        .instance()
        .set(&Symbol::new(env, KEY_ACTIONS), &actions);
}

/// Read-only view of an action (used by tests / integrators).
pub fn get_mfa_action(env: &Env, action_type: Symbol) -> Option<MfaAction> {
    read_actions(env).get(action_type)
}
