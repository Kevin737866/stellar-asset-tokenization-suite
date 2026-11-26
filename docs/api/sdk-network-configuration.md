# SDK: Typed Network Configuration Validation

Issue #389 — network settings are validated with a typed validator **before any
SDK client is constructed**. This makes configuration errors fail early with a
single, typed error instead of surfacing later as `TypeError`s or partially
initialised clients.

## Public API

```ts
import {
  createStellarRWASDK,
  StellarRWASDK,
  validateTypedNetworkConfig,
  assertSupportedStellarNetwork,
  isSupportedStellarNetwork,
  SUPPORTED_STELLAR_NETWORKS,
  type StellarNetwork,
  type TypedNetworkConfigInput,
  type TypedNetworkConfigValidationResult,
} from 'stellar-rwa-sdk';
```

`StellarNetwork` is the union `'testnet' | 'mainnet' | 'futurenet' | 'standalone'`.
`SUPPORTED_STELLAR_NETWORKS` exposes the same values at runtime.

### `validateTypedNetworkConfig(config, options?)`

| Field | Requirement |
| --- | --- |
| `network` | One of the four supported names above. |
| `serverUrl` | Non-empty `http:` or `https:` URL (Soroban RPC endpoint). |
| `horizonUrl` | Optional; if omitted it defaults to `serverUrl`. When supplied it must also be an `http(s)` URL. |
| `passphrase` | Non-empty string. With `{ requireMatchingPassphrase: true }` it must equal the canonical passphrase for `network`. |
| `requestTimeoutMs` | Optional integer in `[100, 300000]`; defaults to `30000` (`DEFAULT_REQUEST_TIMEOUT_MS`). |

Returns a normalised `TypedNetworkConfigValidationResult` (trimmed URLs and
passphrase, resolved `horizonUrl`, effective `requestTimeoutMs`, `valid: true`).
Every failure throws `InvalidParametersError` (code `INVALID_PARAMETERS`) with
the offending field named in the message; no partial result is returned.

Passphrase matching is **opt-in** so private or standalone networks may use
custom passphrases. `createStellarRWASDK` derives the passphrase from the
network table and therefore validates with `requireMatchingPassphrase: true`.

## Before-client-creation guarantee

* `new StellarRWASDK(config)` calls the validator (via `validateConfig`) before
  assigning state or creating `AssetFactory`, `ComplianceClient`,
  `DividendClient`, `MarketClient` or `CustodyClient`. A rejected config cannot
  produce an SDK instance.
* `sdk.updateConfig(partial)` merges the partial config into a candidate and
  validates that candidate first. A rejected update leaves `getConfig()` and all
  existing client references unchanged.
* `createStellarRWASDK(network, contracts, options?)` asserts the network name
  before looking up its defaults, so an unsupported name raises
  `InvalidParametersError` instead of `TypeError: cannot read ... of undefined`.
* `sdk.validateConfig(candidate?)` is public for explicit pre-flight checks and
  now performs full typed network validation in addition to the existing
  contract-presence checks.

## Compatibility

No API was removed. Existing valid configurations (including custom RPC URLs
and custom passphrases) keep working. Configurations that previously passed
because validation only checked presence — e.g. a non-HTTP `serverUrl`, an
unknown network name, or an out-of-bounds timeout — are now rejected at
construction/update time with `InvalidParametersError`. This is the intended
behavioural change; no API or storage migration is required.
