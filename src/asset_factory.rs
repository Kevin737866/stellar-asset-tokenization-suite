use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Map, Symbol, Vec, BytesN, String,
};

use crate::rwa_token::RWATokenClient;
use crate::RwaDeploySpec;
use crate::auth::assert_admin;

const STORAGE_VERSION: u32 = 1;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AssetFactoryError {
    InvalidParameters = 1,
    Unauthorized = 2,
    AssetAlreadyExists = 3,
    ComplianceCheckFailed = 4,
    AssetNotFound = 5,
    UpgradeNotApproved = 6,
    TemplateNotFound = 7,
    GovernanceThresholdNotMet = 8,
    AlreadyInitialized = 9,
    TemplateNotActive = 10,
    NotInitialized = 11,
    Overflow = 12,
    StorageOutdated = 13,
    AlreadyAtLatestVersion = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum AssetClass {
    RealEstate = 0,
    Commodity = 1,
    Invoice = 2,
    Security = 3,
    Art = 4,
    CarbonCredit = 5,
}

#[contracttype]
#[derive(Clone)]
pub struct ComplianceRules {
    pub kyc_required: bool,
    pub accredited_investor_only: bool,
    pub geographic_restrictions: Vec<Symbol>,
    pub holding_period_days: u32,
    pub transfer_limits: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct DividendSchedule {
    pub frequency_days: u32,
    pub next_distribution_date: u64,
    pub total_distributed: i128,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct AssetConfig {
    pub name: Symbol,
    pub symbol: Symbol,
    pub decimals: u32,
    pub total_supply: i128,
    pub asset_class: AssetClass,
    pub compliance_rules: ComplianceRules,
    pub dividend_schedule: Option<DividendSchedule>,
    pub metadata: Map<Symbol, String>,
}

#[contracttype]
#[derive(Clone)]
pub struct AssetTemplate {
    pub asset_class: AssetClass,
    pub base_config: AssetConfig,
    pub wasm_hash: BytesN<32>,
    pub is_active: bool,
    pub version: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct AssetInfo {
    pub name: Symbol,
    pub symbol: Symbol,
    pub total_supply: i128,
    pub decimals: u32,
    pub asset_class: AssetClass,
    pub metadata: Map<Symbol, String>,
    pub compliance_registry: Address,
    pub dividend_distributor: Address,
    pub token_address: Address,
    pub created_at: u64,
    pub is_paused: bool,
    pub template_version: u32,
    pub upgrade_proposals: Vec<Address>,
}

#[contract]
pub struct AssetFactory;

#[contractimpl]
impl AssetFactory {
    pub fn initialize(env: Env, auth: Address, admin: Address) {
        crate::shared_admin::write_admin(&env, &auth, &admin);
        
        auth.require_auth();
        if env.storage().instance().has(&Symbol::new(&env, "admin")) {
            panic_with_error!(&env, AssetFactoryError::AlreadyInitialized);
        }
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &admin);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "asset_count"), &0u32);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "templates"), &Map::<AssetClass, AssetTemplate>::new(&env));
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "registry"), &Map::<Symbol, AssetInfo>::new(&env));
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &STORAGE_VERSION);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "governance_threshold"), &6600u32); // 66% in basis points

        env.events().publish(
            (Symbol::new(&env, "factory_initialized"), auth),
            admin,
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
            panic_with_error!(env, AssetFactoryError::StorageOutdated);
        }
    }

    pub fn migrate(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        let ver = Self::read_version(&env);
        if ver >= STORAGE_VERSION {
            panic_with_error!(&env, AssetFactoryError::AlreadyAtLatestVersion);
        }

        let mut current = ver;
        while current < STORAGE_VERSION {
            current += 1;
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &STORAGE_VERSION);
    }

    /// Create a new RWA asset with deterministic address deployment
    pub fn create_asset(env: Env, auth: Address, config: AssetConfig) -> Address {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        // Validate parameters
        if config.total_supply <= 0 || config.decimals > 18 {
            panic_with_error!(&env, AssetFactoryError::InvalidParameters);
        }

        // Validate compliance rules
        if config.compliance_rules.transfer_limits < 0 {
            panic_with_error!(&env, AssetFactoryError::InvalidParameters);
        }

        // Validate dividend schedule if present
        if let Some(schedule) = &config.dividend_schedule {
            if schedule.frequency_days == 0 || schedule.next_distribution_date < env.ledger().timestamp() {
                panic_with_error!(&env, AssetFactoryError::InvalidParameters);
            }
            if schedule.total_distributed < 0 {
                panic_with_error!(&env, AssetFactoryError::InvalidParameters);
            }
        }

        // Check if asset already exists
        let registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));
        
        if registry.has(&config.symbol) {
            panic_with_error!(&env, AssetFactoryError::AssetAlreadyExists);
        }

        // Get template for asset class
        let templates: Map<AssetClass, AssetTemplate> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "templates"))
            .unwrap_or(Map::new(&env));
        
        let template = templates.get(config.asset_class.clone())
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::TemplateNotFound); });
        
        if !template.is_active {
            panic_with_error!(&env, AssetFactoryError::TemplateNotActive);
        }

        // Validate asset class symbol
        let asset_class_str = format!("{:?}", config.asset_class);
        if !is_valid_symbol(&asset_class_str) {
            panic_with_error!(&env, AssetFactoryError::InvalidParameters);
        }
        let asset_type_sym = Symbol::new(&env, &asset_class_str);

        // Deploy token with deterministic address using salt
        let salt = env.crypto().sha256(&(
            &config.symbol,
            &config.name,
            &env.ledger().timestamp()
        ).into());
        
        let token_address = env.deployer()
            .with_current_contract(salt)
            .deploy_v2(template.wasm_hash);

        // Initialize token
        let token_client = RWATokenClient::new(&env, &token_address);
        token_client.initialize(
            &auth,
            &config.name,
            &config.symbol,
            &config.total_supply,
            &config.decimals,
            &asset_type_sym,
            &config.metadata,
            &Address::from_contract_id(&[0u8; 32]), // Placeholder compliance registry
            &Address::from_contract_id(&[0u8; 32]), // Placeholder dividend distributor
        );

        // Create asset info
        let asset_info = AssetInfo {
            name: config.name,
            symbol: config.symbol,
            total_supply: config.total_supply,
            decimals: config.decimals,
            asset_class: config.asset_class,
            metadata: config.metadata.clone(),
            compliance_registry: Address::from_contract_id(&[0u8; 32]),
            dividend_distributor: Address::from_contract_id(&[0u8; 32]),
            token_address: token_address.clone(),
            created_at: env.ledger().timestamp(),
            is_paused: false,
            template_version: template.version,
            upgrade_proposals: Vec::new(&env),
        };

        // Update registry — single source of truth for all asset data
        let mut registry = registry;
        registry.set(config.symbol, asset_info);
        env.storage().instance().set(&Symbol::new(&env, "registry"), &registry);

        token_address
    }

    /// Link and initialize a `token_contract` that was already deployed on-chain.
    pub fn deploy_rwa_token(env: Env, auth: Address, spec: RwaDeploySpec) -> Address {
        if spec.total_supply <= 0 || spec.decimals > 18 {
            panic_with_error!(&env, AssetFactoryError::InvalidParameters);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let token_client = RWATokenClient::new(&env, &spec.token_contract);
        token_client.initialize(
            &auth,
            &spec.asset_name,
            &spec.asset_symbol,
            &spec.total_supply,
            &spec.decimals,
            &spec.asset_type,
            &spec.metadata,
            &spec.compliance_registry,
            &spec.dividend_distributor,
        );

        let asset_info = AssetInfo {
            name: spec.asset_name,
            symbol: spec.asset_symbol.clone(),
            total_supply: spec.total_supply,
            decimals: spec.decimals,
            asset_class: AssetClass::Security, // default; caller should use create_asset for typed classes
            metadata: spec.metadata.clone(),
            compliance_registry: spec.compliance_registry,
            dividend_distributor: spec.dividend_distributor,
            token_address: spec.token_contract.clone(),
            created_at: env.ledger().timestamp(),
            is_paused: false,
            template_version: 0,
            upgrade_proposals: Vec::new(&env),
        };

        // Write into the registry Map — single source of truth
        let mut registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));

        if registry.has(&spec.asset_symbol) {
            panic_with_error!(&env, AssetFactoryError::AssetAlreadyExists);
        }

        registry.set(spec.asset_symbol, asset_info);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "registry"), &registry);

        spec.token_contract
    }

    pub fn get_asset_info(env: Env, symbol: Symbol) -> AssetInfo {
        let registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));

        registry
            .get(symbol)
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::AssetNotFound); })
    }

    /// List all assets in the registry
    pub fn list_assets(env: Env) -> Vec<AssetInfo> {
        let registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));

        let mut result = Vec::<AssetInfo>::new(&env);
        for (_symbol, asset_info) in registry.iter() {
            result.push_back(asset_info);
        }
        result
    }

    pub fn set_asset_pause_status(env: Env, auth: Address, symbol: Symbol, paused: bool) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));

        let mut asset_info = registry
            .get(symbol.clone())
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::AssetNotFound); });

        asset_info.is_paused = paused;
        registry.set(symbol.clone(), asset_info);
        env.storage().instance().set(&Symbol::new(&env, "registry"), &registry);

        env.events().publish(
            (Symbol::new(&env, "asset_pause_status_changed"), symbol, auth),
            paused,
        );
    }

    pub fn update_admin(env: Env, auth: Address, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "admin"), &new_admin);

        env.events().publish(
            (Symbol::new(&env, "factory_admin_updated"), auth),
            new_admin,
        );
    }

    /// Register a new template for an asset class
    pub fn register_template(env: Env, auth: Address, template: AssetTemplate) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut templates: Map<AssetClass, AssetTemplate> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "templates"))
            .unwrap_or(Map::new(&env));
        
        templates.set(template.asset_class, template);
        env.storage().instance().set(&Symbol::new(&env, "templates"), &templates);

        env.events().publish(
            (Symbol::new(&env, "template_registered"), auth),
            (template.asset_class, template.version, template.is_active),
        );
    }

    /// Get template for a specific asset class
    pub fn get_template(env: Env, asset_class: AssetClass) -> AssetTemplate {
        let templates: Map<AssetClass, AssetTemplate> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "templates"))
            .unwrap_or(Map::new(&env));
        
        templates.get(asset_class)
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::TemplateNotFound); })
    }

    /// Upgrade an asset with governance approval
    pub fn upgrade_asset(env: Env, auth: Address, symbol: Symbol, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));
        
        let mut asset_info = registry.get(symbol.clone())
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::AssetNotFound); });

        // Check governance threshold (simplified - in real implementation would check token holder votes)
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "governance_threshold"))
            .unwrap_or(6600u32);

        // For now, assume admin approval meets threshold
        // In production, this would involve actual voting mechanism

        // Deploy new contract version
        let salt = env.crypto().sha256(&(
            &symbol,
            &asset_info.name,
            &env.ledger().timestamp(),
            &new_wasm_hash
        ).into());
        
        let new_token_address = env.deployer()
            .with_current_contract(salt)
            .deploy_v2(new_wasm_hash);

        // Update asset info
        asset_info.token_address = new_token_address;
        asset_info.template_version = asset_info.template_version
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, AssetFactoryError::Overflow));

        // Update registry
        let mut registry = registry;
        registry.set(symbol.clone(), asset_info);
        env.storage().instance().set(&Symbol::new(&env, "registry"), &registry);

        env.events().publish(
            (Symbol::new(&env, "asset_upgraded"), symbol, auth),
            (new_token_address, asset_info.template_version),
        );
    }

    /// Emergency pause all assets
    pub fn emergency_pause_all(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| { panic_with_error!(&env, AssetFactoryError::NotInitialized); });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));

        let mut updated_registry = Map::<Symbol, AssetInfo>::new(&env);
        
        for (symbol, mut asset_info) in registry.iter() {
            asset_info.is_paused = true;
            updated_registry.set(symbol, asset_info);
        }

        env.storage().instance().set(&Symbol::new(&env, "registry"), &updated_registry);

        let count: u32 = registry.len();
        env.events().publish(
            (Symbol::new(&env, "emergency_pause_all"), auth),
            count,
        );
    }

    /// Get all assets from registry
    pub fn get_all_assets(env: Env) -> Map<Symbol, AssetInfo> {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env))
    }

    /// Get asset count
    pub fn get_asset_count(env: Env) -> u32 {
        let registry: Map<Symbol, AssetInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registry"))
            .unwrap_or(Map::new(&env));
        registry.len()
    }
}

pub fn is_valid_symbol(s: &str) -> bool {
    if s.is_empty() || s.len() > 32 {
        return false;
    }
    for c in s.chars() {
        if !c.is_ascii_alphanumeric() && c != '_' {
            return false;
        }
    }
    true
}
