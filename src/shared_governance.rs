use crate::auth::AuthError;
use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, Env, Symbol, IntoVal};

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
    // Issue #189: proposer does not meet the minimum token balance.
    InsufficientStake = 9,
    // Issue #188: security council veto helpers.
    NotCouncil = 10,
    AlreadyVetoed = 11,
    ProposalVetoed = 12,
}

/// Minimal threshold-based governance.
///
/// Security model:
/// - Owners set at initialization
/// - Any governance action is represented by a `proposal_key` (Symbol)
/// - Owners create a proposal (or any one can create; approvals still required)
/// - Approvers call `approve(proposal_id)`
/// - Once `threshold` unique approvals are collected, the action can be executed
/// - A designated security council can veto a proposal (M-of-N vote) before it
///   executes; vetoed proposals can never execute (Issue #188)
///
/// NOTE: This is intentionally generic and uses a `proposal_payload_hash` to bind params.
#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub proposal_key: Symbol,
    pub payload_hash: soroban_sdk::BytesN<32>,
    pub created_at: u64,
    pub executable_after: u64,
    pub approvals: soroban_sdk::Vec<Address>,
    pub executed: bool,
    pub vetoed: bool,
    pub veto_votes: soroban_sdk::Vec<Address>,
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

    // Issue #189: spam protection defaults (no stake required until set).
    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_min_proposal_balance"), &0u128);
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

fn read_min_proposal_balance(env: &Env) -> u128 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_min_proposal_balance"))
        .unwrap_or(0u128)
}

fn read_stake_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_stake_token"))
        .unwrap_or_else(|| panic_with_error!(env, GovernanceError::InvalidProposalPayload))
}

fn read_council(env: &Env) -> soroban_sdk::Vec<Address> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_council"))
        .unwrap_or(soroban_sdk::Vec::new(env))
}

fn read_council_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, "gov_council_threshold"))
        .unwrap_or(1u32)
}

fn is_owner(env: &Env, addr: &Address) -> bool {
    let owners = read_owners(env);
    owners.iter().any(|o| o.clone() == *addr)
}

fn is_council_member(env: &Env, addr: &Address) -> bool {
    let council = read_council(env);
    council.iter().any(|c| c.clone() == *addr)
}

/// Issue #189: set the minimum token balance a proposer must hold (excluding
/// locked tokens) to create a proposal. A value of `0` disables the check.
pub fn set_min_proposal_balance(env: &Env, admin: Address, min: u128) {
    admin.require_auth();
    if !is_owner(env, &admin) {
        panic_with_error!(env, GovernanceError::Unauthorized);
    }

    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_min_proposal_balance"), &min);
}

/// Issue #189: configure the token whose unlocked balance is used to enforce
/// the minimum proposal stake.
pub fn set_stake_token(env: &Env, admin: Address, token: Address) {
    admin.require_auth();
    if !is_owner(env, &admin) {
        panic_with_error!(env, GovernanceError::Unauthorized);
    }

    env.storage()
        .instance()
        .set(&Symbol::new(env, "gov_stake_token"), &token);
}

/// Issue #188: (re)configure the security council. `council` is the full
/// member list and `veto_threshold` is M for the M-of-N veto. Emits a
/// `council_updated` event.
pub fn update_council(
    env: &Env,
    admin: Address,
    council: soroban_sdk::Vec<Address>,
    veto_threshold: u32,
) {
    admin.require_auth();
    if !is_owner(env, &admin) {
        panic_with_error!(env, GovernanceError::Unauthorized);
    }
    if veto_threshold == 0 || veto_threshold > council.len() {
        panic_with_error!(env, GovernanceError::InvalidProposalPayload);
    }

    let council_key = Symbol::new(env, "gov_council");
    let threshold_key = Symbol::new(env, "gov_council_threshold");
    env.storage().instance().set(&council_key, &council);
    env.storage().instance().set(&threshold_key, &veto_threshold);

    env.events().publish(
        (Symbol::new(env, "council_updated"), council.len(), veto_threshold),
        (),
    );
}

/// Compute the proposer's stake that counts toward the minimum: total balance
/// minus locked tokens.
fn proposer_unlocked_stake(env: &Env, token: &Address, proposer: &Address) -> i128 {
    let args: soroban_sdk::Vec<soroban_sdk::Val> =
        soroban_sdk::vec![env, proposer.clone().into_val(env)];
    let balance: crate::rwa_token::Balance =
        env.invoke_contract(token, &Symbol::new(env, "get_balance"), args);
    balance.amount.saturating_sub(balance.locked_amount).max(0)
}

pub fn create_proposal(
    env: Env,
    proposer: Address,
    proposal_key: Symbol,
    payload_hash: soroban_sdk::BytesN<32>,
) -> u64 {
    proposer.require_auth();

    if !is_owner(&env, &proposer) {
        panic_with_error!(&env, GovernanceError::Unauthorized);
    }

    // Issue #189: require a minimum unlocked token balance to deter spam.
    let min_balance = read_min_proposal_balance(&env);
    if min_balance > 0 {
        let stake_token = read_stake_token(&env);
        let unlocked = proposer_unlocked_stake(&env, &stake_token, &proposer);
        if (unlocked as u128) < min_balance {
            panic_with_error!(&env, GovernanceError::InsufficientStake);
        }
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
        vetoed: false,
        veto_votes: soroban_sdk::Vec::<Address>::new(&env),
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

/// Issue #188: record a veto vote from a security council member. A proposal
/// is vetoed once `veto_threshold` (M) unique council members have voted.
///
/// Returns the number of veto votes recorded on this proposal so far. Emits a
/// `proposal_vetoed` event when the threshold is reached.
pub fn veto_proposal(env: Env, council_member: Address, proposal_id: u64) -> u32 {
    council_member.require_auth();
    if !is_council_member(&env, &council_member) {
        panic_with_error!(&env, GovernanceError::NotCouncil);
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
    if proposal.vetoed {
        panic_with_error!(&env, GovernanceError::AlreadyVetoed);
    }
    if proposal.veto_votes.iter().any(|v| v.clone() == council_member) {
        panic_with_error!(&env, GovernanceError::AlreadyVetoed);
    }

    proposal.veto_votes.push_back(council_member);
    let votes = proposal.veto_votes.len() as u32;

    let threshold = read_council_threshold(&env);
    if votes >= threshold {
        proposal.vetoed = true;
        env.events().publish(
            (Symbol::new(&env, "proposal_vetoed"), proposal_id),
            (),
        );
    }

    proposals.set(proposal_id, proposal);
    env.storage().instance().set(&proposals_key, &proposals);

    votes
}

pub fn read_proposal(env: &Env, proposal_id: u64) -> Proposal {
    let proposals_key = Symbol::new(env, "gov_proposals");
    let proposals: soroban_sdk::Map<u64, Proposal> = env
        .storage()
        .instance()
        .get(&proposals_key)
        .unwrap_or(soroban_sdk::Map::new(env));

    proposals
        .get(proposal_id)
        .unwrap_or_else(|| panic_with_error!(env, GovernanceError::ProposalNotFound))
}

/// Issue #188: whether the security council has vetoed the proposal.
pub fn proposal_is_vetoed(env: &Env, proposal_id: u64) -> bool {
    let proposal = read_proposal(env, proposal_id);
    proposal.vetoed
}

pub fn can_execute(
    env: &Env,
    proposal_id: u64,
    proposal_key: Symbol,
    payload_hash: soroban_sdk::BytesN<32>,
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
    // Issue #188: vetoed proposals can never execute.
    if proposal.vetoed {
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

    // Issue #188: vetoed proposals must never execute.
    if proposal.vetoed {
        panic_with_error!(&env, GovernanceError::ProposalVetoed);
    }

    proposal.executed = true;
    proposals.set(proposal_id, proposal);
    env.storage().instance().set(&proposals_key, &proposals);
}
