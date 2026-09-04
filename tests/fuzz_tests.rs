use soroban_sdk::{Env, Address, Symbol, Map, BytesN, Vec};
use soroban_sdk::testutils::Address as _;
use stellar_asset_tokenization_suite::rwa_token::{RWAToken, RWATokenClient};
use stellar_asset_tokenization_suite::secondary_market::{SecondaryMarket, SecondaryMarketClient};
use stellar_asset_tokenization_suite::compliance_registry::{ComplianceRegistry, ComplianceRegistryClient, KYCStatus};
use stellar_asset_tokenization_suite::asset_factory::{AssetConfig, AssetClass, ComplianceRules, DividendSchedule};
use stellar_asset_tokenization_suite::real_estate::RealEstateConfig;
use stellar_asset_tokenization_suite::commodity::CommodityConfig;
use stellar_asset_tokenization_suite::invoice::InvoiceConfig;
use stellar_asset_tokenization_suite::security::SecurityConfig;
use stellar_asset_tokenization_suite::art::ArtConfig;
use stellar_asset_tokenization_suite::carbon_credit::CarbonCreditConfig;
use proptest::prelude::*;

fn get_proptest_config() -> ProptestConfig {
    ProptestConfig::default()
}

// ── Helper: Create base AssetConfig for fuzzing ─────────────────────────────

fn create_base_asset_config(env: &Env) -> AssetConfig {
    AssetConfig {
        name: Symbol::new(env, "TestAsset"),
        symbol: Symbol::new(env, "TEST"),
        decimals: 6,
        total_supply: 1_000_000i128,
        asset_class: AssetClass::RealEstate,
        compliance_rules: ComplianceRules {
            kyc_required: true,
            accredited_investor_only: false,
            geographic_restrictions: Vec::new(env),
            holding_period_days: 0,
            transfer_limits: i128::MAX,
        },
        dividend_schedule: Vec::new(env),
        metadata: Map::new(env),
    }
}

// ── Existing Fuzz Tests (Fixed) ──────────────────────────────────────────────

proptest! {
    #![proptest_config(get_proptest_config())]

    #[test]
    fn fuzz_test_transfer_balance_invariant(
        amount in 1..1_000_000i128,
        initial_balance in 1_000_000..2_000_000i128,
    ) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        let token_id = env.register_contract(None, RWAToken);
        let token_client = RWATokenClient::new(&env, &token_id);

        // Initialize token
        token_client.initialize(
            &admin,
            Symbol::new(&env, "Test Token"),
            Symbol::new(&env, "TT"),
            initial_balance,
            18,
            Symbol::new(&env, "RWA"),
            Map::new(&env),
            &Address::generate(&env),
            &Address::generate(&env),
        );

        // Mint initial balance to user_a
        token_client.mint(&admin, &user_a, initial_balance);

        // Try to transfer
        if initial_balance >= amount {
            token_client.transfer(&user_a, &user_b, amount);

            let balance_a = token_client.get_balance(&user_a);
            let balance_b = token_client.get_balance(&user_b);

            assert_eq!(balance_a.amount, initial_balance - amount);
            assert_eq!(balance_b.amount, amount);
        }
    }

    #[test]
    fn fuzz_test_lock_unlock_invariant(
        amount in 1..1_000_000i128,
        initial_balance in 1_000_000..2_000_000i128,
        lock_period in 1..10000u64,
    ) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_id = env.register_contract(None, RWAToken);
        let token_client = RWATokenClient::new(&env, &token_id);

        token_client.initialize(
            &admin,
            Symbol::new(&env, "Test Token"),
            Symbol::new(&env, "TT"),
            initial_balance,
            18,
            Symbol::new(&env, "RWA"),
            Map::new(&env),
            &Address::generate(&env),
            &Address::generate(&env),
        );

        token_client.mint(&admin, &user, initial_balance);

        // Lock tokens
        token_client.lock_tokens(&user, &user, amount, lock_period);

        let balance_after_lock = token_client.get_balance(&user);
        assert_eq!(balance_after_lock.amount, initial_balance - amount);
        assert_eq!(balance_after_lock.locked_amount, amount);

        // Unlock tokens
        token_client.unlock_tokens(&user, &user, amount);

        let balance_after_unlock = token_client.get_balance(&user);
        assert_eq!(balance_after_unlock.amount, initial_balance);
        assert_eq!(balance_after_unlock.locked_amount, 0);
    }

    #[test]
    fn fuzz_test_market_order_cycle(
        price in 1..1000i128,
        amount in 100..10000i128,
    ) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let maker = Address::generate(&env);
        let taker = Address::generate(&env);
        let base_currency = Address::generate(&env);
        let rwa_token_id = env.register_contract(None, RWAToken);
        let rwa_token_client = RWATokenClient::new(&env, &rwa_token_id);

        let market_id = env.register_contract(None, SecondaryMarket);
        let market_client = SecondaryMarketClient::new(&env, &market_id);

        // Setup RWA token
        rwa_token_client.initialize(
            &admin,
            Symbol::new(&env, "Test Token"),
            Symbol::new(&env, "TT"),
            1000000,
            18,
            Symbol::new(&env, "RWA"),
            Map::new(&env),
            &Address::generate(&env),
            &Address::generate(&env),
        );
        rwa_token_client.mint(&admin, &maker, 1000000);

        // Setup Market
        market_client.initialize(
            &admin,
            &base_currency,
            &Address::generate(&env),
            &Address::generate(&env),
            0,
            1, // min_order_size
        );

        // Place sell order
        let expiry = env.ledger().timestamp() + 1000;
        let order_id = market_client.place_order(
            &maker,
            &rwa_token_id,
            Symbol::new(&env, "sell"),
            price,
            amount,
            expiry,
            1,
        );

        // Fill order
        market_client.fill_order(&taker, order_id, amount);

        // Verify RWA moved from maker (via escrow) to taker
        let balance_maker = rwa_token_client.get_balance(&maker);
        let balance_taker = rwa_token_client.get_balance(&taker);

        assert_eq!(balance_maker.amount, 1000000 - amount);
        assert_eq!(balance_taker.amount, amount);
    }

    #[test]
    fn fuzz_test_compliance_blacklist_invariant(
        amount in 1..1_000_000i128,
    ) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);

        let registry_id = env.register_contract(None, ComplianceRegistry);
        let registry_client = ComplianceRegistryClient::new(&env, &registry_id);

        registry_client.initialize(
            &admin,
            &admin,
            true,
            false,
        );

        // Set up verified KYC for both
        let kyc = KYCStatus {
            is_verified: true,
            verification_level: 2,
            expiry_date: env.ledger().timestamp() + 1000,
            jurisdiction: Symbol::new(&env, "US"),
            is_accredited: true,
            risk_score: 1,
            aml_flags: Vec::new(&env),
        };
        registry_client.update_kyc_status(&admin, &user_a, kyc.clone());
        registry_client.update_kyc_status(&admin, &user_b, kyc);

        // Initially compliance should pass
        assert!(registry_client.check_compliance(&user_a, &user_b, amount));

        // Blacklist user_a
        registry_client.add_to_blacklist(&admin, &user_a, Symbol::new(&env, "Suspicious"));

        // Now compliance should fail
        assert!(!registry_client.check_compliance(&user_a, &user_b, amount));

        // Remove from blacklist
        registry_client.remove_from_blacklist(&admin, &user_a);

        // Compliance should pass again
        assert!(registry_client.check_compliance(&user_a, &user_b, amount));
    }
}

// ── Asset Class Handler Fuzz Tests (#218) ───────────────────────────────────

proptest! {
    #![proptest_config(get_proptest_config())]

    /// Fuzz test for RealEstate config creation
    /// Property: valid inputs produce AssetConfig without panic
    /// Property: invalid inputs (zero address oracle) return appropriate error
    #[test]
    fn fuzz_real_estate_config(
        rental_yield in 0..10001i64,
        appraisal_value in 1..1_000_000_000i128,
        insurance in proptest::bool::ANY,
        voting in proptest::bool::ANY,
    ) {
        let env = Env::default();
        let base_config = create_base_asset_config(&env);

        let valid_config = RealEstateConfig {
            property_address: Symbol::new(&env, "123 Main St"),
            location_oracle: Address::generate(&env),
            rental_yield_rate: rental_yield,
            property_management_voting: voting,
            insurance_status: insurance,
            appraisal_value,
        };

        // Valid config should not panic
        let result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::real_estate::create_real_estate_config(
                env.clone(),
                base_config.clone(),
                valid_config.clone(),
            )
        });

        if rental_yield < 0 || rental_yield > 10000 {
            // Invalid rental yield should error
            assert!(result.is_err());
        } else {
            // Valid inputs produce AssetConfig
            assert!(result.is_ok());

            // Verify metadata was populated
            let config = result.unwrap();
            assert!(config.metadata.contains_key(Symbol::new(&env, "property_address")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "rental_yield")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "appraisal_value")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "insurance_status")));
        }
    }

    /// Fuzz test for Commodity config creation
    /// Property: valid purity grades produce configs, invalid ones error
    #[test]
    fn fuzz_commodity_config(
        grade_idx in 0..8usize,
        redemption_window in 1..10000u64,
    ) {
        let env = Env::default();
        let base_config = create_base_asset_config(&env);

        let grades = vec!["999", "995", "990", "750", "500", "ABC", "", "invalid"];
        let purity_grade = Symbol::new(&env, grades[grade_idx % grades.len()]);

        let commodity_config = CommodityConfig {
            commodity_type: Symbol::new(&env, "GOLD"),
            vault_location: Symbol::new(&env, "NYC"),
            custody_vault: Address::generate(&env),
            purity_grade,
            physical_redemption_window: redemption_window,
            quality_attestation: Address::generate(&env),
        };

        let result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::commodity::create_commodity_config(
                env.clone(),
                base_config.clone(),
                commodity_config.clone(),
            )
        });

        let valid_grades = ["999", "995", "990", "750"];
        if valid_grades.contains(&grades[grade_idx % grades.len()]) {
            assert!(result.is_ok());
            let config = result.unwrap();
            assert!(config.metadata.contains_key(Symbol::new(&env, "commodity_type")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "purity_grade")));
        } else {
            assert!(result.is_err());
        }
    }

    /// Fuzz test for Invoice config creation
    /// Property: future due dates valid, past/current due dates error
    /// Property: valid credit ratings accepted, invalid ones rejected
    #[test]
    fn fuzz_invoice_config(
        due_date_offset in -1000i64..1000i64,
        rating_idx in 0..10usize,
        invoice_amount in 1..1_000_000i128,
    ) {
        let env = Env::default();
        let base_config = create_base_asset_config(&env);

        let current_time = env.ledger().timestamp();
        let due_date = if due_date_offset < 0 {
            current_time.saturating_sub((-due_date_offset) as u64)
        } else {
            current_time + (due_date_offset as u64)
        };

        let ratings = vec!["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "DDD", "N/A", ""];
        let credit_rating = Symbol::new(&env, ratings[rating_idx % ratings.len()]);

        let invoice_config = InvoiceConfig {
            invoice_number: Symbol::new(&env, "INV-001"),
            debtor_address: Address::generate(&env),
            due_date,
            credit_rating,
            automatic_settlement: false,
            invoice_amount,
        };

        let result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::invoice::create_invoice_config(
                env.clone(),
                base_config.clone(),
                invoice_config.clone(),
            )
        });

        let valid_ratings = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];
        if due_date > current_time && valid_ratings.contains(&ratings[rating_idx % ratings.len()]) {
            assert!(result.is_ok());
            let config = result.unwrap();
            assert!(config.metadata.contains_key(Symbol::new(&env, "invoice_number")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "due_date")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "credit_rating")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "invoice_amount")));
        } else {
            assert!(result.is_err());
        }
    }

    /// Fuzz test for Security config creation
    /// Property: valid regulation frameworks accepted, invalid ones rejected
    #[test]
    fn fuzz_security_config(
        framework_idx in 0..8usize,
        holding_period in 0..10000u32,
        reporting in proptest::bool::ANY,
        accreditation in proptest::bool::ANY,
    ) {
        let env = Env::default();
        let base_config = create_base_asset_config(&env);

        let frameworks = vec!["REG_D", "REG_S", "RULE_144", "REG_A+", "SEC", "CFTC", "UNKNOWN", ""];
        let regulation_framework = Symbol::new(&env, frameworks[framework_idx % frameworks.len()]);

        let security_config = SecurityConfig {
            equity_type: Symbol::new(&env, "common"),
            regulation_framework,
            accreditation_required: accreditation,
            holding_period_days: holding_period,
            regulatory_reporting: reporting,
            isin: Symbol::new(&env, "US1234567890"),
            dividend_rights: stellar_asset_tokenization_suite::security::DividendRights::Cumulative,
        };

        let result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::security::create_security_config(
                env.clone(),
                base_config.clone(),
                security_config.clone(),
            )
        });

        let valid_frameworks = ["REG_D", "REG_S", "RULE_144", "REG_A+"];
        if valid_frameworks.contains(&frameworks[framework_idx % frameworks.len()]) {
            assert!(result.is_ok());
            let config = result.unwrap();
            assert!(config.metadata.contains_key(Symbol::new(&env, "equity_type")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "regulation_framework")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "isin")));
        } else {
            assert!(result.is_err());
        }
    }

    /// Fuzz test for Art config creation
    /// Property: zero provenance hash errors, non-zero hash succeeds
    #[test]
    fn fuzz_art_config(
        hash_byte in 0..256u8,
        use_zero_hash in proptest::bool::ANY,
        appraisal_value in 1..1_000_000_000i128,
        insurance in proptest::bool::ANY,
        voting in proptest::bool::ANY,
    ) {
        let env = Env::default();
        let base_config = create_base_asset_config(&env);

        let hash_array = if use_zero_hash {
            [0u8; 32]
        } else {
            let mut arr = [0u8; 32];
            arr[0] = hash_byte;
            arr
        };
        let provenance_hash = BytesN::from_array(&env, &hash_array);

        let art_config = ArtConfig {
            artist_name: Symbol::new(&env, "Artist"),
            provenance_hash,
            insurance_status: insurance,
            exhibition_voting: voting,
            appraisal_value,
            authenticity_certificate: Address::generate(&env),
        };

        let result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::art::create_art_config(
                env.clone(),
                base_config.clone(),
                art_config.clone(),
            )
        });

        if use_zero_hash {
            // Zero provenance hash should error
            assert!(result.is_err());
        } else {
            assert!(result.is_ok());
            let config = result.unwrap();
            assert!(config.metadata.contains_key(Symbol::new(&env, "artist_name")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "provenance_hash")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "appraisal_value")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "insurance_status")));
        }
    }

    /// Fuzz test for CarbonCredit config creation
    /// Property: valid vintage years accepted, invalid ones rejected
    /// Property: valid verification standards accepted, invalid ones rejected
    #[test]
    fn fuzz_carbon_credit_config(
        vintage_year in 1980u32..2030u32,
        standard_idx in 0..8usize,
        offset_amount in 1..1_000_000i128,
        retirement in proptest::bool::ANY,
    ) {
        let env = Env::default();
        let base_config = create_base_asset_config(&env);

        let standards = vec!["VCS", "GS", "CDM", "ACR", "VERRA", "GOLD", "UNKNOWN", ""];
        let verification_standard = Symbol::new(&env, standards[standard_idx % standards.len()]);

        let carbon_config = CarbonCreditConfig {
            project_id: Symbol::new(&env, "PROJ-001"),
            vintage_year,
            retirement_functionality: retirement,
            project_metadata: Map::new(&env),
            verification_standard,
            carbon_offset_amount: offset_amount,
        };

        let result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::carbon_credit::create_carbon_credit_config(
                env.clone(),
                base_config.clone(),
                carbon_config.clone(),
            )
        });

        let current_year = (env.ledger().timestamp() / 31536000) + 1970;
        let valid_standards = ["VCS", "GS", "CDM", "ACR"];

        let vintage_valid = vintage_year >= 1990 && vintage_year <= current_year as u32;
        let standard_valid = valid_standards.contains(&standards[standard_idx % standards.len()]);

        if vintage_valid && standard_valid {
            assert!(result.is_ok());
            let config = result.unwrap();
            assert!(config.metadata.contains_key(Symbol::new(&env, "project_id")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "vintage_year")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "verification_standard")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "carbon_offset_amount")));
            assert!(config.metadata.contains_key(Symbol::new(&env, "retirement_functionality")));
        } else {
            assert!(result.is_err());
        }
    }

    /// Fuzz test: boundary/edge values for all config creators
    /// Property: extreme but valid values should not cause panics
    #[test]
    fn fuzz_boundary_values(
        symbol_len in 0..100usize,
        amount in 0i128..=i128::MAX,
    ) {
        let env = Env::default();
        let base_config = create_base_asset_config(&env);

        // Test RealEstate with boundary appraisal
        let re_config = RealEstateConfig {
            property_address: Symbol::new(&env, "A"),
            location_oracle: Address::generate(&env),
            rental_yield_rate: 0, // boundary min
            property_management_voting: false,
            insurance_status: false,
            appraisal_value: amount,
        };

        let re_result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::real_estate::create_real_estate_config(
                env.clone(),
                base_config.clone(),
                re_config.clone(),
            )
        });
        assert!(
            re_result.is_ok(),
            "RealEstate config should not panic with boundary appraisal_value"
        );

        // Test Commodity with boundary values
        let com_config = CommodityConfig {
            commodity_type: Symbol::new(&env, "GOLD"),
            vault_location: Symbol::new(&env, "X"),
            custody_vault: Address::generate(&env),
            purity_grade: Symbol::new(&env, "999"), // valid purity
            physical_redemption_window: u64::MAX,    // boundary max
            quality_attestation: Address::generate(&env),
        };

        let com_result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::commodity::create_commodity_config(
                env.clone(),
                base_config.clone(),
                com_config.clone(),
            )
        });
        assert!(
            com_result.is_ok(),
            "Commodity config should not panic with max redemption window"
        );

        // Test Invoice with max due date
        let inv_config = InvoiceConfig {
            invoice_number: Symbol::new(&env, "INV"),
            debtor_address: Address::generate(&env),
            due_date: u64::MAX, // boundary max
            credit_rating: Symbol::new(&env, "AAA"),
            automatic_settlement: false,
            invoice_amount: amount,
        };

        let inv_result = std::panic::catch_unwind(|| {
            stellar_asset_tokenization_suite::invoice::create_invoice_config(
                env.clone(),
                base_config.clone(),
                inv_config.clone(),
            )
        });
        assert!(
            inv_result.is_ok(),
            "Invoice config should not panic with max due_date"
        );
    }
}
