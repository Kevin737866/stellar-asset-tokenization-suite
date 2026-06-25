use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, Map, Symbol, Vec,
};

use crate::auth::assert_admin;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ComplianceError {
    Unauthorized = 1,
    UserNotFound = 2,
    KYCNotVerified = 3,
    Blacklisted = 4,
    InvalidJurisdiction = 5,
    AccreditationRequired = 6,
    TransferLimitExceeded = 7,
}

#[contracttype]
#[derive(Clone)]
pub struct KYCStatus {
    pub is_verified: bool,
    pub verification_level: u32,
    pub expiry_date: u64,
    pub jurisdiction: Symbol,
    pub is_accredited: bool,
    pub risk_score: u32,
    pub aml_flags: Vec<Symbol>,
}

#[contracttype]
#[derive(Clone)]
pub struct TransferLimits {
    pub daily_limit: i128,
    pub monthly_limit: i128,
    pub annual_limit: i128,
    pub remaining_daily: i128,
    pub remaining_monthly: i128,
    pub remaining_annual: i128,
    pub last_reset_daily: u64,
    pub last_reset_monthly: u64,
    pub last_reset_annual: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ComplianceRule {
    pub rule_id: Symbol,
    pub name: Symbol,
    pub description: Symbol,
    pub is_active: bool,
    pub jurisdictions: Vec<Symbol>,
    pub min_verification_level: u32,
    pub requires_accreditation: bool,
    pub max_amount: i128,
}

// ... (around line 58)
#[contract]
pub struct ComplianceRegistry;

pub struct ComplianceRegistryClient<'a> {
    env: &'a Env,
    id: Address,
}

impl<'a> ComplianceRegistryClient<'a> {
    pub fn new(env: &'a Env, id: &Address) -> Self {
        Self { env, id: id.clone() }
    }

    pub fn initialize(&self, auth: &Address, admin: &Address, kyc_required: bool, transfer_restrictions: bool) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "initialize"), &(auth, admin, kyc_required, transfer_restrictions));
    }

    pub fn update_kyc_status(&self, auth: &Address, user: &Address, kyc_status: KYCStatus) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "update_kyc_status"), &(auth, user, kyc_status));
    }

    pub fn get_kyc_status(&self, user: &Address) -> KYCStatus {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "get_kyc_status"), &(user))
    }

    pub fn add_to_blacklist(&self, auth: &Address, address: &Address, reason: Symbol) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "add_to_blacklist"), &(auth, address, reason));
    }

    pub fn remove_from_blacklist(&self, auth: &Address, address: &Address) {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "remove_from_blacklist"), &(auth, address));
    }

    pub fn check_compliance(&self, from: &Address, to: &Address, amount: i128) -> bool {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "check_compliance"), &(from, to, amount))
    }

    pub fn check_outbound_participant(&self, participant: &Address, amount: i128) -> bool {
        self.env.invoke_contract(self.id.clone(), &Symbol::new(self.env, "check_outbound_participant"), &(participant, amount))
    }
}

#[contractimpl]
impl ComplianceRegistry {
// ...

    pub fn initialize(
        env: Env,
        auth: Address,
        admin: Address,
        kyc_required: bool,
        transfer_restrictions: bool,
    ) {
        auth.require_auth();
        if env
            .storage()
            .instance()
            .has(&Symbol::new(&env, "initialized"))
        {
            panic!("Registry already initialized");
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "kyc_required"), &kyc_required);
        env.storage().instance().set(
            &Symbol::new(&env, "transfer_restrictions"),
            &transfer_restrictions,
        );
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "initialized"), &true);

        let mut rules = Vec::<ComplianceRule>::new(&env);

        let mut jur_us_144 = Vec::<Symbol>::new(&env);
        jur_us_144.push_back(Symbol::new(&env, "US"));

        rules.push_back(ComplianceRule {
            rule_id: Symbol::new(&env, "rule_144"),
            name: Symbol::new(&env, "SEC Rule 144"),
            description: Symbol::new(&env, "Restricted securities resale limitations"),
            is_active: true,
            jurisdictions: jur_us_144,
            min_verification_level: 2,
            requires_accreditation: true,
            max_amount: 1000000,
        });

        let mut jur_us_d = Vec::<Symbol>::new(&env);
        jur_us_d.push_back(Symbol::new(&env, "US"));

        rules.push_back(ComplianceRule {
            rule_id: Symbol::new(&env, "reg_d"),
            name: Symbol::new(&env, "Regulation D"),
            description: Symbol::new(&env, "Private placement exemptions"),
            is_active: true,
            jurisdictions: jur_us_d,
            min_verification_level: 2,
            requires_accreditation: true,
            max_amount: 50000000,
        });

        let mut jur_non_us = Vec::<Symbol>::new(&env);
        jur_non_us.push_back(Symbol::new(&env, "EU"));
        jur_non_us.push_back(Symbol::new(&env, "UK"));
        jur_non_us.push_back(Symbol::new(&env, "JP"));

        rules.push_back(ComplianceRule {
            rule_id: Symbol::new(&env, "reg_s"),
            name: Symbol::new(&env, "Regulation S"),
            description: Symbol::new(&env, "Non-US offerings"),
            is_active: true,
            jurisdictions: jur_non_us,
            min_verification_level: 1,
            requires_accreditation: false,
            max_amount: i128::MAX,
        });

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "compliance_rules"), &rules);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "blacklist"), &Vec::<Address>::new(&env));
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "whitelist"), &Vec::<Address>::new(&env));
        env.storage().instance().set(
            &Symbol::new(&env, "xfer_lim"),
            &Map::<Address, TransferLimits>::new(&env),
        );
    }

    pub fn update_kyc_status(env: Env, auth: Address, user: Address, kyc_status: KYCStatus) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Registry not initialized"));

        assert_admin(&auth, &admin);

        env.storage().instance().set(&user, &kyc_status);

        env.events().publish(
            (Symbol::new(&env, "kyc_updated"), user),
            (kyc_status.is_verified, kyc_status.verification_level),
        );
    }

    pub fn get_kyc_status(env: Env, user: Address) -> KYCStatus {
        env.storage().instance().get(&user).unwrap_or(KYCStatus {
            is_verified: false,
            verification_level: 0,
            expiry_date: 0,
            jurisdiction: Symbol::new(&env, "UNKNOWN"),
            is_accredited: false,
            risk_score: 5,
            aml_flags: Vec::new(&env),
        })
    }

    pub fn add_to_blacklist(env: Env, auth: Address, address: Address, reason: Symbol) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Registry not initialized"));

        assert_admin(&auth, &admin);

        let mut blacklist: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "blacklist"))
            .unwrap_or(Vec::new(&env));

        blacklist.push_back(address.clone());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "blacklist"), &blacklist);

        env.events()
            .publish((Symbol::new(&env, "blacklisted"), address), reason);
    }

    pub fn remove_from_blacklist(env: Env, auth: Address, address: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Registry not initialized"));

        assert_admin(&auth, &admin);

        let blacklist: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "blacklist"))
            .unwrap_or(Vec::new(&env));

        let mut new_blacklist = Vec::<Address>::new(&env);
        let mut found = false;
        for addr in blacklist.iter() {
            if addr.clone() == address {
                found = true;
            } else {
                new_blacklist.push_back(addr.clone());
            }
        }

        if found {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "blacklist"), &new_blacklist);
            env.events().publish(
                (Symbol::new(&env, "unblacklisted"), address),
                Symbol::new(&env, "removed"),
            );
        }
    }

    pub fn add_to_whitelist(env: Env, auth: Address, address: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Registry not initialized"));

        assert_admin(&auth, &admin);

        let mut whitelist: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "whitelist"))
            .unwrap_or(Vec::new(&env));

        whitelist.push_back(address.clone());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "whitelist"), &whitelist);

        env.events().publish(
            (Symbol::new(&env, "whitelisted"), address),
            Symbol::new(&env, "added"),
        );
    }

    pub fn remove_from_whitelist(env: Env, auth: Address, address: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Registry not initialized"));

        assert_admin(&auth, &admin);

        let whitelist: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "whitelist"))
            .unwrap_or(Vec::new(&env));

        let mut new_whitelist = Vec::<Address>::new(&env);
        let mut found = false;
        for addr in whitelist.iter() {
            if addr.clone() == address {
                found = true;
            } else {
                new_whitelist.push_back(addr.clone());
            }
        }

        if found {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "whitelist"), &new_whitelist);
            env.events().publish(
                (Symbol::new(&env, "unwhitelisted"), address),
                Symbol::new(&env, "removed"),
            );
        }
    }

    pub fn check_compliance(env: Env, from: Address, to: Address, amount: i128) -> bool {
        let kyc_required: bool = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "kyc_required"))
            .unwrap_or(true);

        let blacklist: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "blacklist"))
            .unwrap_or(Vec::new(&env));

        for addr in blacklist.iter() {
            if addr.clone() == from || addr.clone() == to {
                return false;
            }
        }

        if kyc_required {
            let whitelist: Vec<Address> = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "whitelist"))
                .unwrap_or(Vec::new(&env));

            let from_whitelisted = whitelist.iter().any(|a| a.clone() == from);
            let to_whitelisted = whitelist.iter().any(|a| a.clone() == to);

            if !from_whitelisted || !to_whitelisted {
                let from_kyc = Self::get_kyc_status(env.clone(), from.clone());
                let to_kyc = Self::get_kyc_status(env.clone(), to.clone());

                if !from_kyc.is_verified || !to_kyc.is_verified {
                    return false;
                }

                let current_time = env.ledger().timestamp();
                if from_kyc.expiry_date < current_time || to_kyc.expiry_date < current_time {
                    return false;
                }
            }
        }

        let transfer_restrictions: bool = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "transfer_restrictions"))
            .unwrap_or(false);

        if transfer_restrictions && !Self::check_transfer_limits(env.clone(), from.clone(), amount)
        {
            return false;
        }

        if !Self::evaluate_regulatory_rules(env.clone(), from.clone(), to.clone(), amount) {
            return false;
        }

        true
    }

    fn evaluate_regulatory_rules(env: Env, from: Address, to: Address, amount: i128) -> bool {
        let rules: Vec<ComplianceRule> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "compliance_rules"))
            .unwrap_or(Vec::new(&env));

        let from_kyc = Self::get_kyc_status(env.clone(), from);
        let to_kyc = Self::get_kyc_status(env.clone(), to);
        let from_jurisdiction = from_kyc.jurisdiction.clone();
        let to_jurisdiction = to_kyc.jurisdiction.clone();

        for rule in rules.iter() {
            if !rule.is_active {
                continue;
            }

            if !Self::rule_applies_to_transfer(
                &env,
                &rule,
                from_jurisdiction.clone(),
                to_jurisdiction.clone(),
            ) {
                continue;
            }

            if from_kyc.verification_level < rule.min_verification_level
                || to_kyc.verification_level < rule.min_verification_level
            {
                return false;
            }

            if rule.requires_accreditation && (!from_kyc.is_accredited || !to_kyc.is_accredited) {
                return false;
            }

            if amount > rule.max_amount {
                return false;
            }
        }

        true
    }

    fn rule_applies_to_transfer(
        env: &Env,
        rule: &ComplianceRule,
        from_jurisdiction: Symbol,
        to_jurisdiction: Symbol,
    ) -> bool {
        for j in rule.jurisdictions.iter() {
            if j == from_jurisdiction || j == to_jurisdiction {
                return true;
            }
        }
        let unknown = Symbol::new(env, "UNKNOWN");
        if from_jurisdiction == unknown || to_jurisdiction == unknown {
            return rule.jurisdictions.len() > 0;
        }
        false
    }

    pub fn check_outbound_participant(env: Env, participant: Address, amount: i128) -> bool {
        let blacklist: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "blacklist"))
            .unwrap_or(Vec::new(&env));

        for addr in blacklist.iter() {
            if addr.clone() == participant {
                return false;
            }
        }

        let kyc_required: bool = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "kyc_required"))
            .unwrap_or(true);

        if kyc_required {
            let kyc = Self::get_kyc_status(env.clone(), participant.clone());
            if !kyc.is_verified {
                return false;
            }
            let current_time = env.ledger().timestamp();
            if kyc.expiry_date < current_time {
                return false;
            }
        }

        let transfer_restrictions: bool = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "transfer_restrictions"))
            .unwrap_or(false);

        if transfer_restrictions
            && !Self::check_transfer_limits(env.clone(), participant.clone(), amount)
        {
            return false;
        }

        true
    }

    pub fn check_transfer_limits(env: Env, user: Address, amount: i128) -> bool {
        let map_key = Symbol::new(&env, "xfer_lim");
        let mut map: Map<Address, TransferLimits> = env
            .storage()
            .instance()
            .get(&map_key)
            .unwrap_or(Map::new(&env));

        let mut limits: TransferLimits = map.get(user.clone()).unwrap_or(TransferLimits {
            daily_limit: 10000,
            monthly_limit: 100000,
            annual_limit: 1000000,
            remaining_daily: 10000,
            remaining_monthly: 100000,
            remaining_annual: 1000000,
            last_reset_daily: 0,
            last_reset_monthly: 0,
            last_reset_annual: 0,
        });

        let current_time = env.ledger().timestamp();
        let day_in_seconds = 86400;
        let month_in_seconds = 30 * day_in_seconds;
        let year_in_seconds = 365 * day_in_seconds;

        if current_time - limits.last_reset_daily >= day_in_seconds {
            limits.remaining_daily = limits.daily_limit;
            limits.last_reset_daily = current_time;
        }

        if current_time - limits.last_reset_monthly >= month_in_seconds {
            limits.remaining_monthly = limits.monthly_limit;
            limits.last_reset_monthly = current_time;
        }

        if current_time - limits.last_reset_annual >= year_in_seconds {
            limits.remaining_annual = limits.annual_limit;
            limits.last_reset_annual = current_time;
        }

        if amount > limits.remaining_daily
            || amount > limits.remaining_monthly
            || amount > limits.remaining_annual
        {
            return false;
        }

        limits.remaining_daily -= amount;
        limits.remaining_monthly -= amount;
        limits.remaining_annual -= amount;

        map.set(user, limits);
        env.storage().instance().set(&map_key, &map);
        true
    }

    pub fn set_transfer_limits(env: Env, auth: Address, user: Address, limits: TransferLimits) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Registry not initialized"));

        assert_admin(&auth, &admin);

        let map_key = Symbol::new(&env, "xfer_lim");
        let mut map: Map<Address, TransferLimits> = env
            .storage()
            .instance()
            .get(&map_key)
            .unwrap_or(Map::new(&env));
        map.set(user, limits);
        env.storage().instance().set(&map_key, &map);
    }

    pub fn get_compliance_rules(env: Env) -> Vec<ComplianceRule> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "compliance_rules"))
            .unwrap_or(Vec::new(&env))
    }

    pub fn update_compliance_rule(env: Env, auth: Address, rule: ComplianceRule) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| panic!("Registry not initialized"));

        assert_admin(&auth, &admin);

        let rules: Vec<ComplianceRule> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "compliance_rules"))
            .unwrap_or(Vec::new(&env));

        let mut found = false;
        let mut new_rules = Vec::<ComplianceRule>::new(&env);
        for existing_rule in rules.iter() {
            if existing_rule.rule_id == rule.rule_id {
                new_rules.push_back(rule.clone());
                found = true;
            } else {
                new_rules.push_back(existing_rule.clone());
            }
        }

        if found {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "compliance_rules"), &new_rules);
        }
    }
}
