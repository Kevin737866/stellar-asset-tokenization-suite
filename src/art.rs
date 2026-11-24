use crate::asset_class_handlers::{
    set_legal_document_hash, validate_address_not_zero, validate_legal_document_hash,
    validate_metadata_size, AssetClassError,
};
use crate::asset_factory::AssetConfig;
use soroban_sdk::{
    contracterror, contracttype, panic_with_error, Address, BytesN, Env, String, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ArtError {
    InvalidProvenance = 1,
    InvalidAppraisalValue = 2,
    InvalidValuationTimestamp = 3,
}

#[contracttype]
#[derive(Clone)]
pub struct ArtConfig {
    pub artist_name: Symbol,
    pub provenance_hash: BytesN<32>,
    pub insurance_status: bool,
    pub exhibition_voting: bool,
    pub appraisal_value: i128,
    /// Unix timestamp (seconds) at which `appraisal_value` was established.
    /// Must not be in the future (Issue #382).
    pub valuation_timestamp: u64,
    pub authenticity_certificate: Address,
    /// Issue #384: hash of the legal document backing this asset.
    pub legal_document_hash: BytesN<32>,
}

pub fn create_art_config(env: Env, base_config: AssetConfig, art_config: ArtConfig) -> AssetConfig {
    validate_address_not_zero(&env, &art_config.authenticity_certificate);
    validate_metadata_size(&env, base_config.metadata.len(), 100);

    // Issue #382: every artwork needs a provenance record.
    if art_config.provenance_hash == BytesN::from_array(&env, &[0u8; 32]) {
        panic_with_error!(&env, AssetClassError::InvalidProvenance);
    }

    // Issue #382: the appraisal must carry a positive value, and it must be
    // dated in the past (or now) rather than in the future.
    if art_config.appraisal_value <= 0 {
        panic_with_error!(&env, ArtError::InvalidAppraisalValue);
    }
    let current_time = env.ledger().timestamp();
    if art_config.valuation_timestamp == 0 || art_config.valuation_timestamp > current_time {
        panic_with_error!(&env, ArtError::InvalidValuationTimestamp);
    }

    validate_legal_document_hash(&env, &art_config.legal_document_hash);

    let mut metadata = base_config.metadata;
    metadata.set(
        Symbol::new(&env, "artist_name"),
        String::from_str(&env, &art_config.artist_name.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "provenance_hash"),
        String::from_str(&env, &format!("{:?}", art_config.provenance_hash)),
    );
    metadata.set(
        Symbol::new(&env, "insurance_status"),
        String::from_str(&env, &art_config.insurance_status.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "exhibition_voting"),
        String::from_str(&env, &art_config.exhibition_voting.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "appraisal_value"),
        String::from_str(&env, &art_config.appraisal_value.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "valuation_timestamp"),
        String::from_str(&env, &art_config.valuation_timestamp.to_string()),
    );
    set_legal_document_hash(&env, &mut metadata, &art_config.legal_document_hash);

    AssetConfig {
        metadata,
        ..base_config
    }
}
