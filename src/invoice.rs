use crate::asset_class_handlers::{
    set_legal_document_hash, validate_address_not_zero, validate_date_range,
    validate_legal_document_hash, validate_metadata_size, AssetClassError,
};
use crate::asset_factory::AssetConfig;
use soroban_sdk::{
    contracterror, contracttype, panic_with_error, Address, BytesN, Env, String, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum InvoiceError {
    InvalidDueDate = 1,
    InvalidCreditRating = 2,
    InvalidInvoiceAmount = 3,
    InvalidOutstandingBalance = 4,
}

#[contracttype]
#[derive(Clone)]
pub struct InvoiceConfig {
    pub invoice_number: Symbol,
    pub debtor_address: Address,
    /// Unix timestamp (seconds) at which the receivable matures. Must be in
    /// the future when the token is created (Issue #380).
    pub due_date: u64,
    pub credit_rating: Symbol,
    pub automatic_settlement: bool,
    /// Face value of the invoice, in the asset's base currency units.
    pub invoice_amount: i128,
    /// Part of the face value that is still owed. Never negative and never
    /// greater than `invoice_amount` (Issue #380).
    pub outstanding_balance: i128,
    /// Issue #384: hash of the legal document backing this asset.
    pub legal_document_hash: BytesN<32>,
}

pub fn create_invoice_config(
    env: Env,
    base_config: AssetConfig,
    invoice_config: InvoiceConfig,
) -> AssetConfig {
    let current_time = env.ledger().timestamp();

    // Issue #380: an invoice token must mature in the future. The previous
    // argument order rejected every future due date and accepted past ones.
    validate_date_range(&env, current_time, invoice_config.due_date);
    validate_address_not_zero(&env, &invoice_config.debtor_address);
    validate_metadata_size(&env, base_config.metadata.len(), 100);
    validate_legal_document_hash(&env, &invoice_config.legal_document_hash);

    // Issue #380: the face value must be positive and the outstanding balance
    // must be a real part of it.
    if invoice_config.invoice_amount <= 0 {
        panic_with_error!(&env, InvoiceError::InvalidInvoiceAmount);
    }
    if invoice_config.outstanding_balance < 0
        || invoice_config.outstanding_balance > invoice_config.invoice_amount
    {
        panic_with_error!(&env, InvoiceError::InvalidOutstandingBalance);
    }

    let valid_ratings = Vec::from_array(
        &env,
        [
            Symbol::new(&env, "AAA"),
            Symbol::new(&env, "AA"),
            Symbol::new(&env, "A"),
            Symbol::new(&env, "BBB"),
            Symbol::new(&env, "BB"),
            Symbol::new(&env, "B"),
            Symbol::new(&env, "CCC"),
        ],
    );

    if !valid_ratings.contains(&invoice_config.credit_rating) {
        panic_with_error!(&env, AssetClassError::InvalidCreditRating);
    }

    let mut metadata = base_config.metadata;
    metadata.set(
        Symbol::new(&env, "invoice_number"),
        String::from_str(&env, &invoice_config.invoice_number.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "debtor_address"),
        String::from_str(&env, &format!("{:?}", invoice_config.debtor_address)),
    );
    metadata.set(
        Symbol::new(&env, "due_date"),
        String::from_str(&env, &invoice_config.due_date.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "credit_rating"),
        String::from_str(&env, &invoice_config.credit_rating.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "invoice_amount"),
        String::from_str(&env, &invoice_config.invoice_amount.to_string()),
    );
    metadata.set(
        Symbol::new(&env, "outstanding_balance"),
        String::from_str(&env, &invoice_config.outstanding_balance.to_string()),
    );
    set_legal_document_hash(&env, &mut metadata, &invoice_config.legal_document_hash);

    AssetConfig {
        metadata,
        ..base_config
    }
}
