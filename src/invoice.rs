use soroban_sdk::{contracttype, Address, Env, Symbol, Vec, panic_with_error, String};
use crate::asset_factory::AssetConfig;
use crate::asset_class_handlers::AssetClassError;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum InvoiceError {
    InvalidDueDate = 1,
    InvalidCreditRating = 2,
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
    if invoice_config.due_date <= current_time {
        panic_with_error!(&env, AssetClassError::InvalidDueDate);
    }

    let valid_ratings = Vec::from_array(&env, [
        Symbol::new(&env, "AAA"),
        Symbol::new(&env, "AA"),
        Symbol::new(&env, "A"),
        Symbol::new(&env, "BBB"),
        Symbol::new(&env, "BB"),
        Symbol::new(&env, "B"),
        Symbol::new(&env, "CCC"),
    ]);
    
    if !valid_ratings.contains(&invoice_config.credit_rating) {
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
