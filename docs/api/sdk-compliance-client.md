# SDK (TypeScript): ComplianceClient

Source: `sdk/src/complianceClient.ts`

## Overview
`ComplianceClient` wraps calls to the on-chain `ComplianceRegistry` contract.

It supports:
- initializing compliance registry (admin)
- KYC status updates
- whitelist / blacklist management
- transfer compliance checks
- transfer-limit configuration and reads
- compliance rule configuration (admin)
- audit-trail methods (currently placeholders)

## Public methods

### `constructor(config: RWASDKConfig)`
Creates the client.

### `initialize(deployer: Address, admin: Address, kycRequired: boolean, transferRestrictions: boolean, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `initialize`.

### `updateKYCStatus(admin: Address, user: Address, kycStatus: KYCStatus, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `update_kyc_status`.

### `getKYCStatus(user: Address) -> Promise<KYCStatus>`
Calls contract `get_kyc_status`.

### `addToBlacklist(admin: Address, address: Address, reason: string, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `add_to_blacklist`.

### `removeFromBlacklist(admin: Address, address: Address, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `remove_from_blacklist`.

### `addToWhitelist(admin: Address, address: Address, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `add_to_whitelist`.

### `removeFromWhitelist(admin: Address, address: Address, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `remove_from_whitelist`.

### `checkCompliance(from: Address, to: Address, amount: string) -> Promise<boolean>`
Calls contract `check_compliance`.

### `checkTransferLimits(user: Address, amount: string) -> Promise<boolean>`
Calls contract `check_transfer_limits`.

### `setTransferLimits(admin: Address, user: Address, limits: TransferLimits, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `set_transfer_limits`.

### `getComplianceRules() -> Promise<ComplianceRule[]>`
Calls contract `get_compliance_rules`.

### `updateComplianceRule(admin: Address, rule: ComplianceRule, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `update_compliance_rule`.

### Audit helpers (placeholders)
- `getComplianceStats()` (placeholder)
- `getUserComplianceHistory()` (not implemented)

### Batch helpers
- `batchUpdateKYCStatus(admin: Address, updates: Array<{user; kycStatus}>, txOptions?: TransactionOptions) -> Promise<string>`
Creates a transaction with multiple `update_kyc_status` operations.

### `getAuditTrail(...)` / `getAuditTrailByAdmin(...)` / `getAuditTrailByTarget(...)`
Currently returns empty results (placeholder implementation).

