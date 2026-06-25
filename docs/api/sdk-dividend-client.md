# SDK (TypeScript): DividendClient

Source: `sdk/src/dividendClient.ts`

## Overview
`DividendClient` wraps calls to the on-chain `DividendDistributor` contract.

It supports:
- creating distributions
- claiming dividend (single/all)
- reading distribution and claim info
- admin updates to config and distribution deactivation
- computing available dividend (read-only)

## Public methods

### `constructor(config: RWASDKConfig)`
Creates the client.

### `createDistribution(admin: Address, options: DividendOptions, txOptions?: TransactionOptions) -> Promise<{ transactionHash; distributionId }>`
Calls contract `create_distribution`.

### `claimDividend(claimer: Address, distributionId: number, txOptions?: TransactionOptions) -> Promise<{ transactionHash; amountClaimed }>`
Calls contract `claim_dividend`.

### `claimAllDividends(claimer: Address, txOptions?: TransactionOptions) -> Promise<{ transactionHash; claimedAmounts }>`
Calls contract `claim_all_dividends`.

### `getDistribution(distributionId: number) -> Promise<DividendDistribution>`
Calls `get_distribution`.

### `getActiveDistributions(tokenAddress: Address) -> Promise<DividendDistribution[]>`
Calls `get_active_distributions`.

### `getClaimInfo(distributionId: number, claimer: Address) -> Promise<ClaimInfo | null>`
Calls `get_claim_info`.

### `calculateAvailableDividend(distributionId: number, claimer: Address) -> Promise<string>`
Calls `calculate_available_dividend`.

### `updateConfig(admin: Address, config: DividendConfig, txOptions?: TransactionOptions) -> Promise<string>`
Calls `update_config`.

### `deactivateDistribution(admin: Address, distributionId: number, txOptions?: TransactionOptions) -> Promise<string>`
Calls `deactivate_distribution`.

## Notes
Several conversion/parsing helpers are marked as "not implemented" in the SDK file; the docs reflect the intended mapping, but runtime behavior may still require completion.

