# SDK (TypeScript): AssetFactory Client

Source: `sdk/src/assetFactory.ts`

## Overview
`AssetFactory` is a client for the on-chain `AssetFactory` contract.

It provides:
- asset-class-specific deployment helpers
- estimated deployment cost
- registry queries
- admin utilities (emergency pause)

## Key types
- `AssetClass` (enum)
- `AssetConfig`, `RealEstateConfig`, `CommodityConfig`, `InvoiceConfig`
- `ComplianceRules`, `DividendSchedule`, `DeploymentCost`

## Public methods

### `constructor(serverUrl: string, contractId: string, networkPassphrase?: string)`
Creates the client.

### `deployRealEstateToken(signer: Keypair, propertyDetails: RealEstateConfig, ownershipStructure: AssetConfig) -> Promise<{ address; transactionId }>`
Calls factory `create_asset` with real-estate metadata.

### `deployCommodityToken(signer: Keypair, commodityConfig: CommodityConfig, baseConfig: AssetConfig) -> Promise<{ address; transactionId }>`
Calls factory `create_asset` with commodity metadata and validates purity grade.

### `deployInvoiceToken(signer: Keypair, invoiceData: InvoiceConfig, baseConfig: AssetConfig) -> Promise<{ address; transactionId }>`
Calls factory `create_asset` for invoice assets.

### `deploySecurityToken(signer: Keypair, equityType: string, regulationFramework: string, baseConfig: AssetConfig) -> Promise<{ address; transactionId }>`
Calls factory `create_asset` for security assets.

### `getAssetClassTemplate(assetClass: AssetClass) -> Omit<AssetConfig, 'name' | 'symbol' | 'totalSupply'>`
Returns template defaults for compliance rules and dividend schedule.

### `estimateDeploymentCost(assetClass: AssetClass) -> Promise<DeploymentCost>`
Returns estimated deployment metrics (non-authoritative).

### `getAllAssets() -> Promise<any[]>`
Reads factory storage registry entry.

### `emergencyPauseAll(signer: Keypair) -> Promise<string>`
Calls factory `emergency_pause_all`.

## Notes
Some internal conversions and validations may be incomplete / placeholder depending on on-chain schema.

