use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN,
    Env, Map, Symbol, Vec,
};

use crate::auth::assert_admin;

const STORAGE_VERSION: u32 = 1;
#[contracttype]
pub enum StorageKey {
    Custodian(Address),
    Attestation(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum CustodyError {
    Unauthorized = 1,
    InvalidProof = 2,
    OracleOffline = 3,
    VerificationFailed = 4,
    AssetNotRegistered = 5,
    StaleData = 6,
    InvalidSignature = 7,
    DisputeAlreadyExists = 8,
    InsufficientBond = 9,
    DisputeNotFound = 10,
    InvalidDisputeStatus = 11,
    BondNotRefundable = 12,
    CustodianNotWhitelisted = 13,
    InvalidVerificationType = 14,
    ProofHashMismatch = 15,
    AttestationExpired = 16,
    MultiSigThresholdNotMet = 17,
    InvalidMerkleProof = 18,
    ZKVerificationFailed = 19,
    InsuranceClaimFailed = 20,
    AlreadyInitialized = 21,
    NotInitialized = 22,
    AttestationNotFound = 23,
    OracleNotFound = 24,
    ConfigNotFound = 25,
    StorageOutdated = 26,
    ValidatorNotInitialized = 27,
    AlreadyAtLatestVersion = 28,
    InvalidAttestation = 29,
    CustodianNotFound = 30,
    InvalidParameters = 31,
    MultiSigConfigNotFound = 32,
    DuplicateSigner = 33,
    SensorNotFound = 34,
    SensorInactive = 35,
    InvalidSensorData = 36,
    ThresholdNotFound = 37,
    BridgeNotFound = 38,
    BridgeAlreadyRegistered = 39,
    CrossChainProofNotFound = 40,
    InvalidCrossChainProof = 41,
}

#[contracttype]
#[derive(Clone)]
pub struct CustodyAttestation {
    pub asset_id: Address,
    pub custodian: Address,
    pub location: Symbol,
    pub condition: Symbol,
    pub value: i128,
    pub timestamp: u64,
    pub proof_hash: BytesN<32>,
    pub verification_type: Symbol,
    pub insurance_status: Symbol,
    pub legal_title_hash: BytesN<32>,
    pub audit_report_hash: BytesN<32>,
    pub multi_sig_signatures: Vec<BytesN<64>>,
    pub metadata: Map<Symbol, Symbol>,
    pub is_valid: bool,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct CustodianRegistry {
    pub custodian_address: Address,
    pub name: Symbol,
    pub jurisdiction: Symbol,
    pub license_number: Symbol,
    pub reputation_score: u32,
    pub verification_types: Vec<Symbol>,
    pub is_active: bool,
    pub total_attestations: u64,
    pub successful_disputes: u64,
    pub failed_disputes: u64,
    pub bond_required: i128,
    pub insurance_provider: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub struct CustodyProof {
    pub proof_id: u64,
    pub asset_address: Address,
    pub asset_type: Symbol,
    pub custody_provider: Address,
    pub verification_timestamp: u64,
    pub expiry_timestamp: u64,
    pub asset_value: i128,
    pub asset_location: Symbol,
    pub legal_title: Symbol,
    pub insurance_coverage: i128,
    pub audit_report_hash: BytesN<32>,
    pub oracle_signatures: Vec<BytesN<64>>,
    pub metadata: Map<Symbol, Symbol>,
    pub is_valid: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct OracleInfo {
    pub oracle_address: Address,
    pub name: Symbol,
    pub jurisdiction: Symbol,
    pub verification_methods: Vec<Symbol>,
    pub reputation_score: u32,
    pub fee_rate: i64,
    pub is_active: bool,
    pub last_verification: u64,
    pub total_verifications: u64,
    pub multi_sig_threshold: u32,
    pub auditor_type: Symbol,
    pub license_valid_until: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DisputeRecord {
    pub dispute_id: u64,
    pub attestation_id: u64,
    pub challenger: Address,
    pub custodian: Address,
    pub reason: Symbol,
    pub bond_amount: i128,
    pub evidence_hash: BytesN<32>,
    pub status: Symbol,
    pub created_at: u64,
    pub resolved_at: u64,
    pub resolution: Symbol,
    pub bond_returned: bool,
    pub penalty_applied: bool,
    pub penalty_amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct VerificationTypeConfig {
    pub verification_type: Symbol,
    pub required_documents: Vec<Symbol>,
    pub verification_frequency: u64,
    pub multi_sig_required: bool,
    pub sig_threshold: u32,
    pub insurance_required: bool,
    pub min_insurance_coverage: i128,
    pub iot_monitoring_required: bool,
    pub satellite_verification: bool,
    pub legal_verification_required: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct InsuranceIntegration {
    pub provider: Symbol,
    pub policy_number: Symbol,
    pub coverage_amount: i128,
    pub premium_amount: i128,
    pub valid_until: u64,
    pub claim_auto_trigger: bool,
    pub last_premium_paid: u64,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct AssetRegistration {
    pub asset_address: Address,
    pub asset_type: Symbol,
    pub legal_identifier: Symbol,
    pub jurisdiction: Symbol,
    pub custody_requirements: Vec<Symbol>,
    pub verification_frequency: u64,
    pub required_oracles: u32,
    pub last_verified: u64,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct ValidationConfig {
    pub min_oracle_reputation: u32,
    pub max_proof_age: u64,
    pub required_verification_methods: Vec<Symbol>,
    pub insurance_required: bool,
    pub min_insurance_coverage: i128,
    pub audit_required: bool,
    pub multi_oracle_required: bool,
    pub oracle_consensus_threshold: u32,
}

/// Issue #155: M-of-N multi-signature policy for a single custodian.
///
/// `signer_keys` holds the authorised Ed25519 public keys and `signer_addresses`
/// the matching account addresses (same order, used for event payloads). A
/// multi-signature attestation is only accepted when at least
/// `required_signatures` distinct authorised signers have produced a valid
/// Ed25519 signature over the attestation's proof hash.
#[contracttype]
#[derive(Clone)]
pub struct MultiSigConfig {
    pub required_signatures: u32,
    pub total_signers: u32,
    pub signer_keys: Vec<BytesN<32>>,
    pub signer_addresses: Vec<Address>,
}

/// Issue #157: a single IoT reading submitted for a custodied asset.
#[contracttype]
#[derive(Clone)]
pub struct IoTSensorData {
    pub sensor_id: Symbol,
    pub asset_id: Address,
    pub metric_type: Symbol,
    pub value: i128,
    pub timestamp: u64,
    pub signature: BytesN<64>,
}

/// Issue #157: an IoT sensor authorised to report on an asset.
#[contracttype]
#[derive(Clone)]
pub struct IoTSensorRegistration {
    pub sensor_id: Symbol,
    pub asset_id: Address,
    pub custodian: Address,
    pub metric_type: Symbol,
    pub is_active: bool,
}

/// Issue #157: alerting band for a metric type. Readings outside
/// `[min_value, max_value]` raise an alert.
#[contracttype]
#[derive(Clone)]
pub struct SensorThreshold {
    pub metric_type: Symbol,
    pub min_value: i128,
    pub max_value: i128,
}

/// Issue #159: custody proof for an asset held on another chain, anchored by a
/// registered bridge's Merkle root.
#[contracttype]
#[derive(Clone)]
pub struct CrossChainProof {
    pub proof_id: u64,
    pub source_chain: Symbol,
    pub block_number: u64,
    pub tx_hash: BytesN<32>,
    pub bridge_contract: Address,
    pub merkle_proof: Vec<BytesN<32>>,
    pub asset_id: Address,
    pub custodian: Address,
    pub timestamp: u64,
    pub is_valid: bool,
}

/// Issue #159: a supported source chain and the bridge that anchors it.
#[contracttype]
#[derive(Clone)]
pub struct BridgeRegistration {
    pub source_chain: Symbol,
    pub bridge_contract: Address,
    pub merkle_root: BytesN<32>,
    pub block_number: u64,
    pub is_active: bool,
}

/// Issue #158: how an upheld dispute is slashed and redistributed.
///
/// Shares are expressed in basis points and must sum to 10_000 (100%).
#[contracttype]
#[derive(Clone)]
pub struct SlashingConfig {
    pub challenger_share_bps: u32,
    pub insurance_share_bps: u32,
    pub platform_share_bps: u32,
    pub reputation_penalty_points: u32,
}

#[contract]
pub struct CustodyValidator;

#[contractimpl]
impl CustodyValidator {
    fn extend_custodian_ttl(env: &Env, address: &Address) {
        env.storage().persistent().extend_ttl(
            &StorageKey::Custodian(address.clone()),
            50000,
            535680,
        );
    }

    fn read_custodian(env: &Env, address: &Address) -> Option<CustodianRegistry> {
        let result = env
            .storage()
            .persistent()
            .get::<StorageKey, CustodianRegistry>(&StorageKey::Custodian(address.clone()));
        if result.is_some() {
            Self::extend_custodian_ttl(env, address);
        }
        result
    }

    fn write_custodian(env: &Env, address: &Address, custodian: &CustodianRegistry) {
        env.storage()
            .persistent()
            .set(&StorageKey::Custodian(address.clone()), custodian);
        Self::extend_custodian_ttl(env, address);
    }

    fn extend_attestation_ttl(env: &Env, id: &u64) {
        env.storage()
            .persistent()
            .extend_ttl(&StorageKey::Attestation(*id), 50000, 535680);
    }

    fn read_attestation(env: &Env, id: &u64) -> Option<CustodyAttestation> {
        let result = env
            .storage()
            .persistent()
            .get::<StorageKey, CustodyAttestation>(&StorageKey::Attestation(*id));
        if result.is_some() {
            Self::extend_attestation_ttl(env, id);
        }
        result
    }

    fn write_attestation(env: &Env, id: &u64, attestation: &CustodyAttestation) {
        env.storage()
            .persistent()
            .set(&StorageKey::Attestation(*id), attestation);
        Self::extend_attestation_ttl(env, id);
    }

    fn put_oracle(env: Env, oracle_address: Address, name: Symbol, jurisdiction: Symbol) {
        let mut methods = Vec::<Symbol>::new(&env);
        methods.push_back(Symbol::new(&env, "physical_inspection"));
        methods.push_back(Symbol::new(&env, "document_verification"));
        methods.push_back(Symbol::new(&env, "blockchain_audit"));

        let oracle_info = OracleInfo {
            oracle_address: oracle_address.clone(),
            name,
            jurisdiction,
            verification_methods: methods,
            reputation_score: 80,
            fee_rate: 25,
            is_active: true,
            last_verification: env.ledger().timestamp(),
            total_verifications: 0,
            multi_sig_threshold: 2,
            auditor_type: Symbol::new(&env, "external"),
            license_valid_until: env.ledger().timestamp() + 86400 * 365,
        };

        let mut oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        oracles.set(oracle_address, oracle_info);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "oracles"), &oracles);
    }

    pub fn initialize(env: Env, auth: Address, admin: Address, oracle_addresses: Vec<Address>) {
        auth.require_auth();
        if env
            .storage()
            .instance()
            .has(&Symbol::new(&env, "initialized"))
        {
            panic_with_error!(&env, CustodyError::AlreadyInitialized);
        }

        Self::init_config(&env, &admin);
        Self::init_default_oracles(&env, &oracle_addresses);

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "initialized"), &true);
    }

    fn init_config(env: &Env, admin: &Address) {
        env.storage()
            .instance()
            .set(&Symbol::new(env, "admin"), admin);

        let mut req_methods = Vec::<Symbol>::new(env);
        req_methods.push_back(Symbol::new(&env, "physical_inspection"));
        req_methods.push_back(Symbol::new(&env, "document_verification"));
        req_methods.push_back(Symbol::new(&env, "blockchain_audit"));

        let config = ValidationConfig {
            min_oracle_reputation: 70,
            max_proof_age: 86400 * 30,
            required_verification_methods: req_methods,
            insurance_required: true,
            min_insurance_coverage: 1000000,
            audit_required: true,
            multi_oracle_required: true,
            oracle_consensus_threshold: 75,
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
            .set(&Symbol::new(&env, "proof_count"), &0u64);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "attestation_count"), &0u64);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "dispute_count"), &0u64);
        env.storage().instance().set(
            &Symbol::new(&env, "proofs"),
            &Vec::<CustodyProof>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "disputes"),
            &Map::<u64, DisputeRecord>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "oracles"),
            &Map::<Address, OracleInfo>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "custodian_addresses"),
            &Vec::<Address>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "registered_assets"),
            &Map::<Address, AssetRegistration>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "verification_configs"),
            &Map::<Symbol, VerificationTypeConfig>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "insurance_integrations"),
            &Map::<Address, InsuranceIntegration>::new(&env),
        );
        // Issue #155: per-custodian multi-signature policies.
        env.storage().instance().set(
            &Symbol::new(&env, "multisig_configs"),
            &Map::<Address, MultiSigConfig>::new(&env),
        );
        // Issue #157: IoT sensor registry, readings, thresholds and alert counter.
        env.storage().instance().set(
            &Symbol::new(&env, "iot_sensors"),
            &Map::<Symbol, IoTSensorRegistration>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "sensor_readings"),
            &Map::<Symbol, Vec<IoTSensorData>>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "sensor_thresholds"),
            &Map::<Symbol, SensorThreshold>::new(&env),
        );
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "sensor_alert_count"), &0u64);
        // Issue #159: supported-chain registry and cross-chain proofs.
        env.storage().instance().set(
            &Symbol::new(&env, "bridges"),
            &Map::<Symbol, BridgeRegistration>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "cross_chain_proofs"),
            &Map::<u64, CrossChainProof>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "cross_chain_proof_count"),
            &0u64,
        );
        // Issue #158: custodian bonds, redistribution balances and slashing policy.
        env.storage().instance().set(
            &Symbol::new(&env, "custodian_bonds"),
            &Map::<Address, i128>::new(&env),
        );
        env.storage().instance().set(
            &Symbol::new(&env, "reward_balances"),
            &Map::<Address, i128>::new(&env),
        );
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "insurance_pool"), &0i128);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "platform_balance"), &0i128);
        env.storage().instance().set(
            &Symbol::new(&env, "slashing_config"),
            &SlashingConfig {
                challenger_share_bps: 7000,
                insurance_share_bps: 2000,
                platform_share_bps: 1000,
                reputation_penalty_points: 25,
            },
        );
    }

    fn init_default_oracles(env: &Env, oracle_addresses: &Vec<Address>) {
        for oracle_addr in oracle_addresses.iter() {
            Self::put_oracle(
                env.clone(),
                oracle_addr.clone(),
                Symbol::new(&env, "Default"),
                Symbol::new(&env, "US"),
            );
        }

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
            panic_with_error!(env, CustodyError::StorageOutdated);
        }
    }

    /// Shared admin gate for the issue #155 / #157 / #158 / #159 entry points.
    fn assert_admin_auth(env: &Env, auth: &Address) {
        crate::shared_admin::require_admin(env, auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "admin"))
            .unwrap_or_else(|| panic_with_error!(env, CustodyError::NotInitialized));
        assert_admin(env, auth, &admin);
    }

    fn read_multi_sig_config(env: &Env, custodian: &Address) -> Option<MultiSigConfig> {
        let configs: Map<Address, MultiSigConfig> = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "multisig_configs"))
            .unwrap_or_else(|| Map::new(env));
        configs.get(custodian.clone())
    }

    fn read_alert_threshold(env: &Env, metric_type: &Symbol) -> Option<SensorThreshold> {
        let thresholds: Map<Symbol, SensorThreshold> = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "sensor_thresholds"))
            .unwrap_or_else(|| Map::new(env));
        thresholds.get(metric_type.clone())
    }

    pub fn migrate(env: Env, auth: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::ValidatorNotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        let ver = Self::read_version(&env);
        if ver >= STORAGE_VERSION {
            panic_with_error!(&env, CustodyError::AlreadyAtLatestVersion);
        }

        let mut current = ver;
        while current < STORAGE_VERSION {
            current += 1;
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "version"), &STORAGE_VERSION);
    }

    pub fn register_oracle(
        env: Env,
        auth: Address,
        oracle_address: Address,
        name: Symbol,
        jurisdiction: Symbol,
    ) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        Self::put_oracle(env, oracle_address, name, jurisdiction);
    }

    pub fn register_custodian(
        env: Env,
        auth: Address,
        custodian_address: Address,
        name: Symbol,
        jurisdiction: Symbol,
        license_number: Symbol,
        verification_types: Vec<Symbol>,
        bond_required: i128,
        insurance_provider: Symbol,
    ) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        if bond_required < 0 {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }

        let custodian = CustodianRegistry {
            custodian_address: custodian_address.clone(),
            name,
            jurisdiction,
            license_number,
            reputation_score: 80,
            verification_types,
            is_active: true,
            total_attestations: 0,
            successful_disputes: 0,
            failed_disputes: 0,
            bond_required,
            insurance_provider,
        };

        Self::write_custodian(&env, &custodian_address, &custodian);

        let mut custodian_addresses: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "custodian_addresses"))
            .unwrap_or(Vec::new(&env));

        if !custodian_addresses.contains(&custodian_address) {
            custodian_addresses.push_back(custodian_address.clone());
            env.storage().instance().set(
                &Symbol::new(&env, "custodian_addresses"),
                &custodian_addresses,
            );
        }
    }

    pub fn setup_verification_types(env: Env, auth: Address) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut verification_configs: Map<Symbol, VerificationTypeConfig> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "verification_configs"))
            .unwrap_or(Map::new(&env));

        verification_configs.set(
            Symbol::new(&env, "real_estate"),
            Self::get_real_estate_config(&env),
        );
        verification_configs.set(
            Symbol::new(&env, "precious_metals"),
            Self::get_metals_config(&env),
        );
        verification_configs.set(
            Symbol::new(&env, "art_collectibles"),
            Self::get_art_config(&env),
        );
        verification_configs.set(
            Symbol::new(&env, "commodities"),
            Self::get_commodities_config(&env),
        );
        verification_configs.set(Symbol::new(&env, "invoice"), Self::get_invoice_config(&env));

        env.storage().instance().set(
            &Symbol::new(&env, "verification_configs"),
            &verification_configs,
        );
    }

    fn get_real_estate_config(env: &Env) -> VerificationTypeConfig {
        let mut real_estate_docs = Vec::<Symbol>::new(env);
        real_estate_docs.push_back(Symbol::new(&env, "property_deed"));
        real_estate_docs.push_back(Symbol::new(&env, "title_insurance"));
        real_estate_docs.push_back(Symbol::new(&env, "rental_income_proof"));
        real_estate_docs.push_back(Symbol::new(&env, "inspection_report"));

        VerificationTypeConfig {
            verification_type: Symbol::new(&env, "real_estate"),
            required_documents: real_estate_docs,
            verification_frequency: 86400 * 7, // weekly
            multi_sig_required: true,
            sig_threshold: 3,
            insurance_required: true,
            min_insurance_coverage: 1000000,
            iot_monitoring_required: false,
            satellite_verification: true,
            legal_verification_required: true,
        }
    }

    fn get_metals_config(env: &Env) -> VerificationTypeConfig {
        let mut metals_docs = Vec::<Symbol>::new(env);
        metals_docs.push_back(Symbol::new(&env, "vault_audit_cert"));
        metals_docs.push_back(Symbol::new(&env, "purity_assay"));
        metals_docs.push_back(Symbol::new(&env, "weight_verification"));
        metals_docs.push_back(Symbol::new(&env, "chain_of_custody"));

        VerificationTypeConfig {
            verification_type: Symbol::new(&env, "precious_metals"),
            required_documents: metals_docs,
            verification_frequency: 86400, // daily
            multi_sig_required: true,
            sig_threshold: 2,
            insurance_required: true,
            min_insurance_coverage: 500000,
            iot_monitoring_required: true,
            satellite_verification: false,
            legal_verification_required: false,
        }
    }

    fn get_art_config(env: &Env) -> VerificationTypeConfig {
        let mut art_docs = Vec::<Symbol>::new(env);
        art_docs.push_back(Symbol::new(&env, "provenance_docs"));
        art_docs.push_back(Symbol::new(&env, "condition_report"));
        art_docs.push_back(Symbol::new(&env, "insurance_appraisal"));
        art_docs.push_back(Symbol::new(&env, "exhibition_history"));

        VerificationTypeConfig {
            verification_type: Symbol::new(&env, "art_collectibles"),
            required_documents: art_docs,
            verification_frequency: 86400 * 30, // monthly
            multi_sig_required: true,
            sig_threshold: 3,
            insurance_required: true,
            min_insurance_coverage: 250000,
            iot_monitoring_required: false,
            satellite_verification: false,
            legal_verification_required: true,
        }
    }

    fn get_commodities_config(env: &Env) -> VerificationTypeConfig {
        let mut commodities_docs = Vec::<Symbol>::new(env);
        commodities_docs.push_back(Symbol::new(&env, "warehouse_receipt"));
        commodities_docs.push_back(Symbol::new(&env, "quality_grading"));
        commodities_docs.push_back(Symbol::new(&env, "environmental_cert"));

        VerificationTypeConfig {
            verification_type: Symbol::new(&env, "commodities"),
            required_documents: commodities_docs,
            verification_frequency: 86400 * 3, // every 3 days
            multi_sig_required: false,
            sig_threshold: 1,
            insurance_required: false,
            min_insurance_coverage: 100000,
            iot_monitoring_required: true,
            satellite_verification: false,
            legal_verification_required: false,
        }
    }

    fn get_invoice_config(env: &Env) -> VerificationTypeConfig {
        let mut invoice_docs = Vec::<Symbol>::new(env);
        invoice_docs.push_back(Symbol::new(&env, "debtor_confirmation"));
        invoice_docs.push_back(Symbol::new(&env, "payment_history"));
        invoice_docs.push_back(Symbol::new(&env, "credit_insurance"));

        VerificationTypeConfig {
            verification_type: Symbol::new(&env, "invoice"),
            required_documents: invoice_docs,
            verification_frequency: 86400 * 14, // biweekly
            multi_sig_required: false,
            sig_threshold: 1,
            insurance_required: true,
            min_insurance_coverage: 75000,
            iot_monitoring_required: false,
            satellite_verification: false,
            legal_verification_required: true,
        }
    }

    pub fn resolve_dispute(
        env: Env,
        auth: Address,
        dispute_id: u64,
        resolution: Symbol,
        penalty_amount: i128,
    ) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut disputes: Map<u64, DisputeRecord> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "disputes"))
            .unwrap_or(Map::new(&env));

        let mut dispute = disputes
            .get(dispute_id)
            .ok_or(CustodyError::DisputeNotFound)
            .unwrap();

        if dispute.status != Symbol::new(&env, "pending") {
            panic_with_error!(&env, CustodyError::InvalidDisputeStatus);
        }

        dispute.status = if resolution == Symbol::new(&env, "upheld") {
            Symbol::new(&env, "resolved_upheld")
        } else if resolution == Symbol::new(&env, "rejected") {
            Symbol::new(&env, "resolved_rejected")
        } else {
            Symbol::new(&env, "resolved_settled")
        };

        dispute.resolved_at = env.ledger().timestamp();
        dispute.resolution = resolution.clone();

        if resolution == Symbol::new(&env, "upheld") {
            // Issue #158: an upheld dispute automatically slashes the custodian's
            // bond (capped at the total posted bond) and redistributes it.
            // The challenger's own bond is returned since they prevailed.
            dispute.bond_returned = true;
            let slashed = Self::apply_bond_slash(&env, &dispute, penalty_amount);
            dispute.penalty_applied = slashed > 0;
            dispute.penalty_amount = slashed;
        } else {
            // Rejected / settled disputes never slash the custodian's bond.
            dispute.bond_returned = false;
            dispute.penalty_applied = false;
            dispute.penalty_amount = 0;
            Self::update_custodian_dispute_stats(env.clone(), dispute.custodian.clone(), false);
        }

        disputes.set(dispute_id, dispute.clone());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "disputes"), &disputes);

        env.events().publish(
            (
                Symbol::new(&env, "dispute_resolved"),
                dispute.custodian.clone(),
            ),
            (
                dispute.dispute_id,
                resolution,
                dispute.challenger,
                dispute.custodian,
                env.ledger().timestamp(),
            ),
        );
    }

    fn update_custodian_stats(env: Env, custodian_address: Address) {
        if let Some(mut custodian) = Self::read_custodian(&env, &custodian_address) {
            custodian.total_attestations += 1;
            if custodian.total_attestations % 10 == 0 {
                custodian.reputation_score = (custodian.reputation_score + 1).min(100);
            }
            Self::write_custodian(&env, &custodian_address, &custodian);
        }
    }

    fn update_custodian_dispute_stats(env: Env, custodian_address: Address, dispute_lost: bool) {
        if let Some(mut custodian) = Self::read_custodian(&env, &custodian_address) {
            if dispute_lost {
                custodian.failed_disputes += 1;
                custodian.reputation_score = custodian.reputation_score.saturating_sub(5);
                if custodian.reputation_score < 50 {
                    custodian.is_active = false;
                }
            } else {
                custodian.successful_disputes += 1;
                custodian.reputation_score = (custodian.reputation_score + 2).min(100);
            }
            Self::write_custodian(&env, &custodian_address, &custodian);
        }
    }

    pub fn submit_attestation(env: Env, attestation: CustodyAttestation) -> u64 {
        Self::check_version(&env);

        if attestation.value < 0 {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }

        // Issue #155: a custodian with an M-of-N policy must use
        // `submit_multisig_attestation`, which enforces the Ed25519 signatures.
        if Self::read_multi_sig_config(&env, &attestation.custodian).is_some() {
            panic_with_error!(&env, CustodyError::MultiSigThresholdNotMet);
        }

        if !Self::verify_attestation(&env, &attestation) {
            panic_with_error!(&env, CustodyError::InvalidAttestation);
        }

        let attestation_count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "attestation_count"))
            .unwrap_or(0u64);

        let attestation_id = attestation_count + 1;

        let mut valid_attestation = attestation;
        valid_attestation.is_valid = true;
        valid_attestation.expires_at = env.ledger().timestamp() + 86400 * 30;

        let custodian = valid_attestation.custodian.clone();
        let asset_id = valid_attestation.asset_id.clone();
        let value = valid_attestation.value;

        Self::write_attestation(&env, &attestation_id, &valid_attestation);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "attestation_count"), &attestation_id);

        Self::update_custodian_stats(env.clone(), custodian.clone());

        env.events().publish(
            (Symbol::new(&env, "attestation_submitted"), asset_id),
            (attestation_id, custodian, value, env.ledger().timestamp()),
        );

        attestation_id
    }

    /// Checks shared by every attestation path (active custodian, authorised
    /// verification type, insurance requirement and expiry). The multi-signature
    /// requirement is deliberately excluded: `submit_attestation` enforces the
    /// verification-type signature count while `submit_multisig_attestation`
    /// enforces the custodian's M-of-N policy (issue #155).
    fn verify_attestation_basics(env: &Env, attestation: &CustodyAttestation) -> bool {
        let custodian_info = match Self::read_custodian(env, &attestation.custodian) {
            Some(info) => info,
            None => return false,
        };

        if !custodian_info.is_active {
            return false;
        }

        if !custodian_info
            .verification_types
            .contains(&attestation.verification_type)
        {
            return false;
        }

        let verification_configs: Map<Symbol, VerificationTypeConfig> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "verification_configs"))
            .unwrap_or(Map::new(&env));

        if let Some(config) = verification_configs.get(attestation.verification_type.clone()) {
            if config.insurance_required
                && attestation.insurance_status == Symbol::new(&env, "uninsured")
            {
                return false;
            }
        }

        let current_time = env.ledger().timestamp();
        if current_time > attestation.expires_at {
            return false;
        }

        true
    }

    fn verify_attestation(env: &Env, attestation: &CustodyAttestation) -> bool {
        if !Self::verify_attestation_basics(env, attestation) {
            return false;
        }

        let verification_configs: Map<Symbol, VerificationTypeConfig> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "verification_configs"))
            .unwrap_or(Map::new(&env));

        if let Some(config) = verification_configs.get(attestation.verification_type.clone()) {
            if config.multi_sig_required
                && (attestation.multi_sig_signatures.len() as u32) < config.sig_threshold
            {
                return false;
            }
        }

        true
    }

    pub fn dispute_attestation(
        env: Env,
        attestation_id: u64,
        challenger: Address,
        reason: Symbol,
        bond_amount: i128,
        evidence_hash: BytesN<32>,
    ) -> u64 {
        Self::check_version(&env);

        let attestations: Map<u64, CustodyAttestation> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "attestations"))
            .unwrap_or(Map::new(&env));

        let attestation = Self::read_attestation(&env, &attestation_id)
            .ok_or(CustodyError::DisputeNotFound)
            .unwrap();

        let custodian_info = Self::read_custodian(&env, &attestation.custodian)
            .ok_or(CustodyError::CustodianNotWhitelisted)
            .unwrap();

        if bond_amount < custodian_info.bond_required {
            panic_with_error!(&env, CustodyError::InsufficientBond);
        }

        let disputes: Map<u64, DisputeRecord> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "disputes"))
            .unwrap_or(Map::new(&env));

        for dispute in disputes.iter() {
            if dispute.1.attestation_id == attestation_id
                && dispute.1.status == Symbol::new(&env, "pending")
            {
                panic_with_error!(&env, CustodyError::DisputeAlreadyExists);
            }
        }

        let dispute_count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "dispute_count"))
            .unwrap_or(0u64);

        let dispute_id = dispute_count + 1;

        let dispute = DisputeRecord {
            dispute_id,
            attestation_id,
            challenger: challenger.clone(),
            custodian: attestation.custodian.clone(),
            reason,
            bond_amount,
            evidence_hash,
            status: Symbol::new(&env, "pending"),
            created_at: env.ledger().timestamp(),
            resolved_at: 0,
            resolution: Symbol::new(&env, "none"),
            bond_returned: false,
            penalty_applied: false,
            penalty_amount: 0,
        };

        let mut updated_disputes = disputes;
        updated_disputes.set(dispute_id, dispute.clone());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "disputes"), &updated_disputes);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "dispute_count"), &dispute_id);

        env.events().publish(
            (Symbol::new(&env, "dispute_initiated"), attestation.asset_id),
            (
                dispute_id,
                challenger,
                attestation.custodian,
                env.ledger().timestamp(),
            ),
        );

        dispute_id
    }

    pub fn validate_proof(env: Env, proof: CustodyProof) -> bool {
        let config: ValidationConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::ConfigNotFound);
            });

        let registered_assets: Map<Address, AssetRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registered_assets"))
            .unwrap_or(Map::new(&env));

        if registered_assets.get(proof.asset_address.clone()).is_none() {
            return false;
        }

        let oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        match oracles.get(proof.custody_provider.clone()) {
            Some(oracle_info) => {
                if oracle_info.reputation_score < config.min_oracle_reputation {
                    return false;
                }
                if !oracle_info.is_active {
                    return false;
                }
            }
            None => return false,
        }

        let current_time = env.ledger().timestamp();
        if current_time - proof.verification_timestamp > config.max_proof_age {
            return false;
        }

        if current_time > proof.expiry_timestamp {
            return false;
        }

        if config.insurance_required && proof.insurance_coverage < config.min_insurance_coverage {
            return false;
        }

        if config.audit_required && proof.audit_report_hash == BytesN::from_array(&env, &[0; 32]) {
            return false;
        }

        if config.multi_oracle_required
            && !Self::verify_oracle_signatures(env.clone(), proof.clone())
        {
            return false;
        }

        true
    }

    fn verify_oracle_signatures(env: Env, proof: CustodyProof) -> bool {
        let config: ValidationConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "config"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::ConfigNotFound);
            });

        let valid_signatures = proof.oracle_signatures.len();
        let total_signatures = proof.oracle_signatures.len();

        if total_signatures == 0 {
            return false;
        }

        let consensus_percentage = (valid_signatures * 100) / total_signatures as u32;
        consensus_percentage >= config.oracle_consensus_threshold
    }

    fn update_oracle_stats(env: Env, oracle_address: Address) {
        let mut oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        if let Some(mut oracle_info) = oracles.get(oracle_address.clone()) {
            oracle_info.last_verification = env.ledger().timestamp();
            oracle_info.total_verifications += 1;
            if oracle_info.total_verifications % 10 == 0 {
                oracle_info.reputation_score = (oracle_info.reputation_score + 1).min(100);
            }
            oracles.set(oracle_address, oracle_info);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "oracles"), &oracles);
        }
    }

    pub fn get_attestation(env: Env, attestation_id: u64) -> CustodyAttestation {
        let mut attestation = Self::read_attestation(&env, &attestation_id)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::AttestationNotFound));

        let now = env.ledger().timestamp();
        if now > attestation.expires_at {
            if attestation.is_valid {
                attestation.is_valid = false;
                Self::write_attestation(&env, &attestation_id, &attestation);
                env.events().publish(
                    (Symbol::new(&env, "attestation_expired"), attestation.asset_id.clone()),
                    (attestation_id, now),
                );
            }
        }
        attestation
    }

    pub fn is_attestation_valid(env: Env, attestation_id: u64) -> bool {
        if let Some(attestation) = Self::read_attestation(&env, &attestation_id) {
            attestation.is_valid && env.ledger().timestamp() <= attestation.expires_at
        } else {
            false
        }
    }

    pub fn invalidate_attestation(env: Env, auth: Address, attestation_id: u64) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });
        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut attestation = Self::read_attestation(&env, &attestation_id)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::AttestationNotFound));

        attestation.is_valid = false;
        Self::write_attestation(&env, &attestation_id, &attestation);

        env.events().publish(
            (Symbol::new(&env, "attestation_invalidated"), attestation.asset_id.clone()),
            (attestation_id, auth, env.ledger().timestamp()),
        );
    }

    pub fn get_latest_attestation(env: Env, asset_id: Address) -> Option<CustodyAttestation> {
        let attestation_count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "attestation_count"))
            .unwrap_or(0u64);

        let mut latest_attestation: Option<CustodyAttestation> = None;
        let mut latest_timestamp = 0u64;

        let start = if attestation_count > 100 {
            attestation_count - 100
        } else {
            1
        };

        for id in start..=attestation_count {
            if let Some(att) = Self::read_attestation(&env, &id) {
                if att.asset_id == asset_id && att.is_valid && att.timestamp > latest_timestamp {
                    latest_timestamp = att.timestamp;
                    latest_attestation = Some(att);
                }
            }
        }

        latest_attestation
    }

    pub fn get_dispute(env: Env, dispute_id: u64) -> DisputeRecord {
        let disputes: Map<u64, DisputeRecord> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "disputes"))
            .unwrap_or(Map::new(&env));

        disputes.get(dispute_id).unwrap_or_else(|| {
            panic_with_error!(&env, CustodyError::DisputeNotFound);
        })
    }

    pub fn get_custodian_info(env: Env, custodian_address: Address) -> CustodianRegistry {
        Self::read_custodian(&env, &custodian_address)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::CustodianNotFound))
    }

    pub fn list_active_custodians(env: Env) -> Vec<CustodianRegistry> {
        let custodian_addresses: Vec<Address> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "custodian_addresses"))
            .unwrap_or(Vec::new(&env));

        let mut active_custodians = Vec::<CustodianRegistry>::new(&env);
        for addr in custodian_addresses.iter() {
            if let Some(custodian) = Self::read_custodian(&env, &addr) {
                if custodian.is_active {
                    active_custodians.push_back(custodian);
                }
            }
        }

        active_custodians
    }

    pub fn get_verification_config(env: Env, verification_type: Symbol) -> VerificationTypeConfig {
        let verification_configs: Map<Symbol, VerificationTypeConfig> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "verification_configs"))
            .unwrap_or(Map::new(&env));

        verification_configs
            .get(verification_type)
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::InvalidVerificationType);
            })
    }

    pub fn trigger_insurance_claim(
        env: Env,
        auth: Address,
        asset_id: Address,
        claim_reason: Symbol,
        evidence_hash: BytesN<32>,
    ) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let insurance_integrations: Map<Address, InsuranceIntegration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "insurance_integrations"))
            .unwrap_or(Map::new(&env));

        if let Some(insurance) = insurance_integrations.get(asset_id.clone()) {
            if !insurance.claim_auto_trigger {
                panic_with_error!(&env, CustodyError::InsuranceClaimFailed);
            }

            if env.ledger().timestamp() > insurance.valid_until {
                panic_with_error!(&env, CustodyError::InsuranceClaimFailed);
            }

            env.events().publish(
                (Symbol::new(&env, "insurance_claim_triggered"), asset_id),
                (
                    insurance.provider,
                    claim_reason,
                    evidence_hash,
                    env.ledger().timestamp(),
                ),
            );
        } else {
            panic_with_error!(&env, CustodyError::InsuranceClaimFailed);
        }
    }

    pub fn setup_insurance_integration(
        env: Env,
        auth: Address,
        asset_id: Address,
        insurance: InsuranceIntegration,
    ) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut insurance_integrations: Map<Address, InsuranceIntegration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "insurance_integrations"))
            .unwrap_or(Map::new(&env));

        insurance_integrations.set(asset_id, insurance);
        env.storage().instance().set(
            &Symbol::new(&env, "insurance_integrations"),
            &insurance_integrations,
        );
    }

    pub fn get_custody_alerts(env: Env) -> Vec<(Address, Symbol)> {
        let attestation_count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "attestation_count"))
            .unwrap_or(0u64);

        let mut alerts = Vec::<(Address, Symbol)>::new(&env);
        let current_time = env.ledger().timestamp();

        for id in 1..=attestation_count {
            if let Some(attestation) = Self::read_attestation(&env, &id) {
                if !attestation.is_valid {
                    alerts.push_back((
                        attestation.asset_id.clone(),
                        Symbol::new(&env, "invalid_attestation"),
                    ));
                } else if current_time > attestation.expires_at {
                    alerts.push_back((
                        attestation.asset_id.clone(),
                        Symbol::new(&env, "attestation_expired"),
                    ));
                } else if current_time > attestation.expires_at - 86400 * 7 {
                    alerts.push_back((
                        attestation.asset_id.clone(),
                        Symbol::new(&env, "attestation_expiring_soon"),
                    ));
                }
            }
        }

        alerts
    }

    fn apply_oracle_decay(env: &Env, mut oracle_info: OracleInfo) -> OracleInfo {
        let now = env.ledger().timestamp();
        if oracle_info.last_verification > 0 && now > oracle_info.last_verification {
            let elapsed = now - oracle_info.last_verification;
            let decay_periods = elapsed / (7 * 86400);
            if decay_periods > 0 {
                let decay = decay_periods as u32;
                oracle_info.reputation_score = oracle_info.reputation_score.saturating_sub(decay).max(10);
            }
        }
        oracle_info
    }

    pub fn get_oracle_info(env: Env, oracle_address: Address) -> OracleInfo {
        let oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        let oracle_info = oracles.get(oracle_address).unwrap_or_else(|| {
            panic_with_error!(&env, CustodyError::OracleNotFound);
        });
        Self::apply_oracle_decay(&env, oracle_info)
    }

    pub fn list_active_oracles(env: Env) -> Vec<OracleInfo> {
        let oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        let mut active_oracles = Vec::<OracleInfo>::new(&env);
        for (_, oracle_info) in oracles.iter() {
            if oracle_info.is_active {
                active_oracles.push_back(oracle_info.clone());
            }
        }

        active_oracles
    }

    pub fn update_oracle_status(env: Env, auth: Address, oracle_address: Address, is_active: bool) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        let mut oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        if let Some(mut oracle_info) = oracles.get(oracle_address.clone()) {
            oracle_info.is_active = is_active;
            oracles.set(oracle_address, oracle_info);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "oracles"), &oracles);
        }
    }

    pub fn update_oracle_reputation(
        env: Env,
        auth: Address,
        oracle_address: Address,
        reputation_score: u32,
    ) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        if reputation_score > 100 {
            panic_with_error!(&env, CustodyError::VerificationFailed);
        }

        Self::check_version(&env);

        let mut oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        if let Some(mut oracle_info) = oracles.get(oracle_address.clone()) {
            oracle_info.reputation_score = reputation_score;
            oracle_info.last_verification = env.ledger().timestamp();
            oracles.set(oracle_address, oracle_info);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "oracles"), &oracles);
        }
    }

    pub fn get_asset_registration(env: Env, asset_address: Address) -> AssetRegistration {
        let registered_assets: Map<Address, AssetRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "registered_assets"))
            .unwrap_or(Map::new(&env));

        registered_assets.get(asset_address).unwrap_or_else(|| {
            panic_with_error!(&env, CustodyError::AssetNotRegistered);
        })
    }

    pub fn update_config(env: Env, auth: Address, config: ValidationConfig) {
        crate::shared_admin::require_admin(&env, &auth);
        let admin: Address = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "admin"))
            .unwrap_or_else(|| {
                panic_with_error!(&env, CustodyError::NotInitialized);
            });

        assert_admin(&env, &auth, &admin);

        Self::check_version(&env);

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "config"), &config);
    }

    pub fn get_validation_stats(env: Env) -> Map<Symbol, u64> {
        let proofs: Vec<CustodyProof> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "proofs"))
            .unwrap_or(Vec::new(&env));

        let oracles: Map<Address, OracleInfo> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "oracles"))
            .unwrap_or(Map::new(&env));

        let mut stats = Map::<Symbol, u64>::new(&env);

        stats.set(Symbol::new(&env, "total_proofs"), proofs.len() as u64);
        stats.set(Symbol::new(&env, "total_oracles"), oracles.len() as u64);

        let mut valid_proofs = 0u64;
        let mut expired_proofs = 0u64;
        let current_time = env.ledger().timestamp();

        for proof in proofs.iter() {
            if proof.is_valid && current_time <= proof.expiry_timestamp {
                valid_proofs += 1;
            } else if current_time > proof.expiry_timestamp {
                expired_proofs += 1;
            }
        }

        stats.set(Symbol::new(&env, "valid_proofs"), valid_proofs);
        stats.set(Symbol::new(&env, "expired_proofs"), expired_proofs);
        stats
    }

    // ── Issue #155: multi-party custody / threshold signatures ───────────────

    /// Register (or replace) the M-of-N multi-signature policy for a custodian.
    /// Admin only. Once set, the custodian can no longer submit single-signer
    /// attestations; `submit_multisig_attestation` is required instead.
    pub fn set_multi_sig_config(
        env: Env,
        auth: Address,
        custodian: Address,
        config: MultiSigConfig,
    ) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        if Self::read_custodian(&env, &custodian).is_none() {
            panic_with_error!(&env, CustodyError::CustodianNotFound);
        }

        if config.total_signers == 0
            || config.required_signatures == 0
            || config.required_signatures > config.total_signers
            || config.signer_keys.len() != config.total_signers
            || config.signer_addresses.len() != config.total_signers
        {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }

        // Reject duplicate signer keys: a signer must not count twice.
        let mut seen = Vec::<BytesN<32>>::new(&env);
        for key in config.signer_keys.iter() {
            if seen.contains(&key) {
                panic_with_error!(&env, CustodyError::DuplicateSigner);
            }
            seen.push_back(key);
        }

        let mut configs: Map<Address, MultiSigConfig> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "multisig_configs"))
            .unwrap_or_else(|| Map::new(&env));
        configs.set(custodian.clone(), config.clone());
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "multisig_configs"), &configs);

        env.events().publish(
            (Symbol::new(&env, "multisig_config_set"), custodian),
            (config.required_signatures, config.total_signers),
        );
    }

    pub fn get_multi_sig_config(env: Env, custodian: Address) -> MultiSigConfig {
        Self::read_multi_sig_config(&env, &custodian)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::MultiSigConfigNotFound))
    }

    /// Verify that `signer_keys` / `signatures` satisfy `config`, checking the
    /// Ed25519 signatures over `message`. Returns the matching signer addresses.
    fn verify_threshold_signatures(
        env: &Env,
        config: &MultiSigConfig,
        signer_keys: &Vec<BytesN<32>>,
        signatures: &Vec<BytesN<64>>,
        message: &Bytes,
    ) -> Vec<Address> {
        if signer_keys.len() != signatures.len() {
            panic_with_error!(env, CustodyError::InvalidParameters);
        }

        if signatures.len() < config.required_signatures {
            panic_with_error!(env, CustodyError::MultiSigThresholdNotMet);
        }

        let mut signer_addresses = Vec::<Address>::new(env);
        let mut used_keys = Vec::<BytesN<32>>::new(env);
        let mut index = 0u32;

        for key in signer_keys.iter() {
            let signature = signatures.get(index).unwrap();
            index += 1;

            // Duplicate signers do not count towards the threshold.
            if used_keys.contains(&key) {
                panic_with_error!(env, CustodyError::DuplicateSigner);
            }
            used_keys.push_back(key.clone());

            // The signer must be authorised by the custodian's policy.
            let mut authorised_index: Option<u32> = None;
            let mut position = 0u32;
            for authorised_key in config.signer_keys.iter() {
                if authorised_key == key {
                    authorised_index = Some(position);
                    break;
                }
                position += 1;
            }
            let position = authorised_index
                .unwrap_or_else(|| panic_with_error!(env, CustodyError::InvalidSignature));

            // Cryptographic check: a valid Ed25519 signature over `message`.
            env.crypto().ed25519_verify(&key, message, &signature);

            signer_addresses.push_back(config.signer_addresses.get(position).unwrap());
        }

        signer_addresses
    }

    /// Submit an attestation backed by M-of-N Ed25519 signatures. The signed
    /// message is the attestation's `proof_hash`. Multi-signature events carry
    /// the resolved signer addresses.
    pub fn submit_multisig_attestation(
        env: Env,
        attestation: CustodyAttestation,
        signer_keys: Vec<BytesN<32>>,
        signatures: Vec<BytesN<64>>,
    ) -> u64 {
        Self::check_version(&env);

        if attestation.value < 0 {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }

        let config = Self::read_multi_sig_config(&env, &attestation.custodian)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::MultiSigConfigNotFound));

        let message: Bytes = attestation.proof_hash.clone().into();
        let signer_addresses =
            Self::verify_threshold_signatures(&env, &config, &signer_keys, &signatures, &message);

        if !Self::verify_attestation_basics(&env, &attestation) {
            panic_with_error!(&env, CustodyError::InvalidAttestation);
        }

        let attestation_count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "attestation_count"))
            .unwrap_or(0u64);
        let attestation_id = attestation_count + 1;

        let mut valid_attestation = attestation;
        valid_attestation.multi_sig_signatures = signatures;
        valid_attestation.is_valid = true;
        valid_attestation.expires_at = env.ledger().timestamp() + 86400 * 30;

        let custodian = valid_attestation.custodian.clone();
        let asset_id = valid_attestation.asset_id.clone();
        let value = valid_attestation.value;

        Self::write_attestation(&env, &attestation_id, &valid_attestation);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "attestation_count"), &attestation_id);

        Self::update_custodian_stats(env.clone(), custodian.clone());

        env.events().publish(
            (Symbol::new(&env, "multisig_attestation"), asset_id),
            (
                attestation_id,
                custodian,
                signer_addresses,
                value,
                env.ledger().timestamp(),
            ),
        );

        attestation_id
    }

    // ── Issue #157: IoT sensor data integration ──────────────────────────────

    /// Authorise an IoT sensor to report a metric for an asset. Admin only.
    pub fn register_iot_sensor(
        env: Env,
        auth: Address,
        custodian: Address,
        sensor_id: Symbol,
        asset_id: Address,
        metric_type: Symbol,
    ) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        if Self::read_custodian(&env, &custodian).is_none() {
            panic_with_error!(&env, CustodyError::CustodianNotFound);
        }

        let mut sensors: Map<Symbol, IoTSensorRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "iot_sensors"))
            .unwrap_or_else(|| Map::new(&env));

        if sensors.contains_key(sensor_id.clone()) {
            panic_with_error!(&env, CustodyError::InvalidSensorData);
        }

        sensors.set(
            sensor_id.clone(),
            IoTSensorRegistration {
                sensor_id: sensor_id.clone(),
                asset_id: asset_id.clone(),
                custodian: custodian.clone(),
                metric_type,
                is_active: true,
            },
        );
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "iot_sensors"), &sensors);

        env.events().publish(
            (Symbol::new(&env, "iot_sensor_registered"), asset_id),
            (sensor_id, custodian, auth, env.ledger().timestamp()),
        );
    }

    /// Enable or disable a registered sensor. Admin only.
    pub fn set_iot_sensor_status(env: Env, auth: Address, sensor_id: Symbol, is_active: bool) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        let mut sensors: Map<Symbol, IoTSensorRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "iot_sensors"))
            .unwrap_or_else(|| Map::new(&env));

        let mut sensor = sensors
            .get(sensor_id.clone())
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::SensorNotFound));
        sensor.is_active = is_active;

        sensors.set(sensor_id, sensor);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "iot_sensors"), &sensors);
    }

    /// Configure the alerting band for a metric type. Admin only.
    pub fn set_alert_threshold(
        env: Env,
        auth: Address,
        metric_type: Symbol,
        min_value: i128,
        max_value: i128,
    ) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        if min_value > max_value {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }

        let mut thresholds: Map<Symbol, SensorThreshold> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "sensor_thresholds"))
            .unwrap_or_else(|| Map::new(&env));

        thresholds.set(
            metric_type.clone(),
            SensorThreshold {
                metric_type,
                min_value,
                max_value,
            },
        );
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "sensor_thresholds"), &thresholds);
    }

    pub fn get_alert_threshold(env: Env, metric_type: Symbol) -> SensorThreshold {
        Self::read_alert_threshold(&env, &metric_type)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::ThresholdNotFound))
    }

    /// Record a sensor reading. The custodian that owns the sensor must
    /// authorise the call. Returns `true` when the value breaches the metric's
    /// configured alert threshold.
    pub fn submit_sensor_reading(
        env: Env,
        custodian: Address,
        sensor_data: IoTSensorData,
    ) -> bool {
        custodian.require_auth();
        Self::check_version(&env);

        let sensors: Map<Symbol, IoTSensorRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "iot_sensors"))
            .unwrap_or_else(|| Map::new(&env));

        let sensor = sensors
            .get(sensor_data.sensor_id.clone())
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::SensorNotFound));

        if !sensor.is_active {
            panic_with_error!(&env, CustodyError::SensorInactive);
        }
        if sensor.custodian != custodian {
            panic_with_error!(&env, CustodyError::Unauthorized);
        }
        if sensor.asset_id != sensor_data.asset_id
            || sensor.metric_type != sensor_data.metric_type
        {
            panic_with_error!(&env, CustodyError::InvalidSensorData);
        }
        // A reading must carry a non-empty sensor signature.
        if sensor_data.signature == BytesN::from_array(&env, &[0u8; 64]) {
            panic_with_error!(&env, CustodyError::InvalidSignature);
        }

        let mut readings: Map<Symbol, Vec<IoTSensorData>> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "sensor_readings"))
            .unwrap_or_else(|| Map::new(&env));
        let mut entries = readings
            .get(sensor_data.sensor_id.clone())
            .unwrap_or_else(|| Vec::new(&env));
        entries.push_back(sensor_data.clone());
        readings.set(sensor_data.sensor_id.clone(), entries);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "sensor_readings"), &readings);

        let mut alert_triggered = false;
        if let Some(threshold) = Self::read_alert_threshold(&env, &sensor_data.metric_type) {
            if sensor_data.value < threshold.min_value || sensor_data.value > threshold.max_value {
                alert_triggered = true;
            }
        }

        env.events().publish(
            (Symbol::new(&env, "sensor_reading"), sensor_data.asset_id.clone()),
            (
                sensor_data.sensor_id.clone(),
                sensor_data.metric_type.clone(),
                sensor_data.value,
                sensor_data.timestamp,
                alert_triggered,
            ),
        );

        if alert_triggered {
            let alerts: u64 = env
                .storage()
                .instance()
                .get(&Symbol::new(&env, "sensor_alert_count"))
                .unwrap_or(0u64);
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "sensor_alert_count"), &(alerts + 1));

            env.events().publish(
                (Symbol::new(&env, "sensor_alert"), sensor_data.asset_id),
                (
                    sensor_data.sensor_id,
                    sensor_data.metric_type,
                    sensor_data.value,
                    env.ledger().timestamp(),
                ),
            );
        }

        alert_triggered
    }

    pub fn get_sensor_readings(env: Env, sensor_id: Symbol) -> Vec<IoTSensorData> {
        let readings: Map<Symbol, Vec<IoTSensorData>> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "sensor_readings"))
            .unwrap_or_else(|| Map::new(&env));
        readings
            .get(sensor_id)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_sensor_alert_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "sensor_alert_count"))
            .unwrap_or(0u64)
    }

    // ── Issue #158: custodian bond slashing ──────────────────────────────────

    /// Post collateral for a registered custodian.
    pub fn deposit_bond(env: Env, custodian: Address, amount: i128) {
        custodian.require_auth();
        Self::check_version(&env);

        if amount <= 0 {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }
        if Self::read_custodian(&env, &custodian).is_none() {
            panic_with_error!(&env, CustodyError::CustodianNotFound);
        }

        let mut bonds: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "custodian_bonds"))
            .unwrap_or_else(|| Map::new(&env));
        let current = bonds.get(custodian.clone()).unwrap_or(0);
        bonds.set(custodian.clone(), current + amount);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "custodian_bonds"), &bonds);

        env.events().publish(
            (Symbol::new(&env, "bond_deposited"), custodian),
            (amount, env.ledger().timestamp()),
        );
    }

    pub fn get_bond_balance(env: Env, custodian: Address) -> i128 {
        let bonds: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "custodian_bonds"))
            .unwrap_or_else(|| Map::new(&env));
        bonds.get(custodian).unwrap_or(0)
    }

    pub fn get_reward_balance(env: Env, account: Address) -> i128 {
        let rewards: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "reward_balances"))
            .unwrap_or_else(|| Map::new(&env));
        rewards.get(account).unwrap_or(0)
    }

    pub fn get_insurance_pool(env: Env) -> i128 {
        let pool: i128 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "insurance_pool"))
            .unwrap_or(0);
        pool
    }

    pub fn get_platform_balance(env: Env) -> i128 {
        let balance: i128 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "platform_balance"))
            .unwrap_or(0);
        balance
    }

    /// Update how upheld disputes are slashed. Shares must sum to 100%.
    pub fn set_slashing_config(env: Env, auth: Address, config: SlashingConfig) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        let total = config.challenger_share_bps + config.insurance_share_bps
            + config.platform_share_bps;
        if total != 10000 {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "slashing_config"), &config);
    }

    pub fn get_slashing_config(env: Env) -> SlashingConfig {
        let config: SlashingConfig = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "slashing_config"))
            .unwrap_or(SlashingConfig {
                challenger_share_bps: 7000,
                insurance_share_bps: 2000,
                platform_share_bps: 1000,
                reputation_penalty_points: 25,
            });
        config
    }

    /// Slash `penalty_amount` from the accused custodian's bond, capped at the
    /// total posted bond, and redistribute it 70/20/10 to the challenger, the
    /// insurance pool and the platform. Returns the amount actually slashed.
    fn apply_bond_slash(env: &Env, dispute: &DisputeRecord, penalty_amount: i128) -> i128 {
        if penalty_amount <= 0 {
            return 0;
        }

        let config = Self::get_slashing_config(env.clone());

        let mut bonds: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "custodian_bonds"))
            .unwrap_or_else(|| Map::new(env));

        let bond = bonds.get(dispute.custodian.clone()).unwrap_or(0);
        let slashed = if penalty_amount < bond {
            penalty_amount
        } else {
            bond
        };
        if slashed <= 0 {
            return 0;
        }

        let challenger_cut = slashed * config.challenger_share_bps as i128 / 10000;
        let insurance_cut = slashed * config.insurance_share_bps as i128 / 10000;
        let platform_cut = slashed - challenger_cut - insurance_cut;

        bonds.set(dispute.custodian.clone(), bond - slashed);
        env.storage()
            .instance()
            .set(&Symbol::new(env, "custodian_bonds"), &bonds);

        let mut rewards: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "reward_balances"))
            .unwrap_or_else(|| Map::new(env));
        let challenger_reward = rewards.get(dispute.challenger.clone()).unwrap_or(0);
        rewards.set(
            dispute.challenger.clone(),
            challenger_reward + challenger_cut,
        );
        env.storage()
            .instance()
            .set(&Symbol::new(env, "reward_balances"), &rewards);

        let insurance_pool: i128 = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "insurance_pool"))
            .unwrap_or(0);
        env.storage().instance().set(
            &Symbol::new(env, "insurance_pool"),
            &(insurance_pool + insurance_cut),
        );

        let platform_balance: i128 = env
            .storage()
            .instance()
            .get(&Symbol::new(env, "platform_balance"))
            .unwrap_or(0);
        env.storage().instance().set(
            &Symbol::new(env, "platform_balance"),
            &(platform_balance + platform_cut),
        );

        // Reputation is reduced by the policy's penalty points.
        if let Some(mut custodian) = Self::read_custodian(env, &dispute.custodian) {
            custodian.failed_disputes += 1;
            custodian.reputation_score = custodian
                .reputation_score
                .saturating_sub(config.reputation_penalty_points);
            if custodian.reputation_score < 50 {
                custodian.is_active = false;
            }
            Self::write_custodian(env, &dispute.custodian, &custodian);
        }

        env.events().publish(
            (Symbol::new(env, "bond_slashed"), dispute.custodian.clone()),
            (
                dispute.dispute_id,
                slashed,
                challenger_cut,
                insurance_cut,
                platform_cut,
            ),
        );

        slashed
    }

    // ── Issue #159: cross-chain asset verification ───────────────────────────

    /// Register a supported source chain and its bridge anchor. Admin only.
    pub fn add_supported_chain(
        env: Env,
        auth: Address,
        source_chain: Symbol,
        bridge_contract: Address,
        merkle_root: BytesN<32>,
        block_number: u64,
    ) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        let mut bridges: Map<Symbol, BridgeRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "bridges"))
            .unwrap_or_else(|| Map::new(&env));

        if let Some(existing) = bridges.get(source_chain.clone()) {
            if existing.is_active {
                panic_with_error!(&env, CustodyError::BridgeAlreadyRegistered);
            }
        }

        bridges.set(
            source_chain.clone(),
            BridgeRegistration {
                source_chain: source_chain.clone(),
                bridge_contract: bridge_contract.clone(),
                merkle_root: merkle_root.clone(),
                block_number,
                is_active: true,
            },
        );
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "bridges"), &bridges);

        env.events().publish(
            (Symbol::new(&env, "bridge_registered"), source_chain),
            (
                bridge_contract,
                merkle_root,
                block_number,
                env.ledger().timestamp(),
            ),
        );
    }

    /// Deactivate a supported source chain. Admin only.
    pub fn remove_supported_chain(env: Env, auth: Address, source_chain: Symbol) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        let mut bridges: Map<Symbol, BridgeRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "bridges"))
            .unwrap_or_else(|| Map::new(&env));

        let mut bridge = bridges
            .get(source_chain.clone())
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::BridgeNotFound));
        bridge.is_active = false;
        bridges.set(source_chain.clone(), bridge);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "bridges"), &bridges);

        env.events().publish(
            (Symbol::new(&env, "bridge_removed"), source_chain),
            env.ledger().timestamp(),
        );
    }

    /// Advance a bridge's anchored Merkle root. Admin only.
    pub fn update_bridge_root(
        env: Env,
        auth: Address,
        source_chain: Symbol,
        merkle_root: BytesN<32>,
        block_number: u64,
    ) {
        Self::assert_admin_auth(&env, &auth);
        Self::check_version(&env);

        let mut bridges: Map<Symbol, BridgeRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "bridges"))
            .unwrap_or_else(|| Map::new(&env));

        let mut bridge = bridges
            .get(source_chain.clone())
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::BridgeNotFound));
        if block_number < bridge.block_number {
            panic_with_error!(&env, CustodyError::InvalidParameters);
        }

        bridge.merkle_root = merkle_root;
        bridge.block_number = block_number;
        bridges.set(source_chain, bridge);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "bridges"), &bridges);
    }

    pub fn get_bridge_registration(env: Env, source_chain: Symbol) -> BridgeRegistration {
        let bridges: Map<Symbol, BridgeRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "bridges"))
            .unwrap_or_else(|| Map::new(&env));

        bridges
            .get(source_chain)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::BridgeNotFound))
    }

    /// Order-independent Merkle node hash: sha256(min(a,b) || max(a,b)).
    fn merkle_hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
        let a_array = a.to_array();
        let b_array = b.to_array();
        let mut buffer = [0u8; 64];
        if a_array <= b_array {
            buffer[..32].copy_from_slice(&a_array);
            buffer[32..].copy_from_slice(&b_array);
        } else {
            buffer[..32].copy_from_slice(&b_array);
            buffer[32..].copy_from_slice(&a_array);
        }
        let digest: BytesN<32> = env
            .crypto()
            .sha256(&Bytes::from_array(env, &buffer))
            .into();
        digest
    }

    fn verify_merkle_proof(
        env: &Env,
        leaf: &BytesN<32>,
        proof: &Vec<BytesN<32>>,
        root: &BytesN<32>,
    ) -> bool {
        let mut computed = leaf.clone();
        for sibling in proof.iter() {
            computed = Self::merkle_hash_pair(env, &computed, &sibling);
        }
        computed == *root
    }

    /// Submit a proof that an asset is custodied on another chain. The bridge
    /// must be registered for `proof.source_chain` and the Merkle proof must
    /// resolve to the bridge's anchored root. Returns the new proof id.
    pub fn submit_cross_chain_proof(
        env: Env,
        custodian: Address,
        proof: CrossChainProof,
    ) -> u64 {
        custodian.require_auth();
        Self::check_version(&env);

        let custodian_info = Self::read_custodian(&env, &custodian)
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::CustodianNotFound));
        if !custodian_info.is_active {
            panic_with_error!(&env, CustodyError::Unauthorized);
        }

        let bridges: Map<Symbol, BridgeRegistration> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "bridges"))
            .unwrap_or_else(|| Map::new(&env));

        let bridge = bridges
            .get(proof.source_chain.clone())
            .unwrap_or_else(|| panic_with_error!(&env, CustodyError::BridgeNotFound));
        if !bridge.is_active {
            panic_with_error!(&env, CustodyError::BridgeNotFound);
        }
        if bridge.bridge_contract != proof.bridge_contract
            || proof.block_number > bridge.block_number
        {
            panic_with_error!(&env, CustodyError::InvalidCrossChainProof);
        }
        if !Self::verify_merkle_proof(
            &env,
            &proof.tx_hash,
            &proof.merkle_proof,
            &bridge.merkle_root,
        ) {
            panic_with_error!(&env, CustodyError::InvalidMerkleProof);
        }

        let proof_count: u64 = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "cross_chain_proof_count"))
            .unwrap_or(0u64);
        let proof_id = proof_count + 1;

        let mut valid_proof = proof;
        valid_proof.proof_id = proof_id;
        valid_proof.is_valid = true;
        valid_proof.timestamp = env.ledger().timestamp();

        let source_chain = valid_proof.source_chain.clone();
        let asset_id = valid_proof.asset_id.clone();

        let mut proofs: Map<u64, CrossChainProof> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "cross_chain_proofs"))
            .unwrap_or_else(|| Map::new(&env));
        proofs.set(proof_id, valid_proof);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "cross_chain_proofs"), &proofs);
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "cross_chain_proof_count"), &proof_id);

        env.events().publish(
            (Symbol::new(&env, "cross_chain_proof"), source_chain),
            (
                proof_id,
                asset_id,
                custodian,
                env.ledger().timestamp(),
            ),
        );

        proof_id
    }

    pub fn get_cross_chain_proof(env: Env, proof_id: u64) -> CrossChainProof {
        let proofs: Map<u64, CrossChainProof> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "cross_chain_proofs"))
            .unwrap_or_else(|| Map::new(&env));

        proofs.get(proof_id).unwrap_or_else(|| {
            panic_with_error!(&env, CustodyError::CrossChainProofNotFound)
        })
    }

    pub fn is_cross_chain_proof_valid(env: Env, proof_id: u64) -> bool {
        let proofs: Map<u64, CrossChainProof> = env
            .storage()
            .instance()
            .get(&Symbol::new(&env, "cross_chain_proofs"))
            .unwrap_or_else(|| Map::new(&env));

        match proofs.get(proof_id) {
            Some(proof) => proof.is_valid,
            None => false,
        }
    }
}
