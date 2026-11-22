use soroban_sdk::{contracterror, contracttype, Address, Env, Symbol, panic_with_error, String};
use crate::asset_factory::AssetConfig;
use crate::asset_class_handlers::{AssetClassError, validate_address_not_zero, validate_date_range, validate_metadata_size};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum InvoiceError {
    InvalidDueDate = 1,
    InvalidCreditRating = 2,
}

/// Issue #173: how many rating changes are retained per invoice asset.
pub const RATING_HISTORY_LIMIT: u32 = 10;

/// Issue #173: the current compliance posture of an invoice asset.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InvoiceRatingStatus {
    pub current_rating: Symbol,
    /// True once the rating drops below investment grade (below BBB).
    pub compliance_flagged: bool,
    /// True once the rating drops below B; transfers are restricted.
    pub transfer_restricted: bool,
}

/// Issue #173: one entry in an invoice asset's rating history.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreditRatingRecord {
    pub rating: Symbol,
    pub timestamp: u64,
}

/// Issue #173: rank a credit rating from best (1) to worst (7).
///
/// Returns `None` for a rating outside the supported scale.
pub fn credit_rating_rank(env: &Env, rating: &Symbol) -> Option<u32> {
    for (index, name) in ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"]
        .iter()
        .enumerate()
    {
        if *rating == Symbol::new(env, name) {
            return Some(index as u32 + 1);
        }
    }
    None
}

/// Issue #173: the supported rating scale.
pub fn is_valid_credit_rating(env: &Env, rating: &Symbol) -> bool {
    credit_rating_rank(env, rating).is_some()
}

/// Issue #173: a rating below BBB is below investment grade and raises a
/// compliance flag.
pub fn is_below_investment_grade(env: &Env, rating: &Symbol) -> bool {
    credit_rating_rank(env, rating).map_or(false, |rank| rank > 4)
}

/// Issue #173: a rating below B is distressed and restricts transfers.
pub fn requires_transfer_restriction(env: &Env, rating: &Symbol) -> bool {
    credit_rating_rank(env, rating).map_or(false, |rank| rank > 6)
}

#[contracttype]
#[derive(Clone)]
pub struct InvoiceConfig {
    pub invoice_number: Symbol,
    pub debtor_address: Address,
    pub due_date: u64,
    pub credit_rating: Symbol,
    pub automatic_settlement: bool,
    pub invoice_amount: i128,
}

pub fn create_invoice_config(
    env: Env,
    base_config: AssetConfig,
    invoice_config: InvoiceConfig,
) -> AssetConfig {
    let current_time = env.ledger().timestamp();
    validate_date_range(&env, invoice_config.due_date, current_time);
    validate_address_not_zero(&env, &invoice_config.debtor_address);
    validate_metadata_size(&env, base_config.metadata.len(), 100);

    if !is_valid_credit_rating(&env, &invoice_config.credit_rating) {
        panic_with_error!(&env, AssetClassError::InvalidCreditRating);
    }

    let mut metadata = base_config.metadata;
    metadata.set(Symbol::new(&env, "invoice_number"), String::from_str(&env, &invoice_config.invoice_number.to_string()));
    metadata.set(Symbol::new(&env, "debtor_address"), String::from_str(&env, &format!("{:?}", invoice_config.debtor_address)));
    metadata.set(Symbol::new(&env, "due_date"), String::from_str(&env, &invoice_config.due_date.to_string()));
    metadata.set(Symbol::new(&env, "credit_rating"), String::from_str(&env, &invoice_config.credit_rating.to_string()));
    metadata.set(Symbol::new(&env, "invoice_amount"), String::from_str(&env, &invoice_config.invoice_amount.to_string()));

    AssetConfig {
        metadata,
        ..base_config
    }
}
