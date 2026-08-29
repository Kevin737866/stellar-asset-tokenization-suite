use crate::auth::AuthError;
use soroban_sdk::{
    contracterror, contracttype, panic_with_error, Address, Bytes, Env, Symbol, Vec,
};

#[contracterror]
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
    QuorumNotMet = 9,
    ProposalExpired = 10,
}

/// The kind of a governance proposal. Emergency proposals bypass the normal
/// quorum requirement but apply a much higher approval threshold and an
/// explicit review window.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ProposalType {
    Normal = 0,
    Emergency = 1,
}

/// Quorum configuration expressed in basis points as a percentage of total
/// voting power (`min_participation_bps`). The default of 2000 equals 20%.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QuorumConfig {
    pub min_participation_bps: u32,
}

/// Output of `simulate_proposal`, a read-only dry-run of a proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalSimulationResult {
    pub affected_contracts: Vec<Symbol>,
    pub state_changes: u32,
    pub estimated_gas: u64,
    pub requires_migration: bool,
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
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposal_key: Symbol,
    pub payload_hash: Bytes,
    pub created_at: u64,
    pub review_until: u64,
    pub executable_after: u64,
    pub approvals: Vec<Address>,
    pub executed: bool,
    pub proposal_type: ProposalType,
}

pub fn get_category_review_period(env: &Env, category: &Symbol) -> u64 {
    if *category == Symbol::new(env, "ContractUpgrade") {
        1_209_600 // 14 days
    } else if *category == Symbol::new(env, "TreasuryManagement") {
        604_800 // 7 days
    } else if *category == Symbol::new(env, "AssetManagement") {
        259_200 // 72 hours
    } else if *category == Symbol::new(env, "ParameterChange") {
        86_400 // 24 hours
    } else if *category == Symbol::new(env, "EmergencyAction") {
        86_400 // 24 hours
    } else {
        86_400 // Default 24 hours
    }
}

pub fn write_governance(
    env: &Env,
    auth: &Address,
    owners: &Vec<Address>,
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

    // default quorum (20%) for normal proposals
    let default_quorum = QuorumConfig {
        min_participation_bps: 2000,
    };
    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_quorum_config"), &default_quorum);

    // proposal id counter
    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_proposal_count"), &0u64);
}

fn read_owners(env: &Env) -> Vec<Address> {
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

fn read_quorum_config(env: &Env) -> QuorumConfig {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_quorum_config"))
        .unwrap_or(QuorumConfig {
            min_participation_bps: 2000,
        })
}

fn is_owner(env: &Env, addr: &Address) -> bool {
    let owners = read_owners(env);
    owners.iter().any(|o| o.clone() == *addr)
}

/// Total voting power for quorum purposes. Each owner carries a single vote.
fn total_voting_power(env: &Env) -> u32 {
    read_owners(env).len()
}

/// Quorum as basis points: (votes_cast / total_voting_power) * 10000.
fn quorum_bps(env: &Env, votes_cast: u32) -> u32 {
    let total = total_voting_power(env);
    votes_cast
        .checked_mul(10_000)
        .unwrap_or(0)
        .checked_div(total)
        .unwrap_or(0)
}

// ── configuration ─────────────────────────────────────────────────────────────

/// Configure the quorum (min participation) for normal proposals, in basis
/// points. Only callable by authorized governance actors (the stored admin).
pub fn set_normal_quorum(env: &Env, caller: &Address, min_participation_bps: u32) {
    caller.require_auth();
    if !is_owner(env, caller) {
        panic_with_error!(env, GovernanceError::Unauthorized);
    }
    if min_participation_bps > 10_000 {
        panic_with_error!(env, GovernanceError::InvalidProposalPayload);
    }
    let config = QuorumConfig {
        min_participation_bps,
    };
    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_quorum_config"), &config);
}

pub fn read_quorum_config_pub(env: &Env) -> QuorumConfig {
    read_quorum_config(env)
}

pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<Proposal> {
    let proposals_key = Symbol::new(env, "gov_proposals");
    let proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(env));
    proposals.get(proposal_id)
}

// ── proposal lifecycle ────────────────────────────────────────────────────────

pub fn create_proposal(
    env: Env,
    proposer: Address,
    proposal_key: Symbol,
    payload_hash: Bytes,
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
    let review_period = get_category_review_period(&env, &category);
    let review_until = now + review_period;
    let executable_after = review_until + timelock;

    let proposal = Proposal {
        id: proposal_count + 1,
        proposal_key,
        category,
        payload_hash,
        created_at: now,
        executable_after: now + timelock,
        approvals: Vec::<Address>::new(&env),
        executed: false,
        proposal_type: ProposalType::Normal,
    };

    let proposals_key = Symbol::new(&env, "gov_proposals");
    let mut proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(&env));

    let id = proposal.id;
    proposals.set(id, proposal.clone());
    env.storage().instance().set(&proposals_key, &proposals);

    env.storage()
        .instance()
        .set(&Symbol::new(&env, "gov_proposal_count"), &(id));

    env.events().publish(
        (
            Symbol::new(&env, "governance"),
            Symbol::new(&env, "proposal_created"),
            ProposalType::Normal,
        ),
        proposal,
    );

    id
}

/// Create an emergency proposal. Emergency proposals undergo a short review
/// window, require a much higher threshold, and expire if not executed in time.
pub fn create_emergency_proposal(
    env: Env,
    proposer: Address,
    proposal_key: Symbol,
    payload_hash: Bytes,
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

    // Emergency proposals require the configured review window regardless of
    // the configured timelock, and auto-expire after 48h if not executed.
    let emergency_review_seconds: u64 = env
        .storage()
        .instance()
        .get(&Symbol::new(&env, "gov_emergency_review_seconds"))
        .unwrap_or(3600u64);

    let now = env.ledger().timestamp();

    let proposal = Proposal {
        id: proposal_count + 1,
        proposal_key,
        payload_hash,
        created_at: now,
        executable_after: now + emergency_review_seconds,
        approvals: Vec::<Address>::new(&env),
        executed: false,
        proposal_type: ProposalType::Emergency,
    };

    let proposals_key = Symbol::new(&env, "gov_proposals");
    let mut proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(&env));

    let id = proposal.id;
    proposals.set(id, proposal.clone());
    env.storage().instance().set(&proposals_key, &proposals);

    env.storage()
        .instance()
        .set(&Symbol::new(&env, "gov_proposal_count"), &(id));

    env.events().publish(
        (
            Symbol::new(&env, "governance"),
            Symbol::new(&env, "proposal_created"),
            ProposalType::Emergency,
            Symbol::new(&env, "EMERGENCY"),
        ),
        proposal,
    );

    id
}

/// Set the review window (in seconds) applied to emergency proposals.
pub fn set_emergency_review_seconds(env: &Env, caller: &Address, seconds: u64) {
    caller.require_auth();
    if !is_owner(env, caller) {
        panic_with_error!(env, GovernanceError::Unauthorized);
    }
    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_emergency_review_seconds"), &seconds);
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

/// Whether a proposal may now be executed. Requires the threshold of unique
/// approvals, the configured quorum to have been reached, and (for emergency
/// proposals) that the proposal has not expired after 48h.
pub fn can_execute(env: &Env, proposal_id: u64, proposal_key: Symbol, payload_hash: Bytes) -> bool {
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

    match proposal.proposal_type {
        ProposalType::Normal => {
            let threshold = read_threshold(env);
            if proposal.approvals.len() < threshold {
                return false;
            }
            // Quorum must be satisfied for normal proposals.
            let quorum = read_quorum_config(env);
            let votes_cast = proposal.approvals.len();
            let q = quorum_bps(env, votes_cast);
            q >= quorum.min_participation_bps
        }
        ProposalType::Emergency => {
            // Emergency proposals require an 80% threshold and expire after 48h.
            let threshold_bps = 8000u32;
            let votes_cast = proposal.approvals.len();
            let participation = quorum_bps(env, votes_cast);
            if participation < threshold_bps {
                return false;
            }
            let expires_at = proposal.created_at.saturating_add(172800);
            now <= expires_at
        }
    }
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

    match proposal.proposal_type {
        ProposalType::Normal => {
            let threshold = read_threshold(&env);
            if proposal.approvals.len() < threshold {
                panic_with_error!(&env, GovernanceError::ThresholdNotMet);
            }
            let quorum = read_quorum_config(&env);
            let votes_cast = proposal.approvals.len();
            let q = quorum_bps(&env, votes_cast);
            if q < quorum.min_participation_bps {
                panic_with_error!(&env, GovernanceError::QuorumNotMet);
            }
        }
        ProposalType::Emergency => {
            let now = env.ledger().timestamp();
            if now < proposal.executable_after {
                panic_with_error!(&env, GovernanceError::TimelockNotExpired);
            }
            let votes_cast = proposal.approvals.len();
            let participation = quorum_bps(&env, votes_cast);
            if participation < 8000 {
                panic_with_error!(&env, GovernanceError::ThresholdNotMet);
            }
            let expires_at = proposal.created_at.saturating_add(172800);
            if now > expires_at {
                panic_with_error!(&env, GovernanceError::ProposalExpired);
            }
        }
    }

    proposal.executed = true;
    proposals.set(proposal_id, proposal);
    env.storage().instance().set(&proposals_key, &proposals);
}

/// Read-only dry-run that estimates the impact of executing a proposal.
/// Any caller may use this; it performs no state changes.
pub fn simulate_proposal(env: &Env, proposal_id: u64) -> ProposalSimulationResult {
    let proposals_key = Symbol::new(env, "gov_proposals");
    let proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(env));

    let proposal = proposals
        .get(proposal_id)
        .unwrap_or_else(|| panic_with_error!(env, GovernanceError::ProposalNotFound));

    if proposal.executed {
        panic_with_error!(env, GovernanceError::AlreadyExecuted);
    }

    // Deterministic estimates derived from the proposal's own parameters.
    let mut affected_contracts = Vec::new(env);
    affected_contracts.push_back(proposal.proposal_key);

    let state_changes = 1u32;
    let estimated_gas = 50_000u64 + (proposal.approvals.len() as u64) * 1_000u64;

    let payload_flag = proposal.payload_hash.first().unwrap_or(0u8);
    let requires_migration = payload_flag & 0x01 == 0x01;

    ProposalSimulationResult {
        affected_contracts,
        state_changes,
        estimated_gas,
        requires_migration,
    }
}
