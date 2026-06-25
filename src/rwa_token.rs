use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Map, Symbol, Vec,
};

use crate::auth::assert_admin;
use crate::compliance_registry::ComplianceRegistryClient;

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
}

#[contracttype]
#[derive(Clone)]
pub struct TokenInfo {
    pub name: Symbol,
    pub symbol: Symbol,
    pub total_supply: i128,
    pub decimals: u32,
    pub asset_type: Symbol,
    pub metadata: Map<Symbol, Symbol>,
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

// ... (around line 61)
#[contract]
pub struct RWAToken;

pub struct RWATokenClient<'a> {
    env: &'a Env,
    id: Address,
}

impl<'a> RWATokenClient<'a> {
    pub fn new(env: &'a Env, id: &Address) -> Self {
        Self { env, id: id.clone() }
    }

    pub fn initialize(&self, auth: &Address, name: Symbol, symbol: Symbol, total_supply: i128, decimals: u32, asset_type: Symbol, metadata: Map<Symbol, Symbol>, compliance_registry: &Address, dividend_distributor: &Address) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "initialize"), &(auth, name, symbol, total_supply, decimals, asset_type, metadata, compliance_registry, dividend_distributor));
    }

    pub fn mint(&self, auth: &Address, to: &Address, amount: i128) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "mint"), &(auth, to, amount));
    }

    pub fn burn(&self, from: &Address, amount: i128) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "burn"), &(from, amount));
    }

    pub fn transfer(&self, from: &Address, to: &Address, amount: i128) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "transfer"), &(from, to, amount));
    }

    pub fn get_balance(&self, address: &Address) -> Balance {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "get_balance"), &(address))
    }

    pub fn get_token_info(&self) -> TokenInfo {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "get_token_info"), &())
    }

    pub fn lock_tokens(&self, auth: &Address, owner: &Address, amount: i128, lock_period: u64) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "lock_tokens"), &(auth, owner, amount, lock_period));
    }

    pub fn unlock_tokens(&self, auth: &Address, owner: &Address, amount: i128) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "unlock_tokens"), &(auth, owner, amount));
    }
}

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
        metadata: Map<Symbol, Symbol>,
        compliance_registry: Address,
        dividend_distributor: Address,
    ) {
        auth.require_auth();
        if env
            .storage()
            .instance()
            .has(&Symbol::new(&env, "initialized"))
        {
            panic!("Token already initialized");
        }

        if total_supply <= 0 || decimals > 18 {
            panic!("Invalid token parameters");
        }

        let token_info = TokenInfo {
            name,
            symbol,
            total_supply,
            decimals,
            asset_type,
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
            .set(&Symbol::new(&env, "initialized"), &true);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &auth);

        env.storage().instance().set(
            &Symbol::new(&env, "locks"),
            &Map::<Address, LockSlot>::new(&env),
        );

        Self::mint(env.clone(), auth.clone(), auth.clone(), total_supply);
    }

    pub fn mint(env: Env, auth: Address, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("Invalid amount");
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Token not initialized"));

        assert_admin(&auth, &admin);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        token_info.total_supply += amount;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        let mut balance = Self::get_balance(env.clone(), to.clone());
        balance.amount += amount;
        env.storage().instance().set(&to, &balance);

        env.events()
            .publish((Symbol::new(&env, "mint"), to.clone()), amount);
    }

    pub fn burn(env: Env, from: Address, amount: i128) {
        if amount <= 0 {
            panic!("Invalid amount");
        }

        let mut balance = Self::get_balance(env.clone(), from.clone());
        if balance.amount < amount {
            panic!("Insufficient balance");
        }

        if !Self::check_outbound_compliance(env.clone(), from.clone(), amount) {
            panic!("Compliance check failed");
        }

        balance.amount -= amount;
        env.storage().instance().set(&from, &balance);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        token_info.total_supply -= amount;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);

        env.events()
            .publish((Symbol::new(&env, "burn"), from.clone()), amount);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        if amount <= 0 {
            panic!("Invalid amount");
        }

        let token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        if token_info.is_paused || token_info.is_frozen {
            panic!("Token transfers are paused or frozen");
        }

        if !Self::check_transfer_compliance(env.clone(), from.clone(), to.clone(), amount) {
            panic!("Compliance check failed");
        }

        let mut from_balance = Self::get_balance(env.clone(), from.clone());
        let mut to_balance = Self::get_balance(env.clone(), to.clone());

        if from_balance.amount < amount {
            panic!("Insufficient balance");
        }

        from_balance.amount -= amount;
        to_balance.amount += amount;

        env.storage().instance().set(&from, &from_balance);
        env.storage().instance().set(&to, &to_balance);

        env.events()
            .publish((Symbol::new(&env, "transfer"), from, to), amount);
    }

    pub fn get_token_info(env: Env) -> TokenInfo {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"))
    }

    pub fn get_balance(env: Env, address: Address) -> Balance {
        env.storage().instance().get(&address).unwrap_or(Balance {
            amount: 0,
            locked_amount: 0,
            voting_power: 0,
            last_dividend_claim: 0,
        })
    }

    pub fn lock_tokens(env: Env, auth: Address, owner: Address, amount: i128, lock_period: u64) {
        if amount <= 0 {
            panic!("Invalid amount");
        }

        auth.require_auth();
        if auth != owner {
            panic!("Unauthorized");
        }

        let mut balance = Self::get_balance(env.clone(), owner.clone());
        if balance.amount < amount {
            panic!("Insufficient balance");
        }

        balance.amount -= amount;
        balance.locked_amount += amount;
        balance.voting_power += amount;

        env.storage().instance().set(&owner, &balance);

        let mut locks: Map<Address, LockSlot> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "locks"))
            .unwrap_or(Map::new(&env));

        let slot = LockSlot {
            amount,
            until: env.ledger().timestamp() + lock_period,
        };
        locks.set(owner.clone(), slot);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "locks"), &locks);

        env.events().publish(
            (Symbol::new(&env, "tokens_locked"), owner),
            (amount, lock_period),
        );
    }

    pub fn unlock_tokens(env: Env, auth: Address, owner: Address, amount: i128) {
        if amount <= 0 {
            panic!("Invalid amount");
        }

        auth.require_auth();
        if auth != owner {
            panic!("Unauthorized");
        }

        let mut balance = Self::get_balance(env.clone(), owner.clone());
        if balance.locked_amount < amount {
            panic!("Insufficient locked tokens");
        }

        balance.locked_amount -= amount;
        balance.amount += amount;
        balance.voting_power -= amount;

        env.storage().instance().set(&owner, &balance);

        env.events()
            .publish((Symbol::new(&env, "tokens_unlocked"), owner), amount);
    }

    pub fn pause(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Token not initialized"));

        assert_admin(&auth, &admin);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        token_info.is_paused = true;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);
    }

    pub fn unpause(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Token not initialized"));

        assert_admin(&auth, &admin);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        token_info.is_paused = false;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);
    }

    pub fn freeze(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Token not initialized"));

        assert_admin(&auth, &admin);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        token_info.is_frozen = true;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);
    }

    pub fn unfreeze(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Token not initialized"));

        assert_admin(&auth, &admin);

        let mut token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        token_info.is_frozen = false;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "token_info"), &token_info);
    }

    fn check_transfer_compliance(env: Env, from: Address, to: Address, amount: i128) -> bool {
        let token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        let registry = ComplianceRegistryClient::new(&env, &token_info.compliance_registry);
        registry.check_compliance(&from, &to, &amount)
    }

    fn check_outbound_compliance(env: Env, from: Address, amount: i128) -> bool {
        let token_info: TokenInfo = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "token_info"))
            .unwrap_or_else(|| panic!("Token info not found"));

        let registry = ComplianceRegistryClient::new(&env, &token_info.compliance_registry);
        registry.check_outbound_participant(&from, &amount)
    }
}
