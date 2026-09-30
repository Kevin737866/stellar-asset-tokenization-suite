#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    Address, Bytes, BytesN, Env, Map, Symbol, Vec,
};

use crate::custody_validator::{
    CrossChainProof, CustodyAttestation, CustodyValidator, CustodyValidatorClient, IoTSensorData,
    MultiSigConfig, SlashingConfig,
};

// ── Ed25519 test vectors (issue #155) ────────────────────────────────────────
//
// Generated once with OpenSSL and verified against these exact vectors. All
// signatures are over `MULTISIG_MSG` except `SIG_A_WRONG_MESSAGE`.

/// The 32-byte digest that multi-signature attestations sign (`proof_hash`).
const MULTISIG_MSG: [u8; 32] = [0x11u8; 32];

const PUB_A: [u8; 32] = [
    0xee, 0x06, 0x85, 0x88, 0x54, 0x57, 0x5a, 0xf9, 0xc5, 0x85, 0x9d, 0x74, 0xc2, 0x27, 0x85, 0x25,
    0x42, 0x99, 0x13, 0xe3, 0x6f, 0x8f, 0x3f, 0x01, 0x52, 0x1c, 0xbc, 0x8c, 0x89, 0x10, 0xcb, 0xd1,
];
const PUB_B: [u8; 32] = [
    0x62, 0x09, 0x52, 0x34, 0xc4, 0xcd, 0x42, 0x6c, 0x2e, 0x6d, 0x29, 0x2c, 0x5f, 0x7b, 0xa2, 0x17,
    0x69, 0xd5, 0xa7, 0xd0, 0xef, 0x94, 0x58, 0x6a, 0x8d, 0xbb, 0xa1, 0x91, 0xbf, 0xe5, 0x67, 0x30,
];
const PUB_C: [u8; 32] = [
    0xa2, 0xe4, 0xda, 0xa4, 0x61, 0xf3, 0x99, 0x3d, 0x09, 0x85, 0xd7, 0xa8, 0x1b, 0x2f, 0x82, 0x4e,
    0xcf, 0xd6, 0x04, 0x45, 0x58, 0xf2, 0x36, 0xd5, 0x3f, 0xf2, 0x08, 0xf4, 0xbd, 0x88, 0x79, 0x85,
];
/// A valid key that is deliberately never authorised by any policy.
const PUB_X: [u8; 32] = [
    0xec, 0x99, 0xa5, 0xec, 0x57, 0x90, 0xfa, 0x6e, 0x24, 0xe3, 0xf2, 0xb3, 0xf6, 0x19, 0xd4, 0x5f,
    0x96, 0xf8, 0x81, 0x77, 0x22, 0xd6, 0xe2, 0x45, 0x55, 0x06, 0x25, 0x75, 0x95, 0xca, 0x25, 0xe1,
];

const SIG_A: [u8; 64] = [
    0x74, 0x41, 0xf6, 0xb2, 0xd9, 0x85, 0x64, 0x17, 0x78, 0xbf, 0xbe, 0xac, 0x8d, 0x96, 0x52, 0x1f,
    0x49, 0xfe, 0x39, 0x10, 0x15, 0x79, 0x93, 0xff, 0xd6, 0xc8, 0x49, 0x0d, 0xe8, 0x05, 0x9c, 0xc7,
    0xd4, 0x98, 0xfa, 0x24, 0x95, 0x1f, 0x43, 0x93, 0x3a, 0x85, 0x38, 0xe2, 0xc9, 0x59, 0x76, 0xbe,
    0xa7, 0x26, 0x48, 0x3e, 0x20, 0x90, 0x9b, 0x6a, 0xfe, 0xca, 0xe9, 0x27, 0x3c, 0x37, 0x4e, 0x01,
];
const SIG_B: [u8; 64] = [
    0xa4, 0x4b, 0xb6, 0xc1, 0x47, 0x83, 0xb1, 0x33, 0x4e, 0x8d, 0x63, 0x19, 0x78, 0x9d, 0xf7, 0x01,
    0x55, 0x4f, 0x55, 0x5a, 0xde, 0x29, 0x4f, 0x76, 0xe4, 0x41, 0x0a, 0x06, 0xae, 0x19, 0x82, 0xbc,
    0xfd, 0x1a, 0x19, 0x05, 0xdb, 0xcd, 0xc5, 0x6c, 0xdb, 0x0e, 0xaf, 0x0e, 0x0a, 0xce, 0x22, 0xf7,
    0x5e, 0xf9, 0x3d, 0x46, 0x32, 0x6f, 0xb9, 0xaa, 0xc9, 0xf3, 0x27, 0x7c, 0x4f, 0x8b, 0x22, 0x06,
];
const SIG_C: [u8; 64] = [
    0xde, 0x9a, 0xac, 0x0f, 0x39, 0x10, 0x13, 0x76, 0x21, 0x79, 0x63, 0xe5, 0x64, 0x8b, 0x61, 0x43,
    0x55, 0xd0, 0x90, 0x61, 0x64, 0xdc, 0xf4, 0xbd, 0x0c, 0x8c, 0xd6, 0xb7, 0x19, 0x56, 0xf2, 0xc0,
    0x9d, 0xcb, 0x03, 0x6e, 0x93, 0x2c, 0xbb, 0x7e, 0xe3, 0x7e, 0xf1, 0x6e, 0xca, 0xab, 0xba, 0x4a,
    0x6e, 0x68, 0xb8, 0x0f, 0xff, 0x7a, 0x71, 0x4f, 0xa4, 0x5c, 0x33, 0x66, 0x1f, 0xfd, 0x6a, 0x0a,
];
const SIG_X: [u8; 64] = [
    0xda, 0xf2, 0x63, 0x01, 0xe0, 0xa4, 0x17, 0x89, 0x1f, 0x12, 0xe7, 0x87, 0xf5, 0xe1, 0xc0, 0x63,
    0xc2, 0x2e, 0xef, 0x0e, 0x62, 0x83, 0x0b, 0x70, 0x73, 0x99, 0xd5, 0x61, 0x0a, 0xb2, 0x0e, 0xdd,
    0xed, 0x02, 0xf8, 0xec, 0x50, 0xaf, 0xdc, 0xaf, 0x80, 0x8f, 0x5a, 0xe8, 0xe6, 0xac, 0xde, 0x0c,
    0x48, 0xc8, 0x5b, 0x08, 0x23, 0x05, 0xfb, 0x37, 0x3e, 0x8e, 0x11, 0xab, 0x32, 0x24, 0x79, 0x0f,
];
/// `SIG_A` produced over a *different* 32-byte message.
const SIG_A_WRONG_MESSAGE: [u8; 64] = [
    0x0f, 0x9e, 0x82, 0x42, 0x54, 0x94, 0x76, 0xfe, 0x46, 0xd5, 0x1d, 0x38, 0x7b, 0x0a, 0x34, 0x4e,
    0x87, 0xf9, 0x16, 0x85, 0x61, 0x4c, 0xb7, 0x55, 0x1b, 0x37, 0xb9, 0x19, 0x90, 0x17, 0x33, 0x7d,
    0x5f, 0xe1, 0xa5, 0x5d, 0x18, 0x93, 0xc0, 0xf4, 0x34, 0xf3, 0xd9, 0x8e, 0xa1, 0xb8, 0x7a, 0xbc,
    0xe9, 0x55, 0x92, 0xe2, 0x4b, 0xa9, 0xea, 0xb5, 0xc7, 0x65, 0xb0, 0xf7, 0x17, 0xc3, 0xca, 0x0f,
];

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, CustodyValidatorClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);

    let contract_id = env.register_contract(None, CustodyValidator);
    let client = CustodyValidatorClient::new(&env, &contract_id);
    client.initialize(&admin, &admin, &Vec::from_array(&env, [oracle.clone()]));

    // SAFETY: the environment outlives the client for the duration of each test.
    let client: CustodyValidatorClient<'static> = unsafe { core::mem::transmute(client) };
    (env, admin, oracle, client)
}

fn register_custodian(
    env: &Env,
    client: &CustodyValidatorClient<'static>,
    admin: &Address,
    custodian: &Address,
    types: Vec<Symbol>,
) {
    client.register_custodian(
        admin,
        custodian,
        &Symbol::new(env, "Custodian"),
        &Symbol::new(env, "US"),
        &Symbol::new(env, "LIC_001"),
        &types,
        &0i128,
        &Symbol::new(env, "Insurer"),
    );
}

fn make_attestation(
    env: &Env,
    asset_id: &Address,
    custodian: &Address,
    verification_type: &Symbol,
    proof_hash: [u8; 32],
    expires_in: u64,
) -> CustodyAttestation {
    CustodyAttestation {
        asset_id: asset_id.clone(),
        custodian: custodian.clone(),
        location: Symbol::new(env, "Vault"),
        condition: Symbol::new(env, "excellent"),
        value: 1_000_000i128,
        timestamp: env.ledger().timestamp(),
        proof_hash: BytesN::from_array(env, &proof_hash),
        verification_type: verification_type.clone(),
        insurance_status: Symbol::new(env, "insured"),
        legal_title_hash: BytesN::from_array(env, &[2u8; 32]),
        audit_report_hash: BytesN::from_array(env, &[3u8; 32]),
        multi_sig_signatures: Vec::new(env),
        metadata: Map::new(env),
        is_valid: false,
        expires_at: env.ledger().timestamp() + expires_in,
    }
}

fn key(env: &Env, bytes: [u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, &bytes)
}

fn signature(env: &Env, bytes: [u8; 64]) -> BytesN<64> {
    BytesN::from_array(env, &bytes)
}

/// Install an M-of-3 policy over signers A, B and C.
fn set_three_signer_policy(
    env: &Env,
    client: &CustodyValidatorClient<'static>,
    admin: &Address,
    custodian: &Address,
    required: u32,
) {
    let addresses = Vec::from_array(
        env,
        [
            Address::generate(env),
            Address::generate(env),
            Address::generate(env),
        ],
    );
    client.set_multi_sig_config(
        admin,
        custodian,
        &MultiSigConfig {
            required_signatures: required,
            total_signers: 3,
            signer_keys: Vec::from_array(env, [key(env, PUB_A), key(env, PUB_B), key(env, PUB_C)]),
            signer_addresses: addresses,
        },
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #155: multi-party custody with threshold signature verification
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn multisig_threshold_met_accepts_attestation() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    set_three_signer_policy(&env, &client, &admin, &custodian, 2);

    let asset = Address::generate(&env);
    let attestation = make_attestation(
        &env,
        &asset,
        &custodian,
        &Symbol::new(&env, "real_estate"),
        MULTISIG_MSG,
        86400 * 30,
    );

    let id = client.submit_multisig_attestation(
        &attestation,
        &Vec::from_array(&env, [key(&env, PUB_A), key(&env, PUB_B)]),
        &Vec::from_array(&env, [signature(&env, SIG_A), signature(&env, SIG_B)]),
    );

    assert_eq!(id, 1);
    assert!(client.is_attestation_valid(&id));

    let config = client.get_multi_sig_config(&custodian);
    assert_eq!(config.required_signatures, 2);
    assert_eq!(config.total_signers, 3);
    assert_eq!(config.signer_keys.len(), 3);
}

#[test]
#[should_panic]
fn multisig_insufficient_signatures_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    // 3-of-3 policy, only two signatures supplied.
    set_three_signer_policy(&env, &client, &admin, &custodian, 3);

    let asset = Address::generate(&env);
    let attestation = make_attestation(
        &env,
        &asset,
        &custodian,
        &Symbol::new(&env, "real_estate"),
        MULTISIG_MSG,
        86400 * 30,
    );

    client.submit_multisig_attestation(
        &attestation,
        &Vec::from_array(&env, [key(&env, PUB_A), key(&env, PUB_B)]),
        &Vec::from_array(&env, [signature(&env, SIG_A), signature(&env, SIG_B)]),
    );
}

#[test]
#[should_panic]
fn multisig_duplicate_signers_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    set_three_signer_policy(&env, &client, &admin, &custodian, 2);

    let asset = Address::generate(&env);
    let attestation = make_attestation(
        &env,
        &asset,
        &custodian,
        &Symbol::new(&env, "real_estate"),
        MULTISIG_MSG,
        86400 * 30,
    );

    // Signer A is supplied twice, so only two distinct signers are present.
    client.submit_multisig_attestation(
        &attestation,
        &Vec::from_array(&env, [key(&env, PUB_A), key(&env, PUB_A), key(&env, PUB_C)]),
        &Vec::from_array(&env, [
            signature(&env, SIG_A),
            signature(&env, SIG_A),
            signature(&env, SIG_C),
        ]),
    );
}

#[test]
#[should_panic]
fn multisig_unauthorized_signer_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    set_three_signer_policy(&env, &client, &admin, &custodian, 2);

    let asset = Address::generate(&env);
    let attestation = make_attestation(
        &env,
        &asset,
        &custodian,
        &Symbol::new(&env, "real_estate"),
        MULTISIG_MSG,
        86400 * 30,
    );

    // PUB_X holds a valid key but is not authorised by the policy.
    client.submit_multisig_attestation(
        &attestation,
        &Vec::from_array(&env, [key(&env, PUB_X), key(&env, PUB_B)]),
        &Vec::from_array(&env, [signature(&env, SIG_X), signature(&env, SIG_B)]),
    );
}

#[test]
#[should_panic]
fn multisig_bad_signature_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    set_three_signer_policy(&env, &client, &admin, &custodian, 2);

    let asset = Address::generate(&env);
    let attestation = make_attestation(
        &env,
        &asset,
        &custodian,
        &Symbol::new(&env, "real_estate"),
        MULTISIG_MSG,
        86400 * 30,
    );

    // Authorised key, but the signature is over a different message.
    client.submit_multisig_attestation(
        &attestation,
        &Vec::from_array(&env, [key(&env, PUB_A), key(&env, PUB_B)]),
        &Vec::from_array(&env, [
            signature(&env, SIG_A_WRONG_MESSAGE),
            signature(&env, SIG_B),
        ]),
    );
}

#[test]
#[should_panic]
fn multisig_custodian_cannot_use_single_signer_path() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    set_three_signer_policy(&env, &client, &admin, &custodian, 2);

    let asset = Address::generate(&env);
    let attestation = make_attestation(
        &env,
        &asset,
        &custodian,
        &Symbol::new(&env, "real_estate"),
        MULTISIG_MSG,
        86400 * 30,
    );

    // A custodian with an M-of-N policy must go through the multi-sig path.
    client.submit_attestation(&attestation);
}

#[test]
#[should_panic]
fn multisig_config_requires_registered_custodian() {
    let (env, admin, _oracle, client) = setup();
    let unknown = Address::generate(&env);
    set_three_signer_policy(&env, &client, &admin, &unknown, 2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #157: IoT sensor data integration
// ═══════════════════════════════════════════════════════════════════════════════

fn sensor_reading(
    env: &Env,
    sensor_id: &Symbol,
    asset_id: &Address,
    metric_type: &Symbol,
    value: i128,
) -> IoTSensorData {
    IoTSensorData {
        sensor_id: sensor_id.clone(),
        asset_id: asset_id.clone(),
        metric_type: metric_type.clone(),
        value,
        timestamp: env.ledger().timestamp(),
        signature: BytesN::from_array(env, &[7u8; 64]),
    }
}

#[test]
fn valid_sensor_reading_is_stored() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let asset = Address::generate(&env);
    let sensor_id = Symbol::new(&env, "sensor-1");
    let metric = Symbol::new(&env, "temperature");

    client.register_iot_sensor(&admin, &custodian, &sensor_id, &asset, &metric);
    client.set_alert_threshold(&admin, &metric, &0i128, &100i128);

    let reading = sensor_reading(&env, &sensor_id, &asset, &metric, 42);
    let alert = client.submit_sensor_reading(&custodian, &reading);

    assert!(!alert);
    assert_eq!(client.get_sensor_readings(&sensor_id).len(), 1);
    assert_eq!(client.get_sensor_alert_count(), 0);

    let threshold = client.get_alert_threshold(&metric);
    assert_eq!(threshold.min_value, 0);
    assert_eq!(threshold.max_value, 100);
}

#[test]
fn threshold_breach_raises_alert() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let asset = Address::generate(&env);
    let sensor_id = Symbol::new(&env, "sensor-2");
    let metric = Symbol::new(&env, "temperature");

    client.register_iot_sensor(&admin, &custodian, &sensor_id, &asset, &metric);
    client.set_alert_threshold(&admin, &metric, &0i128, &100i128);

    // Below the band.
    assert!(!client.submit_sensor_reading(
        &custodian,
        &sensor_reading(&env, &sensor_id, &asset, &metric, -5)
    ));
    // Above the band -> alert.
    assert!(client.submit_sensor_reading(
        &custodian,
        &sensor_reading(&env, &sensor_id, &asset, &metric, 150)
    ));

    assert_eq!(client.get_sensor_alert_count(), 1);
    assert_eq!(client.get_sensor_readings(&sensor_id).len(), 2);
}

#[test]
#[should_panic]
fn unauthorized_custodian_sensor_reading_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    let intruder = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );
    register_custodian(
        &env,
        &client,
        &admin,
        &intruder,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let asset = Address::generate(&env);
    let sensor_id = Symbol::new(&env, "sensor-3");
    let metric = Symbol::new(&env, "temperature");
    client.register_iot_sensor(&admin, &custodian, &sensor_id, &asset, &metric);

    client.submit_sensor_reading(
        &intruder,
        &sensor_reading(&env, &sensor_id, &asset, &metric, 42),
    );
}

#[test]
#[should_panic]
fn unknown_sensor_id_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let asset = Address::generate(&env);
    let unknown_sensor = Symbol::new(&env, "sensor-unknown");
    let metric = Symbol::new(&env, "temperature");

    // The sensor was never registered.
    client.submit_sensor_reading(
        &custodian,
        &sensor_reading(&env, &unknown_sensor, &asset, &metric, 42),
    );
}

#[test]
#[should_panic]
fn inactive_sensor_readings_are_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let asset = Address::generate(&env);
    let sensor_id = Symbol::new(&env, "sensor-4");
    let metric = Symbol::new(&env, "temperature");
    client.register_iot_sensor(&admin, &custodian, &sensor_id, &asset, &metric);
    client.set_iot_sensor_status(&admin, &sensor_id, &false);

    client.submit_sensor_reading(
        &custodian,
        &sensor_reading(&env, &sensor_id, &asset, &metric, 42),
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #158: custodian bond slashing for false attestations
// ═══════════════════════════════════════════════════════════════════════════════

/// Submit an attestation for `custodian` and file a dispute against it.
fn file_dispute(
    env: &Env,
    client: &CustodyValidatorClient<'static>,
    custodian: &Address,
    challenger: &Address,
) -> u64 {
    let asset = Address::generate(env);
    let attestation = make_attestation(
        env,
        &asset,
        custodian,
        &Symbol::new(env, "real_estate"),
        [4u8; 32],
        86400 * 30,
    );
    let attestation_id = client.submit_attestation(&attestation);

    client.dispute_attestation(
        &attestation_id,
        challenger,
        &Symbol::new(env, "false_attestation"),
        &100i128,
        &BytesN::from_array(env, &[9u8; 32]),
    )
}

#[test]
fn upheld_dispute_slashes_and_redistributes_bond() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    let challenger = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    client.deposit_bond(&custodian, &1000i128);

    let dispute_id = file_dispute(&env, &client, &custodian, &challenger);
    client.resolve_dispute(
        &admin,
        &dispute_id,
        &Symbol::new(&env, "upheld"),
        &500i128,
    );

    // 1000 - 500; the 500 is split 70 / 20 / 10.
    assert_eq!(client.get_bond_balance(&custodian), 500);
    assert_eq!(client.get_reward_balance(&challenger), 350);
    assert_eq!(client.get_insurance_pool(), 100);
    assert_eq!(client.get_platform_balance(), 50);

    let dispute = client.get_dispute(&dispute_id);
    assert!(dispute.penalty_applied);
    assert_eq!(dispute.penalty_amount, 500);
    assert!(dispute.bond_returned);

    // Reputation is reduced by the policy's penalty points (25).
    assert_eq!(client.get_custodian_info(&custodian).reputation_score, 55);
}

#[test]
fn rejected_dispute_does_not_slash() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    let challenger = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    client.deposit_bond(&custodian, &1000i128);

    let dispute_id = file_dispute(&env, &client, &custodian, &challenger);
    client.resolve_dispute(
        &admin,
        &dispute_id,
        &Symbol::new(&env, "rejected"),
        &500i128,
    );

    assert_eq!(client.get_bond_balance(&custodian), 1000);
    assert_eq!(client.get_reward_balance(&challenger), 0);
    assert_eq!(client.get_insurance_pool(), 0);
    assert_eq!(client.get_platform_balance(), 0);

    let dispute = client.get_dispute(&dispute_id);
    assert!(!dispute.penalty_applied);
    assert_eq!(dispute.penalty_amount, 0);

    // Winning a dispute improves the custodian's reputation.
    assert_eq!(client.get_custodian_info(&custodian).reputation_score, 82);
}

#[test]
fn slash_is_capped_at_total_bond() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    let challenger = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    // Only 100 is posted, but the penalty requested is 250.
    client.deposit_bond(&custodian, &100i128);

    let dispute_id = file_dispute(&env, &client, &custodian, &challenger);
    client.resolve_dispute(
        &admin,
        &dispute_id,
        &Symbol::new(&env, "upheld"),
        &250i128,
    );

    assert_eq!(client.get_bond_balance(&custodian), 0);
    assert_eq!(client.get_reward_balance(&challenger), 70);
    assert_eq!(client.get_insurance_pool(), 20);
    assert_eq!(client.get_platform_balance(), 10);
    assert_eq!(client.get_dispute(&dispute_id).penalty_amount, 100);
}

#[test]
fn custom_reputation_penalty_can_deactivate_custodian() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    let challenger = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "real_estate")]),
    );
    client.deposit_bond(&custodian, &1000i128);
    client.set_slashing_config(
        &admin,
        &SlashingConfig {
            challenger_share_bps: 7000,
            insurance_share_bps: 2000,
            platform_share_bps: 1000,
            reputation_penalty_points: 40,
        },
    );

    let dispute_id = file_dispute(&env, &client, &custodian, &challenger);
    client.resolve_dispute(
        &admin,
        &dispute_id,
        &Symbol::new(&env, "upheld"),
        &100i128,
    );

    // 80 - 40 = 40, below the 50 minimum, so the custodian is deactivated.
    let info = client.get_custodian_info(&custodian);
    assert_eq!(info.reputation_score, 40);
    assert!(!info.is_active);
    assert_eq!(info.failed_disputes, 1);
}

#[test]
#[should_panic]
fn slashing_config_must_sum_to_one_hundred_percent() {
    let (env, admin, _oracle, client) = setup();
    client.set_slashing_config(
        &admin,
        &SlashingConfig {
            challenger_share_bps: 5000,
            insurance_share_bps: 2000,
            platform_share_bps: 1000,
            reputation_penalty_points: 10,
        },
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #159: cross-chain asset verification via bridge attestations
// ═══════════════════════════════════════════════════════════════════════════════

/// Order-independent Merkle node hash, mirroring the contract's construction.
fn hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
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

/// Four leaves; returns the root plus the Merkle path siblings for `leaf1`
/// (`leaf2`, then the `node34` subtree root).
fn sample_tree(env: &Env) -> (BytesN<32>, BytesN<32>, BytesN<32>) {
    let leaf1 = BytesN::from_array(env, &[1u8; 32]);
    let leaf2 = BytesN::from_array(env, &[2u8; 32]);
    let leaf3 = BytesN::from_array(env, &[3u8; 32]);
    let leaf4 = BytesN::from_array(env, &[4u8; 32]);
    let node12 = hash_pair(env, &leaf1, &leaf2);
    let node34 = hash_pair(env, &leaf3, &leaf4);
    let root = hash_pair(env, &node12, &node34);
    (root, leaf2, node34)
}

#[test]
fn valid_cross_chain_proof_is_accepted() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let leaf1 = BytesN::from_array(&env, &[1u8; 32]);
    let (root, sibling, subtree) = sample_tree(&env);

    let chain = Symbol::new(&env, "ethereum");
    let bridge = Address::generate(&env);
    client.add_supported_chain(&admin, &chain, &bridge, &root, &100u64);

    let asset = Address::generate(&env);
    let proof = CrossChainProof {
        proof_id: 0,
        source_chain: chain.clone(),
        block_number: 90,
        tx_hash: leaf1,
        bridge_contract: bridge.clone(),
        merkle_proof: Vec::from_array(&env, [sibling, subtree]),
        asset_id: asset.clone(),
        custodian: custodian.clone(),
        timestamp: 0,
        is_valid: false,
    };

    let id = client.submit_cross_chain_proof(&custodian, &proof);
    assert_eq!(id, 1);
    assert!(client.is_cross_chain_proof_valid(&id));

    let stored = client.get_cross_chain_proof(&id);
    assert_eq!(stored.source_chain, chain);
    assert_eq!(stored.block_number, 90);
    assert_eq!(stored.asset_id, asset);
    assert!(stored.is_valid);

    let registration = client.get_bridge_registration(&Symbol::new(&env, "ethereum"));
    assert_eq!(registration.bridge_contract, bridge);
    assert!(registration.is_active);
}

#[test]
#[should_panic]
fn invalid_merkle_proof_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let leaf1 = BytesN::from_array(&env, &[1u8; 32]);
    let leaf3 = BytesN::from_array(&env, &[3u8; 32]);
    let (root, _sibling, subtree) = sample_tree(&env);

    let chain = Symbol::new(&env, "ethereum");
    let bridge = Address::generate(&env);
    client.add_supported_chain(&admin, &chain, &bridge, &root, &100u64);

    let asset = Address::generate(&env);
    let bad_proof = CrossChainProof {
        proof_id: 0,
        source_chain: chain,
        block_number: 90,
        tx_hash: leaf1,
        bridge_contract: bridge,
        // leaf3 is the wrong sibling for leaf1.
        merkle_proof: Vec::from_array(&env, [leaf3, subtree]),
        asset_id: asset,
        custodian: custodian.clone(),
        timestamp: 0,
        is_valid: false,
    };

    client.submit_cross_chain_proof(&custodian, &bad_proof);
}

#[test]
#[should_panic]
fn unsupported_chain_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let leaf1 = BytesN::from_array(&env, &[1u8; 32]);
    let (root, sibling, subtree) = sample_tree(&env);

    // Only Ethereum is supported.
    let supported = Symbol::new(&env, "ethereum");
    let bridge = Address::generate(&env);
    client.add_supported_chain(&admin, &supported, &bridge, &root, &100u64);

    let asset = Address::generate(&env);
    let proof = CrossChainProof {
        proof_id: 0,
        source_chain: Symbol::new(&env, "polygon"),
        block_number: 90,
        tx_hash: leaf1,
        bridge_contract: bridge,
        merkle_proof: Vec::from_array(&env, [sibling, subtree]),
        asset_id: asset,
        custodian: custodian.clone(),
        timestamp: 0,
        is_valid: false,
    };

    client.submit_cross_chain_proof(&custodian, &proof);
}

#[test]
#[should_panic]
fn removed_chain_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let leaf1 = BytesN::from_array(&env, &[1u8; 32]);
    let (root, sibling, subtree) = sample_tree(&env);

    let chain = Symbol::new(&env, "ethereum");
    let bridge = Address::generate(&env);
    client.add_supported_chain(&admin, &chain, &bridge, &root, &100u64);
    client.remove_supported_chain(&admin, &chain);

    let asset = Address::generate(&env);
    let proof = CrossChainProof {
        proof_id: 0,
        source_chain: chain,
        block_number: 90,
        tx_hash: leaf1,
        bridge_contract: bridge,
        merkle_proof: Vec::from_array(&env, [sibling, subtree]),
        asset_id: asset,
        custodian: custodian.clone(),
        timestamp: 0,
        is_valid: false,
    };

    client.submit_cross_chain_proof(&custodian, &proof);
}

#[test]
#[should_panic]
fn bridge_contract_mismatch_rejected() {
    let (env, admin, _oracle, client) = setup();
    let custodian = Address::generate(&env);
    register_custodian(
        &env,
        &client,
        &admin,
        &custodian,
        Vec::from_array(&env, [Symbol::new(&env, "commodities")]),
    );

    let leaf1 = BytesN::from_array(&env, &[1u8; 32]);
    let (root, sibling, subtree) = sample_tree(&env);

    let chain = Symbol::new(&env, "ethereum");
    let bridge = Address::generate(&env);
    client.add_supported_chain(&admin, &chain, &bridge, &root, &100u64);

    let asset = Address::generate(&env);
    let proof = CrossChainProof {
        proof_id: 0,
        source_chain: chain,
        block_number: 90,
        tx_hash: leaf1,
        // A bridge contract that was never registered.
        bridge_contract: Address::generate(&env),
        merkle_proof: Vec::from_array(&env, [sibling, subtree]),
        asset_id: asset,
        custodian: custodian.clone(),
        timestamp: 0,
        is_valid: false,
    };

    client.submit_cross_chain_proof(&custodian, &proof);
}
