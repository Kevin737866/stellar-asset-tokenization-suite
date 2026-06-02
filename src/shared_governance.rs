use crate::auth::AuthError;
use soroban_sdk::{panic_with_error, Address, Env, Symbol};

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum GovernanceError {
    NotInitialized = 1,
    Unauthorized = 2,
    AlreadyVoted = 3,
    ProposalNotFound = 4,
    ThresholdNotMet = 5,
    TimelockNotExpired = 6,
    AlreadyExecuted = 7,
    InvalidProposalPayload = 8,
}

/// Minimal threshold-based governance.
///
/// Security model:
/// - Owners set at initialization
/// - Any governance action is represented by a `proposal_key` (Symbol)
/// - Owners create a proposal (or any one can create; approvals still required)
/// - Approvers call `approve(proposal_id)`
/// - Once `threshold` unique approvals are collected, the action can be executed
///
/// NOTE: This is intentionally generic and uses a `proposal_payload_hash` to bind params.
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub proposal_key: Symbol,
    pub payload_hash: [u8; 32],
    pub created_at: u64,
    pub executable_after: u64,
    pub approvals: soroban_sdk::Vec<Address>,
    pub executed: bool,
}

pub fn write_governance(
    env: &Env,
    auth: &Address,
    owners: &soroban_sdk::Vec<Address>,
    threshold: u32,
    timelock_seconds: u64,
) {
    auth.require_auth();

    // one-time init
    let init_key = Symbol::new(env, "gov_initialized");
    if env.storage().instance().has(&init_key) {
        panic_with_error!(env, AuthError::AlreadyInitialized);
    }

    let owners_key = Symbol::new(env, "gov_owners");
    let threshold_key = Symbol::new(env, "gov_threshold");
    let timelock_key = Symbol::new(env, "gov_timelock_seconds");

    env.storage().instance().set(&owners_key, owners);
    env.storage().instance().set(&threshold_key, &threshold);
    env.storage()
        .instance()
        .set(&timelock_key, &timelock_seconds);
    env.storage().instance().set(&init_key, &true);

    // proposal id counter
    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_proposal_count"), &0u64);
}

fn read_owners(env: &Env) -> soroban_sdk::Vec<Address> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_owners"))
        .unwrap_or_else(|| panic_with_error!(env, AuthError::NotInitialized))
}

fn read_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_threshold"))
        .unwrap_or_else(|| panic_with_error!(env, AuthError::NotInitialized))
}

fn read_timelock_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_timelock_seconds"))
        .unwrap_or(0u64)
}

fn is_owner(env: &Env, addr: &Address) -> bool {
    let owners = read_owners(env);
    owners.iter().any(|o| o.clone() == *addr)
}

pub fn create_proposal(
    env: Env,
    proposer: Address,
    proposal_key: Symbol,
    payload_hash: [u8; 32],
) -> u64 {
    proposer.require_auth();

    if !is_owner(&env, &proposer) {
        panic_with_error!(&env, GovernanceError::Unauthorized);
    }

    let proposal_count: u64 = env
        .storage()
        .instance()
        .get(&Symbol::new(&env, "gov_proposal_count"))
        .unwrap_or(0u64);

    let timelock = read_timelock_seconds(&env);
    let now = env.ledger().timestamp();

    let proposal = Proposal {
        id: proposal_count + 1,
        proposal_key,
        payload_hash,
        created_at: now,
        executable_after: now + timelock,
        approvals: soroban_sdk::Vec::<Address>::new(&env),
        executed: false,
    };

    let proposals_key = Symbol::new(&env, "gov_proposals");
    let mut proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(&env));

    let id = proposal.id;
    proposals.set(id, proposal);
    env.storage().instance().set(&proposals_key, &proposals);

    env.storage()
        .instance()
        .set(&Symbol::new(&env, "gov_proposal_count"), &(id));

    id
}

pub fn approve(env: Env, approver: Address, proposal_id: u64) {
    approver.require_auth();

    if !is_owner(&env, &approver) {
        panic_with_error!(&env, GovernanceError::Unauthorized);
    }

    let proposals_key = Symbol::new(&env, "gov_proposals");
    let mut proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(&env));

    let mut proposal = proposals
        .get(proposal_id)
        .unwrap_or_else(|| panic_with_error!(&env, GovernanceError::ProposalNotFound));

    if proposal.executed {
        panic_with_error!(&env, GovernanceError::AlreadyExecuted);
    }

    if proposal.approvals.iter().any(|a| a.clone() == approver) {
        panic_with_error!(&env, GovernanceError::AlreadyVoted);
    }

    proposal.approvals.push_back(approver);
    proposals.set(proposal_id, proposal);
    env.storage().instance().set(&proposals_key, &proposals);
}

pub fn can_execute(
    env: &Env,
    proposal_id: u64,
    proposal_key: Symbol,
    payload_hash: [u8; 32],
) -> bool {
    let proposals_key = Symbol::new(env, "gov_proposals");
    let proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(env));

    let proposal = proposals.get(proposal_id);
    if proposal.is_none() {
        return false;
    }
    let proposal = proposal.unwrap();

    if proposal.executed {
        return false;
    }
    if proposal.proposal_key != proposal_key {
        return false;
    }
    if proposal.payload_hash != payload_hash {
        return false;
    }

    let now = env.ledger().timestamp();
    if now < proposal.executable_after {
        return false;
    }

    let threshold = read_threshold(env);
    (proposal.approvals.len() as u32) >= threshold
}

pub fn execute_mark(env: Env, executor: Address, proposal_id: u64) {
    executor.require_auth();
    if !is_owner(&env, &executor) {
        panic_with_error!(&env, GovernanceError::Unauthorized);
    }

    let proposals_key = Symbol::new(&env, "gov_proposals");
    let mut proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(&env));

    let mut proposal = proposals
        .get(proposal_id)
        .unwrap_or_else(|| panic_with_error!(&env, GovernanceError::ProposalNotFound));

    if proposal.executed {
        panic_with_error!(&env, GovernanceError::AlreadyExecuted);
    }

    proposal.executed = true;
    proposals.set(proposal_id, proposal);
    env.storage().instance().set(&proposals_key, &proposals);
}
