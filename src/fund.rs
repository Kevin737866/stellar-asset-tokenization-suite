use soroban_sdk::{
    contracterror, contracttype, panic_with_error, Address, Env, Map, String, Symbol, Vec,
};

use crate::asset_class_handlers::validate_metadata_size;
use crate::asset_factory::AssetConfig;

/// Weights and fees are expressed in basis points (1/100th of a percent).
pub const BASIS_POINTS: u32 = 10_000;

/// A management fee above 10% is rejected as implausible for a tokenized fund.
pub const MAX_MANAGEMENT_FEE_BPS: u32 = 1_000;

const FUND_CONFIG_KEY: &str = "fund_config";
const FUND_STATE_KEY: &str = "fund_state";
const FUND_HOLDERS_KEY: &str = "fund_holders";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum FundError {
    InvalidUnderlyingAssets = 1,
    InvalidWeights = 2,
    InvalidManagementFee = 3,
    FundNotInitialized = 4,
    InvalidShares = 5,
    InsufficientShares = 6,
    InvalidNav = 7,
    NavLengthMismatch = 8,
    InvalidGovernanceProposal = 9,
}

/// Issue #174: configuration for an ETF-like tokenized fund.
///
/// `underlying_assets` and `weights` are positionally aligned and `weights`
/// must sum to `BASIS_POINTS` (100%).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundConfig {
    pub underlying_assets: Vec<Address>,
    pub weights: Vec<u32>,
    pub management_fee_bps: u32,
}

/// Issue #174: live share accounting for a fund.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundState {
    pub total_shares: i128,
    /// Net asset value of a single share, in the fund's base currency.
    pub nav_per_share: i128,
    pub management_fee_bps: u32,
}

fn fund_config_key(env: &Env) -> Symbol {
    Symbol::new(env, FUND_CONFIG_KEY)
}

fn fund_state_key(env: &Env) -> Symbol {
    Symbol::new(env, FUND_STATE_KEY)
}

fn fund_holders_key(env: &Env) -> Symbol {
    Symbol::new(env, FUND_HOLDERS_KEY)
}

/// Issue #174: validate the basket composition of a fund.
pub fn validate_fund_config(env: &Env, config: &FundConfig) {
    if config.underlying_assets.is_empty()
        || config.underlying_assets.len() != config.weights.len()
    {
        panic_with_error!(env, FundError::InvalidUnderlyingAssets);
    }

    if config.management_fee_bps > MAX_MANAGEMENT_FEE_BPS {
        panic_with_error!(env, FundError::InvalidManagementFee);
    }

    validate_weights(env, &config.weights);
}

fn validate_weights(env: &Env, weights: &Vec<u32>) {
    let mut total: u32 = 0;
    for weight in weights.iter() {
        total = total
            .checked_add(weight)
            .unwrap_or_else(|| panic_with_error!(env, FundError::InvalidWeights));
    }

    if total != BASIS_POINTS {
        panic_with_error!(env, FundError::InvalidWeights);
    }
}

/// Issue #174: fold a fund configuration into an asset config.
pub fn create_fund_config(
    env: Env,
    base_config: AssetConfig,
    fund_config: FundConfig,
) -> AssetConfig {
    validate_fund_config(&env, &fund_config);
    validate_metadata_size(&env, base_config.metadata.len(), 100);

    let mut weight_list = std::string::String::new();
    for (index, weight) in fund_config.weights.iter().enumerate() {
        if index > 0 {
            weight_list.push(',');
        }
        weight_list.push_str(&weight.to_string());
    }
    let weights = String::from_str(&env, &weight_list);

    let mut metadata = base_config.metadata;
    metadata.set(
        Symbol::new(&env, "asset_subtype"),
        String::from_str(&env, "fund"),
    );
    metadata.set(
        Symbol::new(&env, "underlying_count"),
        String::from_str(&env, &fund_config.underlying_assets.len().to_string()),
    );
    metadata.set(Symbol::new(&env, "weights_bps"), weights);
    metadata.set(
        Symbol::new(&env, "management_fee_bps"),
        String::from_str(&env, &fund_config.management_fee_bps.to_string()),
    );

    AssetConfig {
        metadata,
        ..base_config
    }
}

/// Issue #174: compute the net asset value of one fund share from the prices
/// of the underlying assets. `prices` and `weights` are positionally aligned
/// and weights are basis points that must sum to 100%.
pub fn calculate_nav(env: &Env, prices: Vec<i128>, weights: Vec<u32>) -> i128 {
    if prices.is_empty() || prices.len() != weights.len() {
        panic_with_error!(env, FundError::NavLengthMismatch);
    }

    validate_weights(env, &weights);

    let mut nav: i128 = 0;
    for index in 0..prices.len() {
        let price = prices.get(index).unwrap();
        let weight = weights.get(index).unwrap();

        if price <= 0 {
            panic_with_error!(env, FundError::InvalidNav);
        }

        nav = nav
            .checked_add(
                price
                    .checked_mul(weight as i128)
                    .unwrap_or_else(|| panic_with_error!(env, FundError::InvalidNav)),
            )
            .unwrap_or_else(|| panic_with_error!(env, FundError::InvalidNav));
    }

    nav / BASIS_POINTS as i128
}

/// Issue #174: register a fund's basket and fee before shares are issued.
pub fn initialize_fund(env: Env, auth: Address, fund: Address, config: FundConfig) {
    auth.require_auth();
    validate_fund_config(&env, &config);

    let config_key = fund_config_key(&env);
    let mut configs: Map<Address, FundConfig> = env
        .storage()
        .instance()
        .get(&config_key)
        .unwrap_or(Map::new(&env));
    configs.set(fund.clone(), config.clone());
    env.storage().instance().set(&config_key, &configs);

    let state_key = fund_state_key(&env);
    let mut states: Map<Address, FundState> = env
        .storage()
        .instance()
        .get(&state_key)
        .unwrap_or(Map::new(&env));
    states.set(
        fund.clone(),
        FundState {
            total_shares: 0,
            nav_per_share: 0,
            management_fee_bps: config.management_fee_bps,
        },
    );
    env.storage().instance().set(&state_key, &states);

    env.events().publish(
        (Symbol::new(&env, "fund_initialized"), fund),
        (config.underlying_assets.len(), config.management_fee_bps),
    );
}

/// Issue #174: mint fund shares to `auth` at the supplied NAV per share.
/// Returns the new total share count.
pub fn create_fund_shares(
    env: Env,
    auth: Address,
    fund: Address,
    shares: i128,
    nav_per_share: i128,
) -> i128 {
    if shares <= 0 || nav_per_share <= 0 {
        panic_with_error!(&env, FundError::InvalidShares);
    }

    auth.require_auth();

    let configs: Map<Address, FundConfig> = env
        .storage()
        .instance()
        .get(&fund_config_key(&env))
        .unwrap_or(Map::new(&env));
    if !configs.contains_key(fund.clone()) {
        panic_with_error!(&env, FundError::FundNotInitialized);
    }

    let state_key = fund_state_key(&env);
    let mut states: Map<Address, FundState> = env
        .storage()
        .instance()
        .get(&state_key)
        .unwrap_or(Map::new(&env));
    let mut state = states
        .get(fund.clone())
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized));

    state.total_shares = state
        .total_shares
        .checked_add(shares)
        .unwrap_or_else(|| panic_with_error!(&env, FundError::InvalidShares));
    state.nav_per_share = nav_per_share;
    states.set(fund.clone(), state.clone());
    env.storage().instance().set(&state_key, &states);

    let holders_key = fund_holders_key(&env);
    let mut holders: Map<Address, Map<Address, i128>> = env
        .storage()
        .instance()
        .get(&holders_key)
        .unwrap_or(Map::new(&env));
    let mut fund_holders = holders.get(fund.clone()).unwrap_or(Map::new(&env));
    let balance = fund_holders.get(auth.clone()).unwrap_or(0);
    fund_holders.set(auth.clone(), balance + shares);
    holders.set(fund.clone(), fund_holders);
    env.storage().instance().set(&holders_key, &holders);

    env.events().publish(
        (Symbol::new(&env, "fund_shares_created"), fund),
        (auth, shares, nav_per_share, state.total_shares),
    );

    state.total_shares
}

/// Issue #174: redeem fund shares and return the redemption value
/// (`shares * nav_per_share`).
pub fn redeem_fund_shares(env: Env, auth: Address, fund: Address, shares: i128) -> i128 {
    if shares <= 0 {
        panic_with_error!(&env, FundError::InvalidShares);
    }

    auth.require_auth();

    let state_key = fund_state_key(&env);
    let mut states: Map<Address, FundState> = env
        .storage()
        .instance()
        .get(&state_key)
        .unwrap_or(Map::new(&env));
    let mut state = states
        .get(fund.clone())
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized));

    let holders_key = fund_holders_key(&env);
    let mut holders: Map<Address, Map<Address, i128>> = env
        .storage()
        .instance()
        .get(&holders_key)
        .unwrap_or(Map::new(&env));
    let mut fund_holders = holders.get(fund.clone()).unwrap_or(Map::new(&env));
    let balance = fund_holders.get(auth.clone()).unwrap_or(0);

    if balance < shares {
        panic_with_error!(&env, FundError::InsufficientShares);
    }

    let remaining = balance - shares;
    if remaining == 0 {
        fund_holders.remove(auth.clone());
    } else {
        fund_holders.set(auth.clone(), remaining);
    }
    holders.set(fund.clone(), fund_holders);
    env.storage().instance().set(&holders_key, &holders);

    state.total_shares = state
        .total_shares
        .checked_sub(shares)
        .unwrap_or_else(|| panic_with_error!(&env, FundError::InsufficientShares));
    let payout = shares
        .checked_mul(state.nav_per_share)
        .unwrap_or_else(|| panic_with_error!(&env, FundError::InvalidNav));
    states.set(fund.clone(), state.clone());
    env.storage().instance().set(&state_key, &states);

    env.events().publish(
        (Symbol::new(&env, "fund_shares_redeemed"), fund),
        (auth, shares, payout, state.total_shares),
    );

    payout
}

/// Issue #174: update the fund's per-share NAV from the underlying prices.
pub fn update_nav(env: Env, auth: Address, fund: Address, prices: Vec<i128>) -> i128 {
    auth.require_auth();

    let configs: Map<Address, FundConfig> = env
        .storage()
        .instance()
        .get(&fund_config_key(&env))
        .unwrap_or(Map::new(&env));
    let config = configs
        .get(fund.clone())
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized));

    let nav = calculate_nav(&env, prices, config.weights);

    let state_key = fund_state_key(&env);
    let mut states: Map<Address, FundState> = env
        .storage()
        .instance()
        .get(&state_key)
        .unwrap_or(Map::new(&env));
    let mut state = states
        .get(fund.clone())
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized));
    state.nav_per_share = nav;
    states.set(fund.clone(), state);
    env.storage().instance().set(&state_key, &states);

    env.events().publish(
        (Symbol::new(&env, "fund_nav_updated"), fund),
        (nav, env.ledger().timestamp()),
    );

    nav
}

/// Issue #174: rebalance a fund to new weights. This is the execution hook
/// for a governance-approved rebalance; the contract admin submits it once
/// the vote has passed.
pub fn rebalance_fund(env: Env, auth: Address, fund: Address, new_weights: Vec<u32>) {
    crate::shared_admin::require_admin(&env, &auth);
    validate_weights(&env, &new_weights);

    let config_key = fund_config_key(&env);
    let mut configs: Map<Address, FundConfig> = env
        .storage()
        .instance()
        .get(&config_key)
        .unwrap_or(Map::new(&env));
    let mut config = configs
        .get(fund.clone())
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized));

    if config.underlying_assets.len() != new_weights.len() {
        panic_with_error!(&env, FundError::InvalidWeights);
    }

    config.weights = new_weights.clone();
    configs.set(fund.clone(), config);
    env.storage().instance().set(&config_key, &configs);

    env.events().publish(
        (Symbol::new(&env, "fund_rebalanced"), fund),
        (new_weights, env.ledger().timestamp()),
    );
}

/// Issue #174: the governance path for rebalancing. `can_execute` proves the
/// proposal passed and has not been executed yet; `execute_mark` consumes it.
pub fn rebalance_fund_via_governance(
    env: Env,
    executor: Address,
    fund: Address,
    proposal_id: u64,
    payload_hash: soroban_sdk::BytesN<32>,
    new_weights: Vec<u32>,
) {
    if !crate::shared_governance::can_execute(
        &env,
        proposal_id,
        Symbol::new(&env, "fund_rebalance"),
        payload_hash,
    ) {
        panic_with_error!(&env, FundError::InvalidGovernanceProposal);
    }

    crate::shared_governance::execute_mark(env.clone(), executor, proposal_id);
    validate_weights(&env, &new_weights);

    let config_key = fund_config_key(&env);
    let mut configs: Map<Address, FundConfig> = env
        .storage()
        .instance()
        .get(&config_key)
        .unwrap_or(Map::new(&env));
    let mut config = configs
        .get(fund.clone())
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized));

    if config.underlying_assets.len() != new_weights.len() {
        panic_with_error!(&env, FundError::InvalidWeights);
    }

    config.weights = new_weights.clone();
    configs.set(fund.clone(), config);
    env.storage().instance().set(&config_key, &configs);

    env.events().publish(
        (Symbol::new(&env, "fund_rebalanced"), fund),
        (new_weights, env.ledger().timestamp()),
    );
}

pub fn get_fund_config(env: Env, fund: Address) -> FundConfig {
    let configs: Map<Address, FundConfig> = env
        .storage()
        .instance()
        .get(&fund_config_key(&env))
        .unwrap_or(Map::new(&env));
    configs
        .get(fund)
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized))
}

pub fn get_fund_state(env: Env, fund: Address) -> FundState {
    let states: Map<Address, FundState> = env
        .storage()
        .instance()
        .get(&fund_state_key(&env))
        .unwrap_or(Map::new(&env));
    states
        .get(fund)
        .unwrap_or_else(|| panic_with_error!(&env, FundError::FundNotInitialized))
}

pub fn get_fund_shares(env: Env, fund: Address, holder: Address) -> i128 {
    let holders: Map<Address, Map<Address, i128>> = env
        .storage()
        .instance()
        .get(&fund_holders_key(&env))
        .unwrap_or(Map::new(&env));
    holders
        .get(fund)
        .unwrap_or(Map::new(&env))
        .get(holder)
        .unwrap_or(0)
}
