use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Map, Symbol, Vec, String,
};

use crate::compliance_registry::ComplianceRegistryClient;

const STORAGE_VERSION: u32 = 1;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum RWATokenError {
    InsufficientBalance = 1,
    ComplianceCheckFailed = 2,
    TransferPaused = 3,
    Unauthorized = 4,
    InvalidAmount = 5,
    AssetFrozen = 6,
    KYCRequired = 7,
    TransferRestriction = 8,
    AlreadyInitialized = 9,
    NotInitialized = 10,
    TokenInfoNotFound = 11,
    Overflow = 12,
    Underflow = 13,
    StorageOutdated = 14,
    TokenNotInitialized = 15,
    AlreadyAtLatestVersion = 16,
    TokenPaused = 17,
    InvalidAddress = 18,
    SelfTransfer = 19,
    SnapshotNotFound = 20,
}

/// Maximum number of point-in-time balance snapshots kept on chain. The oldest
/// snapshot is evicted once this limit is reached (FIFO).
pub const MAX_SNAPSHOTS: u32 = 10;

/// Strkeys of the all-zero ed25519 account and the all-zero contract, used to
/// reject transfers that would otherwise burn tokens by sending them to the
/// "null" address.
const ZERO_ADDRESS: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ZERO_CONTRACT_ADDRESS: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

#[contracttype]
#[derive(Clone)]
pub struct TokenInfo {
    pub name: Symbol,
    pub symbol: Symbol,
    pub total_supply: i128,
    pub decimals: u32,
    pub asset_type: Symbol,
    pub metadata: Map<Symbol, String>,
    pub compliance_registry: Address,
    pub dividend_distributor: Address,
    pub created_at: u64,
    pub is_paused: bool,
    pub is_frozen: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct Balance {
    pub amount: i128,
    pub locked_amount: i128,
    pub voting_power: i128,
    pub last_dividend_claim: u64,
}

#[contracttype]
pub struct TransferRestriction {
    pub max_daily_amount: i128,
    pub max_monthly_amount: i128,
    pub requires_accreditation: bool,
    pub geographic_restrictions: Vec<Symbol>,
}

#[contracttype]
#[derive(Clone)]
pub struct LockSlot {
    pub amount: i128,
    pub until: u64,
}

/// Metadata recorded when a point-in-time balance snapshot is taken.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotMeta {
    pub snapshot_id: u32,
    pub timestamp: u64,
    pub total_supply: i128,
}

// ... (around line 61)
#[contract]
pub struct RWAToken;

#[contractimpl]
impl RWAToken {
// ...

    pub fn initialize(
        env: Env,
        auth: Address,
        name: Symbol,
        symbol: Symbol,
        total_supply: i128,
        decimals: u32,
        asset_type: Symbol,
        metadata: Map<Symbol, String>,
        compliance_registry: Address,
        dividend_distributor: Address,
    ) {
        if env
            .storage()
            .instance()
            .has(&Symbol::new(&env, "initialized"))
        {
            panic_with_error!(&env, RWATokenError::AlreadyInitialized);
        }

        if total_supply <= 0 || decimals > 18 {
            panic_with_error!(&env, RWATokenError::InvalidAmount);
        }

        let token_info = TokenInfo {
            name: name.clone(),
            symbol: symbol.clone(),
            total_supply,
            decimals,
            asset_type: asset_type.clone(),
            metadata,
            compliance_registry,
            dividend_distributor,
            created_at: env.ledger().timestamp(),
            is_paused: false,
            is_frozen: false,
        };

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &STORAGE_VERSION);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "locks"),
            &Map::<Address, LockSlot>::new(&env),
        );

        // The initializing `auth` becomes this token's admin: `mint` (which
        // performs the single auth check for this frame) requires it.
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &auth);

        Self::mint(env.clone(), auth.clone(), auth.clone(), total_supply);

        env.events().publish(
            (Symbol::new(&env, "token_initialized"), auth),
            (name, symbol, total_supply, decimals, asset_type),
        );
    }

    fn read_version(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&Symbol::new(env, "version"))
            .unwrap_or(0)
    }

    fn check_version(env: &Env) {
        if Self::read_version(env) < STORAGE_VERSION {
            panic_with_error!(env, RWATokenError::StorageOutdated);
        }
    }

    fn read_token_info(env: &Env) -> TokenInfo {
        env.storage()
            .instance()
            .get(&Symbol::new(env, "token_info"))
            .unwrap_or_else(|| panic_with_error!(env, RWATokenError::TokenNotInitialized))
    }

    pub fn migrate(env: Env, auth: Address) {
        crate::shared_admin::require_admin(&env, &auth);

        let ver = Self::read_version(&env);
        if ver >= STORAGE_VERSION {
            panic_with_error!(&env, RWATokenError::AlreadyAtLatestVersion);
        }

        let mut current = ver;
        while current < STORAGE_VERSION {
            current += 1;
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &STORAGE_VERSION);
    }

    pub fn mint(env: Env, auth: Address, to: Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(&env, RWATokenError::InvalidAmount);
        }

        crate::shared_admin::require_admin(&env, &auth);

        Self::check_version(&env);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        if token_info.is_paused {
            panic_with_error!(&env, RWATokenError::TokenPaused);
        }

        token_info.total_supply = token_info.total_supply
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow));
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        let mut balance = Self::get_balance(env.clone(), to.clone());
        balance.amount = balance.amount
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow));
        Self::write_balance(&env, to.clone(), balance);

        env.events().publish(
            (Symbol::new(&env, "mint"), to.clone()),
            (amount, env.ledger().timestamp()),
        );
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(&env, RWATokenError::InvalidAmount);
        }

        let token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::TokenInfoNotFound));

        if token_info.is_paused {
            panic_with_error!(&env, RWATokenError::TokenPaused);
        }

        Self::check_version(&env);

        let mut balance = Self::get_balance(env.clone(), from.clone());
        if balance.amount < amount {
            panic_with_error!(&env, RWATokenError::InsufficientBalance);
        }

        if !Self::check_transfer_compliance(env.clone(), from.clone(), from.clone(), amount) {
            panic_with_error!(&env, RWATokenError::ComplianceCheckFailed);
        }

        balance.amount = balance.amount
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Underflow));
        Self::write_balance(&env, from.clone(), balance);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        token_info.total_supply = token_info.total_supply
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Underflow));
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events().publish(
            (Symbol::new(&env, "burn"), from.clone()),
            (amount, env.ledger().timestamp()),
        );
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(&env, RWATokenError::InvalidAmount);
        }

        // Require explicit authorisation from the sender
        from.require_auth();

        Self::check_version(&env);

        if Self::is_zero_address(&env, &to) {
            panic_with_error!(&env, RWATokenError::InvalidAddress);
        }

        if from == to {
            panic_with_error!(&env, RWATokenError::SelfTransfer);
        }

        let token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        if token_info.is_paused || token_info.is_frozen {
            panic_with_error!(&env, RWATokenError::TransferPaused);
        }

        if !Self::check_transfer_compliance(env.clone(), from.clone(), to.clone(), amount) {
            panic_with_error!(&env, RWATokenError::ComplianceCheckFailed);
        }

        let mut from_balance = Self::get_balance(env.clone(), from.clone());
        let mut to_balance = Self::get_balance(env.clone(), to.clone());

        // Only spendable (unlocked) tokens may be transferred
        let spendable = from_balance.amount
            .checked_sub(from_balance.locked_amount)
            .unwrap_or(0);
        if spendable < amount {
            panic_with_error!(&env, RWATokenError::InsufficientBalance);
        }

        from_balance.amount = from_balance.amount
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Underflow));
        to_balance.amount = to_balance.amount
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow));

        Self::write_balance(&env, from.clone(), from_balance);
        Self::write_balance(&env, to.clone(), to_balance);

        env.events().publish(
            (Symbol::new(&env, "transfer"), from.clone()),
            (to, amount, env.ledger().timestamp()),
        );
    }

    pub fn get_token_info(env: Env) -> TokenInfo {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); })
    }

    pub fn get_balance(env: Env, address: Address) -> Balance {
        env.storage().instance().get(&address).unwrap_or(Balance {
            amount: 0,
            locked_amount: 0,
            voting_power: 0,
            last_dividend_claim: 0,
        })
    }

    fn is_zero_address(env: &Env, address: &Address) -> bool {
        *address == Address::from_str(env, ZERO_ADDRESS)
            || *address == Address::from_str(env, ZERO_CONTRACT_ADDRESS)
    }

    // ── balance storage (lazy initialization) ────────────────────────────────
    //
    // Only balances holding value are persisted: an address with no entry
    // reads as the default zero balance, and an entry that falls back to the
    // default is removed so the storage footprint stays proportional to the
    // number of actual holders.

    fn write_balance(env: &Env, address: Address, balance: Balance) {
        let is_default = balance.amount == 0
            && balance.locked_amount == 0
            && balance.voting_power == 0
            && balance.last_dividend_claim == 0;

        if is_default {
            env.storage().instance().remove(&address);
            Self::remove_holder(env, &address);
            return;
        }

        env.storage().instance().set(&address, &balance);

        if balance.amount > 0 || balance.locked_amount > 0 {
            Self::add_holder(env, &address);
        } else {
            Self::remove_holder(env, &address);
        }
    }

    // ── holder registry ──────────────────────────────────────────────────────
    //
    // Snapshot creation cannot enumerate instance storage, so the token keeps
    // an explicit list of addresses holding a non-zero balance.

    fn read_holders(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&Symbol::new(env, "holders"))
            .unwrap_or(Vec::new(env))
    }

    fn add_holder(env: &Env, address: &Address) {
        let mut holders = Self::read_holders(env);
        if !holders.contains(address) {
            holders.push_back(address.clone());
            env.storage()
                .instance()
                .set(&Symbol::new(env, "holders"), &holders);
        }
    }

    fn remove_holder(env: &Env, address: &Address) {
        let mut holders = Self::read_holders(env);
        if let Some(index) = holders.first_index_of(address) {
            holders.remove(index);
            env.storage()
                .instance()
                .set(&Symbol::new(env, "holders"), &holders);
        }
    }

    // ── point-in-time balance snapshots ─────────────────────────────────────
    //
    // Snapshots capture every holder's balance plus the total supply at the
    // current ledger timestamp, so dividend record dates and historic voting
    // power can be evaluated after the fact. At most `MAX_SNAPSHOTS` are kept;
    // creating one more evicts the oldest (FIFO).

    fn snapshot_meta_key(env: &Env, snapshot_id: u32) -> (Symbol, u32) {
        (Symbol::new(env, "snapshot_meta"), snapshot_id)
    }

    fn snapshot_balances_key(env: &Env, snapshot_id: u32) -> (Symbol, u32) {
        (Symbol::new(env, "snapshot_balances"), snapshot_id)
    }

    /// Captures the current balances and returns the new snapshot id.
    pub fn create_snapshot(env: Env, auth: Address) -> u32 {
        crate::shared_admin::require_admin(&env, &auth);
        Self::check_version(&env);

        let token_info = Self::read_token_info(&env);
        let snapshot_id: u32 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "next_snapshot_id"))
            .unwrap_or(1);

        let mut balances = Map::<Address, i128>::new(&env);
        for holder in Self::read_holders(&env).iter() {
            let balance = Self::get_balance(env.clone(), holder.clone());
            let total = balance.amount
                .checked_add(balance.locked_amount)
                .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow));
            if total > 0 {
                balances.set(holder, total);
            }
        }

        let mut snapshot_ids: Vec<u32> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "snapshot_ids"))
            .unwrap_or(Vec::new(&env));

        if snapshot_ids.len() >= MAX_SNAPSHOTS {
            if let Some(oldest) = snapshot_ids.get(0) {
                env.storage()
                    .persistent()
                    .remove(&Self::snapshot_meta_key(&env, oldest));
                env.storage()
                    .persistent()
                    .remove(&Self::snapshot_balances_key(&env, oldest));
                snapshot_ids.remove(0);
            }
        }

        let meta = SnapshotMeta {
            snapshot_id,
            timestamp: env.ledger().timestamp(),
            total_supply: token_info.total_supply,
        };

        let meta_key = Self::snapshot_meta_key(&env, snapshot_id);
        env.storage().persistent().set(&meta_key, &meta);
        env.storage().persistent().extend_ttl(&meta_key, 50_000, 535_680);

        let balances_key = Self::snapshot_balances_key(&env, snapshot_id);
        env.storage().persistent().set(&balances_key, &balances);
        env.storage()
            .persistent()
            .extend_ttl(&balances_key, 50_000, 535_680);

        snapshot_ids.push_back(snapshot_id);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "snapshot_ids"), &snapshot_ids);
        env.storage().instance().set(
            &Symbol::new(&env, "next_snapshot_id"),
            &snapshot_id
                .checked_add(1)
                .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow)),
        );

        env.events().publish(
            (Symbol::new(&env, "snapshot_created"), auth),
            snapshot_id,
        );

        snapshot_id
    }

    /// Total balance `address` held when `snapshot_id` was taken. Returns 0 for
    /// addresses that held nothing at that time.
    pub fn get_balance_at(env: Env, address: Address, snapshot_id: u32) -> i128 {
        let balances: Map<Address, i128> = env
            .storage()
            .persistent()
            .get(&Self::snapshot_balances_key(&env, snapshot_id))
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::SnapshotNotFound));

        balances.get(address).unwrap_or(0)
    }

    /// Metadata (timestamp and total supply) for a stored snapshot.
    pub fn get_snapshot_metadata(env: Env, snapshot_id: u32) -> SnapshotMeta {
        env.storage()
            .persistent()
            .get(&Self::snapshot_meta_key(&env, snapshot_id))
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::SnapshotNotFound))
    }

    /// Alias for [`Self::get_snapshot_metadata`].
    pub fn get_snapshot(env: Env, snapshot_id: u32) -> SnapshotMeta {
        Self::get_snapshot_metadata(env, snapshot_id)
    }

    /// Ids of the snapshots currently retained, oldest first.
    pub fn get_snapshot_ids(env: Env) -> Vec<u32> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "snapshot_ids"))
            .unwrap_or(Vec::new(&env))
    }

    // ── registry / distributor addresses ────────────────────────────────────

    /// Points the token at a new compliance registry. Admin-only and rejected
    /// while the token is paused.
    pub fn update_compliance_registry(env: Env, auth: Address, new_registry: Address) {
        crate::shared_admin::require_admin(&env, &auth);
        Self::check_version(&env);

        let mut token_info = Self::read_token_info(&env);
        if token_info.is_paused {
            panic_with_error!(&env, RWATokenError::TokenPaused);
        }

        let previous = token_info.compliance_registry.clone();
        token_info.compliance_registry = new_registry.clone();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events().publish(
            (Symbol::new(&env, "compliance_registry_updated"), auth),
            (previous, new_registry),
        );
    }

    /// Points the token at a new dividend distributor. Admin-only and rejected
    /// while the token is paused.
    pub fn update_dividend_distributor(env: Env, auth: Address, new_distributor: Address) {
        crate::shared_admin::require_admin(&env, &auth);
        Self::check_version(&env);

        let mut token_info = Self::read_token_info(&env);
        if token_info.is_paused {
            panic_with_error!(&env, RWATokenError::TokenPaused);
        }

        let previous = token_info.dividend_distributor.clone();
        token_info.dividend_distributor = new_distributor.clone();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events().publish(
            (Symbol::new(&env, "dividend_distributor_updated"), auth),
            (previous, new_distributor),
        );
    }

    pub fn lock_tokens(env: Env, auth: Address, owner: Address, amount: i128, lock_period: u64) {
        if amount <= 0 {
            panic_with_error!(&env, RWATokenError::InvalidAmount);
        }

        Self::check_version(&env);

        auth.require_auth();
        if auth != owner {
            panic_with_error!(&env, RWATokenError::Unauthorized);
        }

        let mut balance = Self::get_balance(env.clone(), owner.clone());
        if balance.amount < amount {
            panic_with_error!(&env, RWATokenError::InsufficientBalance);
        }

        balance.amount = balance.amount
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Underflow));
        balance.locked_amount = balance.locked_amount
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow));
        balance.voting_power = balance.voting_power
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow));

        Self::write_balance(&env, owner.clone(), balance);

        let mut locks: Map<Address, LockSlot> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "locks"))
            .unwrap_or(Map::new(&env));

        let slot = LockSlot {
            amount,
            until: env.ledger().timestamp()
                .checked_add(lock_period)
                .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow)),
        };
        locks.set(owner.clone(), slot);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "locks"), &locks);

        env.events().publish(
            (Symbol::new(&env, "tokens_locked"), owner),
            (amount, lock_period, env.ledger().timestamp()),
        );
    }

    pub fn unlock_tokens(env: Env, auth: Address, owner: Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(&env, RWATokenError::InvalidAmount);
        }

        Self::check_version(&env);

        auth.require_auth();
        if auth != owner {
            panic_with_error!(&env, RWATokenError::Unauthorized);
        }

        let mut balance = Self::get_balance(env.clone(), owner.clone());
        if balance.locked_amount < amount {
            panic_with_error!(&env, RWATokenError::InsufficientBalance);
        }

        balance.locked_amount = balance.locked_amount
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Underflow));
        balance.amount = balance.amount
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Overflow));
        balance.voting_power = balance.voting_power
            .checked_sub(amount)
            .unwrap_or_else(|| panic_with_error!(&env, RWATokenError::Underflow));

        Self::write_balance(&env, owner.clone(), balance);

        env.events().publish(
            (Symbol::new(&env, "tokens_unlocked"), owner),
            (amount, env.ledger().timestamp()),
        );
    }

    // ── delegated voting (liquid democracy) ───────────────────────────────────
    //
    // A holder may delegate its voting power to a representative. Delegated
    // power = own + delegated, with a max chain depth of 1 (representatives
    // cannot re-delegate the power they receive). See `shared_governance.rs`.

    /// Delegates `owner`'s voting power to `delegate` (replaces any previous
    /// delegation from `owner`). Panics on self-delegation and on any attempt
    /// to form a delegation chain longer than 1.
    pub fn delegate_votes(env: Env, owner: Address, delegate: Address) {
        let balance = Self::get_balance(env.clone(), owner.clone());
        crate::shared_governance::delegate_votes(env, owner, delegate, balance.voting_power);
    }

    /// Removes `owner`'s active delegation, returning its voting power.
    pub fn undelegate_votes(env: Env, owner: Address) {
        crate::shared_governance::undelegate_votes(env, owner);
    }

    /// The representative `owner` currently delegates to, if any.
    pub fn get_delegation(env: Env, owner: Address) -> Option<Address> {
        crate::shared_governance::get_delegation(&env, &owner)
    }

    /// Number of holders currently delegating to `delegate`.
    pub fn get_delegated_count(env: Env, delegate: Address) -> u32 {
        crate::shared_governance::get_delegated_count(&env, &delegate)
    }

    /// Total voting power `delegate` holds on behalf of its delegators.
    pub fn get_delegated_voting_power(env: Env, delegate: Address) -> i128 {
        crate::shared_governance::get_delegated_voting_power(&env, &delegate)
    }

    /// Effective voting power of `address` = own power (unless delegated away)
    /// + power received from direct delegators.
    pub fn get_effective_voting_power(env: Env, address: Address) -> i128 {
        let balance = Self::get_balance(env.clone(), address.clone());
        crate::shared_governance::get_effective_voting_power(&env, &address, balance.voting_power)
    }

    pub fn pause(env: Env, auth: Address) {
        crate::shared_admin::require_admin(&env, &auth);
        Self::check_version(&env);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        token_info.is_paused = true;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events().publish(
            (Symbol::new(&env, "token_paused"), auth),
            Symbol::new(&env, "paused"),
        );
    }

    pub fn unpause(env: Env, auth: Address) {
        crate::shared_admin::require_admin(&env, &auth);
        Self::check_version(&env);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        token_info.is_paused = false;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events().publish(
            (Symbol::new(&env, "token_unpaused"), auth),
            Symbol::new(&env, "unpaused"),
        );
    }

    pub fn freeze(env: Env, auth: Address) {
        crate::shared_admin::require_admin(&env, &auth);
        Self::check_version(&env);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        token_info.is_frozen = true;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events().publish(
            (Symbol::new(&env, "token_frozen"), auth),
            Symbol::new(&env, "frozen"),
        );
    }

    pub fn unfreeze(env: Env, auth: Address) {
        crate::shared_admin::require_admin(&env, &auth);
        Self::check_version(&env);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        token_info.is_frozen = false;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events().publish(
            (Symbol::new(&env, "token_unfrozen"), auth),
            Symbol::new(&env, "unfrozen"),
        );
    }

    pub fn calculate_voting_power(env: Env, balance: i128, model: crate::shared_governance::VotingModel) -> i128 {
        crate::shared_governance::calculate_voting_power(balance, model)
    }

    pub fn get_proposal_vote_power(
        env: Env,
        proposal_id: u64,
        address: Address,
    ) -> crate::shared_governance::VotePowerInfo {
        let balance = Self::get_balance(env.clone(), address.clone()).amount;
        crate::shared_governance::get_proposal_vote_power(&env, proposal_id, &address, balance)
    }

    fn check_transfer_compliance(env: Env, from: Address, to: Address, amount: i128) -> bool {
        let token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        let registry = ComplianceRegistryClient::new(&env, &token_info.compliance_registry);
        registry.check_compliance(&from, &to, &amount)
    }

    fn check_outbound_compliance(env: Env, from: Address, amount: i128) -> bool {
        let token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| { panic_with_error!(&env, RWATokenError::TokenInfoNotFound); });

        let registry = ComplianceRegistryClient::new(&env, &token_info.compliance_registry);
        registry.check_outbound_participant(&from, &amount)
    }
}
