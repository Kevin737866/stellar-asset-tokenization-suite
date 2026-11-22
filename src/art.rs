use soroban_sdk::{contracterror, contracttype, Address, BytesN, Env, Map, Symbol, Vec, panic_with_error, String};
use crate::asset_factory::AssetConfig;
use crate::asset_class_handlers::{AssetClassError, validate_address_not_zero, validate_metadata_size};

/// Issue #176: the asset type stored on a tokenized artwork, as written by
/// `AssetClass::Art` in the asset factory.
pub const ART_ASSET_TYPE: &str = "Art";

const PROVENANCE_KEY: &str = "art_provenance";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ArtError {
    InvalidProvenance = 1,
    /// Issue #176: only purchase, inheritance, auction and loan are valid.
    InvalidProvenanceMethod = 2,
    InvalidProvenancePrice = 3,
    NotArtAsset = 4,
}

/// Issue #176: how an artwork changed hands.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProvenanceEventType {
    Purchase = 0,
    Inheritance = 1,
    Auction = 2,
    Loan = 3,
}

/// Issue #176: one link in an artwork's chain of custody.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProvenanceEntry {
    pub owner: Address,
    pub acquired_date: u64,
    pub method: Symbol,
    pub price: i128,
    pub location: Symbol,
    pub event_type: ProvenanceEventType,
}

fn provenance_key(env: &Env) -> Symbol {
    Symbol::new(env, PROVENANCE_KEY)
}

/// Issue #176: whether `method` names a supported acquisition method.
pub fn is_valid_provenance_method(env: &Env, method: &Symbol) -> bool {
    [
        Symbol::new(env, "purchase"),
        Symbol::new(env, "inheritance"),
        Symbol::new(env, "auction"),
        Symbol::new(env, "loan"),
    ]
    .contains(method)
}

/// Issue #176: append an entry to an artwork's provenance chain.
///
/// The chain is append-only. There is deliberately no update or delete entry
/// point, so recorded custody history cannot be rewritten.
pub fn append_provenance(env: &Env, token: &Address, entry: ProvenanceEntry) {
    if entry.price < 0 {
        panic_with_error!(env, ArtError::InvalidProvenancePrice);
    }
    if !is_valid_provenance_method(env, &entry.method) {
        panic_with_error!(env, ArtError::InvalidProvenanceMethod);
    }

    let key = provenance_key(env);
    let mut chains: Map<Address, Vec<ProvenanceEntry>> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or(Map::new(env));

    let mut chain = chains
        .get(token.clone())
        .unwrap_or_else(|| Vec::new(env));
    chain.push_back(entry);
    chains.set(token.clone(), chain);

    env.storage().instance().set(&key, &chains);
}

/// Issue #176: the full chain of custody for `token`, oldest first.
pub fn get_provenance(env: &Env, token: &Address) -> Vec<ProvenanceEntry> {
    let chains: Map<Address, Vec<ProvenanceEntry>> = env
        .storage()
        .instance()
        .get(&provenance_key(env))
        .unwrap_or(Map::new(env));

    chains
        .get(token.clone())
        .unwrap_or_else(|| Vec::new(env))
}

#[contracttype]
#[derive(Clone)]
pub struct ArtConfig {
    pub artist_name: Symbol,
    pub provenance_hash: BytesN<32>,
    pub insurance_status: bool,
    pub exhibition_voting: bool,
    pub appraisal_value: i128,
    pub authenticity_certificate: Address,
}

pub fn create_art_config(
    env: Env,
    base_config: AssetConfig,
    art_config: ArtConfig,
) -> AssetConfig {
    validate_address_not_zero(&env, &art_config.authenticity_certificate);
    validate_metadata_size(&env, base_config.metadata.len(), 100);

    if art_config.provenance_hash == BytesN::from_array(&env, &[0u8; 32]) {
        panic_with_error!(&env, AssetClassError::InvalidProvenance);
    }

    let mut metadata = base_config.metadata;
    metadata.set(Symbol::new(&env, "artist_name"), String::from_str(&env, &art_config.artist_name.to_string()));
    metadata.set(Symbol::new(&env, "provenance_hash"), String::from_str(&env, &format!("{:?}", art_config.provenance_hash)));
    metadata.set(Symbol::new(&env, "insurance_status"), String::from_str(&env, &art_config.insurance_status.to_string()));
    metadata.set(Symbol::new(&env, "exhibition_voting"), String::from_str(&env, &art_config.exhibition_voting.to_string()));
    metadata.set(Symbol::new(&env, "appraisal_value"), String::from_str(&env, &art_config.appraisal_value.to_string()));

    AssetConfig {
        metadata,
        ..base_config
    }
}
