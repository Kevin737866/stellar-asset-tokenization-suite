use soroban_sdk::{Env, Address, Symbol, Map};
use stellar_asset_tokenization_suite::rwa_token::{RWAToken, RWATokenClient, TokenInfo};
use stellar_asset_tokenization_suite::secondary_market::{SecondaryMarket, SecondaryMarketClient};
use stellar_asset_tokenization_suite::compliance_registry::{ComplianceRegistry, ComplianceRegistryClient, KYCStatus};
use proptest::prelude::*;

proptest! {
// ... (existing fuzz_test_transfer_balance_invariant)
// ... (existing fuzz_test_lock_unlock_invariant)
// ... (existing fuzz_test_market_order_cycle)

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
            false
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
    #[test]
    fn fuzz_test_transfer_balance_invariant(
// ... (keep existing fuzz_test_transfer_balance_invariant)
// ... (keep existing fuzz_test_lock_unlock_invariant)
}

proptest! {
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
            &Address::generate(&env)
        );
        rwa_token_client.mint(&admin, &maker, 1000000);

        // Setup Market
        market_client.initialize(
            &admin, 
            &base_currency, 
            &Address::generate(&env), 
            &Address::generate(&env), 
            0, 
            1 // min_order_size
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
            1
        );

        // Fill order
        market_client.fill_order(&taker, order_id, amount);

        // Verify RWA moved from maker (via escrow) to taker
        let balance_maker = rwa_token_client.get_balance(&maker);
        let balance_taker = rwa_token_client.get_balance(&taker);
        
        assert_eq!(balance_maker.amount, 1000000 - amount);
        assert_eq!(balance_taker.amount, amount);
    }
}
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
            &Address::generate(&env)
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

proptest! {
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
            &Address::generate(&env)
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
}

    }
}
