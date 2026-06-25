# SDK (TypeScript): TokenClient

Source: `sdk/src/tokenClient.ts`

## Overview
`TokenClient` is a client for the on-chain `RWAToken` contract.

It provides methods for:
- reading token info and balances
- token transfers (with compliance checks done on-chain)
- mint/burn (admin operations)
- pausing / freezing / unfreezing / unpausing
- locking/unlocking tokens for voting power

## Public methods

### `constructor(config: RWASDKConfig, tokenAddress: Address)`
Creates a client for a specific token contract.

### `getTokenInfo() -> Promise<AssetInfo>`
Calls `get_token_info`.

### `getBalance(address: Address) -> Promise<Balance>`
Calls `get_balance`.

### `transfer(from: Address, to: Address, amount: string, options?: TransactionOptions) -> Promise<string>`
Calls `transfer`.

### `mint(admin: Address, to: Address, amount: string, options?: TransactionOptions) -> Promise<string>`
Calls `mint`.

### `burn(owner: Address, amount: string, options?: TransactionOptions) -> Promise<string>`
Calls `burn`.

### `lockTokens(owner: Address, amount: string, lockPeriod: number, options?: TransactionOptions) -> Promise<string>`
Calls `lock_tokens`.

### `unlockTokens(owner: Address, amount: string, options?: TransactionOptions) -> Promise<string>`
Calls `unlock_tokens`.

### `pause(admin: Address, options?: TransactionOptions) -> Promise<string>`
Calls `pause`.

### `unpause(admin: Address, options?: TransactionOptions) -> Promise<string>`
Calls `unpause`.

### `freeze(admin: Address, options?: TransactionOptions) -> Promise<string>`
Calls `freeze`.

### `unfreeze(admin: Address, options?: TransactionOptions) -> Promise<string>`
Calls `unfreeze`.

### `getTokenStats() -> Promise<{ totalSupply; circulatingSupply; totalHolders; totalLocked; transferCount }>`
Currently a placeholder implementation.

### `getTransferHistory(address: Address, limit?: number, cursor?: string)`
Reads transfer history from Horizon payments; implementation partially inconsistent (contains a thrown error after return).

### `checkTransferAllowed(from: Address, to: Address, amount: string)`
Calls `check_transfer_compliance`.

## Error behavior
Methods wrap failures into `RWASDKError` subclasses (timeouts, unauthorized, insufficient balance, generic contract errors).

