# Asset class handlers

`AssetClassHandlers` builds class-specific `AssetConfig` values for real estate, commodities (including agricultural), invoices, securities, art, carbon credits, renewable energy, and intellectual property.

## Reserved metadata keys

Base metadata is merged with class-specific metadata. To keep canonical fields unambiguous, metadata keys that shadow first-class configuration fields are rejected with `AssetClassError::ReservedMetadataKey` (error code `11`). Validation runs before a configured `AssetConfig` is returned, so a rejected call does not produce a partially updated configuration.

Reserved keys:

- `name`
- `symbol`
- `decimals`
- `total_supply`
- `asset_class`
- `compliance_rules`
- `dividend_schedule`
- `created_at`
- `metadata`

Other metadata keys are preserved alongside the class-specific keys written by each handler. The existing metadata size limit (100 entries per class handler) still applies and reports `AssetClassError::InvalidParameters`.

This is an additive error code; existing error codes `1` through `10` are unchanged, and no contract storage layout changes are required.
