use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, token::TokenClient, Address, Env, Map,
    Symbol, Vec,
};

use crate::rwa_token::RWATokenClient;

const STORAGE_VERSION: u32 = 1;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum DividendError {
    Unauthorized = 1,
    InsufficientFunds = 2,
    InvalidAmount = 3,
    DistributionNotFound = 4,
    AlreadyClaimed = 5,
    UnsupportedCurrency = 6,
    DistributionNotActive = 7,
    AlreadyInitialized = 8,
    LengthMismatch = 9,
    NotInitialized = 10,
    ConfigNotFound = 11,
    AutoDistributionDisabled = 12,
    YieldCadenceNotReached = 13,
    ZeroTotalSupply = 14,
    NoTokensToClaim = 15,
    NoDividendAvailable = 16,
    StorageOutdated = 17,
    DistributorNotInitialized = 18,
    AlreadyAtLatestVersion = 19,
    InvalidParameters = 20,
}

#[contracttype]
#[derive(Clone)]
pub struct DividendDistribution {
    pub distribution_id: u64,
    pub token_address: Address,
    pub currency: Symbol,
    pub total_amount: i128,
    pub per_token_amount: i128,
    pub total_supply: i128,
    pub claim_deadline: u64,
    pub created_at: u64,
    pub is_active: bool,
    pub metadata: Map<Symbol, Symbol>,
}

#[contracttype]
#[derive(Clone)]
pub struct ClaimKey {
    pub distribution_id: u64,
    pub claimer: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct ClaimInfo {
    pub distribution_id: u64,
    pub claimer: Address,
    pub amount_claimed: i128,
    pub claimed_at: u64,
    pub currency: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub struct DividendConfig {
    pub supported_currencies: Vec<Symbol>,
    pub auto_distribute: bool,
    pub min_distribution_amount: i128,
    pub max_distribution_frequency: u64,
    pub fee_rate: i64,
    pub fee_recipient: Address,
}

#[contract]
pub struct DividendDistributor;

#[contractimpl]
impl DividendDistributor {
    pub fn initialize(env: Env, auth: Address, admin: Address, supported_currencies: Vec<Symbol>) {
        auth.require_auth();
        if env
            .storage()
            .instance()
            .has(&Symbol::new(&env, "initialized"))
        {
            panic_with_error!(&env, DividendError::AlreadyInitialized);
        }

        let config = DividendConfig {
            supported_currencies: supported_currencies.clone(),
            auto_distribute: false,
            min_distribution_amount: 1000,
            max_distribution_frequency: 86400,
            fee_rate: 50,
            fee_recipient: admin.clone(),
        };

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "config"), &config);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "initialized"), &true);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "distribution_count"), &0u64);
        env.storage().instance().set(
            &Symbol::new(&env, "distributions"),
            &Vec::<DividendDistribution>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "currency_tokens"),
            &Map::<Symbol, Address>::new(&env),
        );
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "last_auto_distribution_at"), &0u64);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "clm_tot"),             &Map::<u64, i128>::new(&env));
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &STORAGE_VERSION);
    }

    fn read_version(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&Symbol::new(env, "version"))
            .unwrap_or(0)
    }

    fn check_version(env: &Env) {
        if Self::read_version(env) < STORAGE_VERSION {
            panic_with_error!(env, DividendError::StorageOutdated);
        }
    }

    pub fn migrate(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::DistributorNotInitialized); });

        crate::auth::assert_admin(&env, &auth, &admin);

        let ver = Self::read_version(&env);
        if ver >= STORAGE_VERSION {
            panic_with_error!(&env, DividendError::AlreadyAtLatestVersion);
        }

        let mut current = ver;
        while current < STORAGE_VERSION {
            current += 1;
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &STORAGE_VERSION);
    }

    pub fn register_currency_token(
        env: Env,
        auth: Address,
        currency: Symbol,
        token_address: Address,
    ) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut map: Map<Symbol, Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "currency_tokens"))
            .unwrap_or(Map::new(&env));

        map.set(currency, token_address);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "currency_tokens"), &map);
    }

    pub fn multi_ccy_distributions(
        env: Env,
        auth: Address,
        token_address: Address,
        currencies: Vec<Symbol>,
        amounts: Vec<i128>,
        claim_deadline: u64,
        metadata: Map<Symbol, Symbol>,
    ) -> Vec<u64> {
        if currencies.len() != amounts.len() {
            panic_with_error!(&env, DividendError::LengthMismatch);
        }

        let mut ids = Vec::<u64>::new(&env);
        let mut i: u32 = 0;
        while i < currencies.len() {
            let currency = currencies.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            let distribution_id = Self::create_distribution(
                env.clone(),
                auth.clone(),
                token_address.clone(),
                currency,
                amount,
                claim_deadline,
                metadata.clone(),
            );
            ids.push_back(distribution_id);
            i += 1;
        }
        ids
    }

    pub fn auto_yield_distribute(
        env: Env,
        auth: Address,
        token_address: Address,
        currencies: Vec<Symbol>,
        amounts: Vec<i128>,
        claim_deadline: u64,
        metadata: Map<Symbol, Symbol>,
    ) -> Vec<u64> {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let config: DividendConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::ConfigNotFound); });

        if !config.auto_distribute {
            panic_with_error!(&env, DividendError::AutoDistributionDisabled);
        }

        let now = env.ledger().timestamp();
        let last: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "last_auto_distribution_at"))
            .unwrap_or(0u64);

        if last > 0 && now.saturating_sub(last) < config.max_distribution_frequency {
            panic_with_error!(&env, DividendError::YieldCadenceNotReached);
        }

        let ids = Self::multi_ccy_distributions(
            env.clone(),
            auth.clone(),
            token_address,
            currencies,
            amounts,
            claim_deadline,
            metadata,
        );

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "last_auto_distribution_at"), &now);

        ids
    }

    pub fn create_distribution(
        env: Env,
        auth: Address,
        token_address: Address,
        currency: Symbol,
        amount: i128,
        claim_deadline: u64,
        metadata: Map<Symbol, Symbol>,
    ) -> u64 {
        if amount <= 0 {
            panic_with_error!(&env, DividendError::InvalidAmount);
        }

        if claim_deadline <= env.ledger().timestamp() {
            panic_with_error!(&env, DividendError::InvalidParameters);
        }

        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let config: DividendConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::ConfigNotFound); });

        if !config
            .supported_currencies
            .iter()
            .any(|c| c.clone() == currency)
        {
            panic_with_error!(&env, DividendError::UnsupportedCurrency);
        }

        if amount < config.min_distribution_amount {
            panic_with_error!(&env, DividendError::InvalidAmount);
        }

        let rwa_client = RWATokenClient::new(&env, &token_address);
        let total_supply = rwa_client.get_token_info().total_supply;

        if total_supply == 0 {
            panic_with_error!(&env, DividendError::ZeroTotalSupply);
        }

        let per_token_amount = (amount * 1000000000000000000i128) / total_supply;

        let distribution_count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distribution_count"))
            .unwrap_or(0u64);

        let distribution_id = distribution_count + 1;

        let distribution = DividendDistribution {
            distribution_id,
            token_address: token_address.clone(),
            currency: currency.clone(),
            total_amount: amount,
            per_token_amount,
            total_supply,
            claim_deadline,
            created_at: env.ledger().timestamp(),
            is_active: true,
            metadata,
        };

        let mut distributions: Vec<DividendDistribution> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distributions"))
            .unwrap_or(Vec::new(&env));

        distributions.push_back(distribution);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "distributions"), &distributions);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "distribution_count"), &distribution_id);

        let currency_token_address =
            Self::get_currency_token_address(env.clone(), currency.clone());
        let currency_client = TokenClient::new(&env, &currency_token_address);

        currency_client.transfer(&admin, &env.current_contract_address(), &amount);

        env.events().publish(
            (Symbol::new(&env, "distribution_created"), token_address),
            (distribution_id, amount, currency, env.ledger().timestamp()),
        );

        distribution_id
    }

    pub fn claim_dividend(env: Env, distribution_id: u64, claimer: Address) -> i128 {
        Self::check_version(&env);

        let distributions: Vec<DividendDistribution> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distributions"))
            .unwrap_or(Vec::new(&env));

        let mut found_dist: Option<DividendDistribution> = None;
        for d in distributions.iter() {
            if d.distribution_id == distribution_id {
                found_dist = Some(d.clone());
                break;
            }
        }
        let distribution = found_dist.unwrap_or_else(|| { panic_with_error!(&env, DividendError::DistributionNotFound); });

        if !distribution.is_active {
            panic_with_error!(&env, DividendError::DistributionNotActive);
        }

        let current_time = env.ledger().timestamp();
        if current_time > distribution.claim_deadline {
            panic_with_error!(&env, DividendError::DistributionNotActive);
        }

        let ck = ClaimKey {
            distribution_id,
            claimer: claimer.clone(),
        };
        if env.storage().instance().has(&ck) {
            panic_with_error!(&env, DividendError::AlreadyClaimed);
        }

        let rwa_client = RWATokenClient::new(&env, &distribution.token_address);
        let balance = rwa_client.get_balance(&claimer).amount;

        if balance == 0 {
            panic_with_error!(&env, DividendError::NoTokensToClaim);
        }

        let claimable_amount = (balance * distribution.per_token_amount) / 1000000000000000000i128;

        if claimable_amount <= 0 {
            panic_with_error!(&env, DividendError::NoDividendAvailable);
        }

        let config: DividendConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::ConfigNotFound); });

        let fee_amount = (claimable_amount * config.fee_rate as i128) / 10000i128;
        let net_amount = claimable_amount - fee_amount;

        let dist_currency = distribution.currency.clone();
        let currency_token_address =
            Self::get_currency_token_address(env.clone(), dist_currency.clone());
        let currency_client = TokenClient::new(&env, &currency_token_address);

        currency_client.transfer(&env.current_contract_address(), &claimer, &net_amount);

        if fee_amount > 0 {
            currency_client.transfer(
                &env.current_contract_address(),
                &config.fee_recipient,
                &fee_amount,
            );
        }

        let claim_info = ClaimInfo {
            distribution_id,
            claimer: claimer.clone(),
            amount_claimed: net_amount,
            claimed_at: current_time,
            currency: dist_currency.clone(),
        };

        env.storage().instance().set(&ck, &claim_info);

        let tot_key = Symbol::new(&env, "clm_tot");
        let mut totals: Map<u64, i128> = env
            .storage()
            .instance()
            .get(&tot_key)
            .unwrap_or(Map::new(&env));
        let prev = totals.get(distribution_id).unwrap_or(0i128);
        totals.set(distribution_id, prev + net_amount);
        env.storage().instance().set(&tot_key, &totals);

        env.events().publish(
            (Symbol::new(&env, "dividend_claimed"), claimer),
            (distribution_id, net_amount, dist_currency, current_time),
        );

        net_amount
    }

    pub fn claim_all_dividends(env: Env, claimer: Address) -> Vec<i128> {
        let distributions: Vec<DividendDistribution> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distributions"))
            .unwrap_or(Vec::new(&env));

        let mut claimed_amounts = Vec::<i128>::new(&env);
        let current_time = env.ledger().timestamp();

        for distribution in distributions.iter() {
            if distribution.is_active && current_time <= distribution.claim_deadline {
                let ck = ClaimKey {
                    distribution_id: distribution.distribution_id,
                    claimer: claimer.clone(),
                };
                if !env.storage().instance().has(&ck) {
                    let available = Self::calculate_available_dividend(
                        env.clone(),
                        distribution.distribution_id,
                        claimer.clone(),
                    );
                    if available > 0 {
                        let claimed = Self::claim_dividend(
                            env.clone(),
                            distribution.distribution_id,
                            claimer.clone(),
                        );
                        claimed_amounts.push_back(claimed);
                    }
                }
            }
        }

        claimed_amounts
    }

    pub fn get_distribution(env: Env, distribution_id: u64) -> DividendDistribution {
        let distributions: Vec<DividendDistribution> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distributions"))
            .unwrap_or(Vec::new(&env));

        for d in distributions.iter() {
            if d.distribution_id == distribution_id {
                return d.clone();
            }
        }
        panic_with_error!(&env, DividendError::DistributionNotFound)
    }

    pub fn get_active_distributions(env: Env, token_address: Address) -> Vec<DividendDistribution> {
        let distributions: Vec<DividendDistribution> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distributions"))
            .unwrap_or(Vec::new(&env));

        let mut active_distributions = Vec::<DividendDistribution>::new(&env);
        let current_time = env.ledger().timestamp();

        for distribution in distributions.iter() {
            if distribution.token_address == token_address
                && distribution.is_active
                && current_time <= distribution.claim_deadline
            {
                active_distributions.push_back(distribution.clone());
            }
        }

        active_distributions
    }

    pub fn get_claim_info(env: Env, distribution_id: u64, claimer: Address) -> Option<ClaimInfo> {
        let ck = ClaimKey {
            distribution_id,
            claimer,
        };
        env.storage().instance().get(&ck)
    }

    pub fn calculate_available_dividend(env: Env, distribution_id: u64, claimer: Address) -> i128 {
        let distributions: Vec<DividendDistribution> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distributions"))
            .unwrap_or(Vec::new(&env));

        let mut found_dist: Option<DividendDistribution> = None;
        for d in distributions.iter() {
            if d.distribution_id == distribution_id {
                found_dist = Some(d.clone());
                break;
            }
        }
        let distribution = match found_dist {
            Some(d) => d,
            None => panic_with_error!(&env, DividendError::DistributionNotFound),
        };

        if !distribution.is_active {
            return 0;
        }

        let current_time = env.ledger().timestamp();
        if current_time > distribution.claim_deadline {
            return 0;
        }

        let ck = ClaimKey {
            distribution_id,
            claimer: claimer.clone(),
        };
        if env.storage().instance().has(&ck) {
            return 0;
        }

        let rwa_client = RWATokenClient::new(&env, &distribution.token_address);
        let balance = rwa_client.get_balance(&claimer).amount;

        if balance == 0 {
            return 0;
        }

        let claimable_amount = (balance * distribution.per_token_amount) / 1000000000000000000i128;

        let config: DividendConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::ConfigNotFound); });

        let fee_amount = (claimable_amount * config.fee_rate as i128) / 10000i128;
        claimable_amount - fee_amount
    }

    pub fn update_config(env: Env, auth: Address, config: DividendConfig) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "config"), &config);
    }

    pub fn deactivate_distribution(env: Env, auth: Address, distribution_id: u64) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let distributions: Vec<DividendDistribution> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "distributions"))
            .unwrap_or(Vec::new(&env));

        let mut found = false;
        let mut new_distributions = Vec::<DividendDistribution>::new(&env);

        for distribution in distributions.iter() {
            if distribution.distribution_id == distribution_id {
                let mut u = distribution.clone();
                u.is_active = false;
                new_distributions.push_back(u);
                found = true;
            } else {
                new_distributions.push_back(distribution.clone());
            }
        }

        if found {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "distributions"), &new_distributions);
        }
    }

    fn get_currency_token_address(env: Env, currency: Symbol) -> Address {
        let map: Map<Symbol, Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "currency_tokens"))
            .unwrap_or(Map::new(&env));

        map.get(currency)
            .unwrap_or_else(|| { panic_with_error!(&env, DividendError::UnsupportedCurrency); })
    }
}
