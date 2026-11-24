# SDK configuration validation

`StellarRWASDK` validates its full configuration before creating any client. Validation covers:

- `config.stellar.network` — must be one of `testnet`, `mainnet`, `futurenet`, or `standalone`.
- `config.stellar.serverUrl` — must be a non-empty, parseable URL.
- `config.stellar.passphrase` — must exactly match the passphrase for `config.stellar.network` in `STELLAR_NETWORKS`.
- Every entry in `config.contracts` — must be a Stellar contract ID (a 56-character `C`-prefixed StrKey), not a `G`-prefixed account address.

`createStellarRWASDK(network, contracts, options)` fills the passphrase from `STELLAR_NETWORKS[network]`, so callers only provide contract IDs. `options.serverUrl` may override the network's default server URL; the passphrase still comes from the selected network.

`updateConfig(partial)` merges nested `stellar` and `contracts` objects with the current configuration and validates the merged result before assigning it. If validation fails, the existing configuration and client instances are unchanged.

`validateConfig()` runs the same checks against the current configuration. Individual clients also validate their configured contract ID at construction time.

Invalid configuration throws `InvalidParametersError` with the offending field name, for example:

```text
Invalid config.contracts.secondaryMarket: must be a valid Stellar contract ID (C...)
Invalid config.stellar.passphrase: must match the testnet network passphrase
```
