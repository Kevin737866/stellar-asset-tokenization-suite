# Soroban Contract: Compliance Registry

Source: `src/compliance_registry.rs`

## Overview

The **ComplianceRegistry** contract is the central KYC/AML and transfer rule enforcement layer. It provides:

- **KYC Status Management** — Store and retrieve verification levels, expiry, jurisdictions, and risk scores
- **Blacklist/Whitelist** — Block or allow specific addresses
- **Transfer Limits** — Daily, monthly, and annual limits with automatic resets
- **Compliance Rules** — Configurable rule sets (Rule 144, Reg D, Reg S, etc.)
- **Compliance Checks** — Read-only transfer validation and stateful limit consuming

## Data Types

### `ComplianceError`
| Variant | Code | Description |
|---------|------|-------------|
| `AlreadyInitialized` | 301 | Registry already initialized |
| `NotInitialized` | 302 | Registry not yet initialized |
| `UserNotFound` | 303 | User not found in registry |
| `KYCNotVerified` | 304 | KYC verification required |
| `Blacklisted` | 305 | Address is blacklisted |
| `InvalidJurisdiction` | 306 | Jurisdiction not supported |
| `AccreditationRequired` | 307 | Accredited investor required |
| `TransferLimitExceeded` | 308 | Transfer limit exceeded |
| `Unauthorized` | 309 | Caller not authorized |

### `KYCStatus`
| Field | Type | Description |
|-------|------|-------------|
| `is_verified` | `bool` | KYC verified flag |
| `verification_level` | `u32` | Level 0-3 (0=unverified) |
| `expiry_date` | `u64` | KYC expiry timestamp |
| `jurisdiction` | `Symbol` | Jurisdiction code (e.g., "US") |
| `is_accredited` | `bool` | Accredited investor status |
| `risk_score` | `u32` | AML risk score (lower = safer) |
| `aml_flags` | `Vec<Symbol>` | Active AML flags |

### `TransferLimits`
| Field | Type | Description |
|-------|------|-------------|
| `daily_limit` | `i128` | Maximum daily transfer amount |
| `monthly_limit` | `i128` | Maximum monthly transfer amount |
| `annual_limit` | `i128` | Maximum annual transfer amount |
| `remaining_daily` | `i128` | Remaining daily allowance |
| `remaining_monthly` | `i128` | Remaining monthly allowance |
| `remaining_annual` | `i128` | Remaining annual allowance |
| `last_reset_daily` | `u64` | Last daily reset timestamp |
| `last_reset_monthly` | `u64` | Last monthly reset timestamp |
| `last_reset_annual` | `u64` | Last annual reset timestamp |

### `ComplianceRule`
| Field | Type | Description |
|-------|------|-------------|
| `rule_name` | `Symbol` | Rule identifier (e.g., "rule_144") |
| `description` | `Symbol` | Human-readable description |
| `is_active` | `bool` | Whether rule is enforced |
| `rule_type` | `Symbol` | Category (e.g., "holding_period") |
| `parameters` | `Map<Symbol, Symbol>` | Rule-specific parameters |

---

## Public Entry Points

### `initialize(env, auth, admin, kyc_required, transfer_restrictions)`

Initializes registry state with default compliance rules.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Authorizing address |
| `admin` | `Address` | Registry admin |
| `kyc_required` | `bool` | Whether KYC is required by default |
| `transfer_restrictions` | `bool` | Whether transfer limits are enforced |

**Auth:** `auth.require_auth()`

**Returns:** Nothing

**Errors:**
- `AlreadyInitialized` — Already initialized

**Events:**
- `initialized` with topics `(admin, kyc_required)`

**Example:**
```rust
let registry_id = env.register_contract(None, ComplianceRegistry);
let registry = ComplianceRegistryClient::new(&env, &registry_id);
registry.initialize(&admin, &admin, &true, &false);
```

---

### `migrate(env, auth)`

Admin storage migration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

**Auth:** Admin check

**Returns:** Nothing

---

### `update_kyc_status(env, auth, user, kyc_status)`

Stores KYC status for a user.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `user` | `Address` | User to update |
| `kyc_status` | `KYCStatus` | New KYC status |

**Auth:** Admin check

**Events:**
- `kyc_updated` with topics `(user, verification_level)`

**Example:**
```rust
let kyc = KYCStatus {
    is_verified: true,
    verification_level: 2,
    expiry_date: env.ledger().timestamp() + 86400 * 365,
    jurisdiction: Symbol::new(&env, "US"),
    is_accredited: true,
    risk_score: 1,
    aml_flags: Vec::new(&env),
};
registry.update_kyc_status(&admin, &user, &kyc);
```

---

### `get_kyc_status(env, user) -> KYCStatus`

Returns KYC status for a user, or a default unverified record.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `user` | `Address` | User to query |

**Returns:** `KYCStatus` — Stored status or default (unverified)

**Example:**
```rust
let status = registry.get_kyc_status(&user);
if status.is_verified && status.verification_level >= 2 {
    // Allow operation
}
```

---

### `add_to_blacklist(env, auth, address, reason)`

Adds an address to the blacklist, blocking all transfers involving it.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `address` | `Address` | Address to blacklist |
| `reason` | `Symbol` | Reason for blacklisting |

**Auth:** Admin check

**Events:**
- `blacklisted` with topics `(address, reason)`

**Example:**
```rust
registry.add_to_blacklist(&admin, &suspicious_address, &Symbol::new(&env, "fraud"));
```

---

### `remove_from_blacklist(env, auth, address)`

Removes an address from the blacklist.

**Events:**
- `unblacklisted` with topics `(address)`

---

### `add_to_whitelist(env, auth, address)`

Adds an address to the whitelist, bypassing KYC requirements.

**Events:**
- `whitelisted` with topics `(address)`

---

### `remove_from_whitelist(env, auth, address)`

Removes an address from the whitelist, re-enforcing KYC checks.

**Events:**
- `unwhitelisted` with topics `(address)`

---

### `check_compliance(env, from, to, amount) -> bool`

Read-only compliance check for a transfer between two addresses.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `from` | `Address` | Sender address |
| `to` | `Address` | Recipient address |
| `amount` | `i128` | Transfer amount |

**Returns:** `bool` — `true` if compliant

**Checks:**
1. Neither party is blacklisted
2. If KYC required: both parties are verified and KYC not expired
3. Accredited investor rules applied
4. Geographic/jurisdiction restrictions

**Events:**
- `compliance_check` with topics `(from, to, amount, result)`

**Example:**
```rust
let passes = registry.check_compliance(&sender, &recipient, &1000);
if !passes {
    // Reject transfer
}
```

---

### `check_outbound_participant(env, participant, amount) -> bool`

Read-only check for a single participant's outbound eligibility.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `participant` | `Address` | Address to check |
| `amount` | `i128` | Transfer amount |

**Returns:** `bool`

**Events:**
- `outbound_compliance_check` with topics `(participant, amount, result)`

---

### `check_transfer_limits(env, user, amount) -> bool`

Stateful transfer limit check. **Consumes** remaining limit allowances.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `user` | `Address` | User to check limits for |
| `amount` | `i128` | Transfer amount |

**Returns:** `bool` — `true` if within all active limits

**Events:**
- `transfer_limit_check` with topics `(user, amount, result)`

---

### `set_transfer_limits(env, auth, user, limits)`

Sets transfer limits for a specific user.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `user` | `Address` | User to configure |
| `limits` | `TransferLimits` | Limit configuration |

**Auth:** Admin check

---

### `get_compliance_rules(env) -> Vec<ComplianceRule>`

Returns all configured compliance rules.

**Returns:** `Vec<ComplianceRule>`

**Example:**
```rust
let rules = registry.get_compliance_rules();
for rule in rules.iter() {
    // rule.rule_name, rule.is_active, etc.
}
```

---

### `update_compliance_rule(env, auth, rule)`

Updates or inserts a compliance rule.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `rule` | `ComplianceRule` | Rule to update/insert |

**Auth:** Admin check

**Events:**
- `compliance_rule_updated` with topics `(rule_name, is_active)`

---

## Event Catalog

| Event | Topics | Emitted By |
|-------|--------|------------|
| `initialized` | `admin, kyc_required` | `initialize()` |
| `migrated` | `old_version, new_version` | `migrate()` |
| `kyc_updated` | `user, verification_level` | `update_kyc_status()` |
| `blacklisted` | `address, reason` | `add_to_blacklist()` |
| `unblacklisted` | `address` | `remove_from_blacklist()` |
| `whitelisted` | `address` | `add_to_whitelist()` |
| `unwhitelisted` | `address` | `remove_from_whitelist()` |
| `compliance_check` | `from, to, amount, result` | `check_compliance()` |
| `outbound_compliance_check` | `participant, amount, result` | `check_outbound_participant()` |
| `transfer_limit_check` | `user, amount, result` | `check_transfer_limits()` |
| `compliance_rule_updated` | `rule_name, is_active` | `update_compliance_rule()` |
