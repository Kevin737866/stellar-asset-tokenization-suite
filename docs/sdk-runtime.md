# SDK Runtime Requirements & Network Configuration

> Drips Wave 11, issue
> [#397](https://github.com/Kevin737866/stellar-asset-tokenization-suite/issues/397)
> — `feat(sdk-core): Document SDK runtime requirements and network
> configuration`. Implementation: `sdk/src/runtimeConfig.ts` (the single
> source of truth for the rules below, kept next to the code so docs and
> implementation cannot drift apart), wired into `sdk/src/index.ts`
> (`StellarRWASDK` constructor, `updateConfig`, `createStellarRWASDK`).

## What this covers

Everything a caller must get right **before** the SDK touches the network:
which runtime it runs on, which Stellar network it talks to, which RPC /
Horizon endpoint that means, and which timeout / fee defaults apply. A
wrong network here is not a cosmetic mistake — it sends transactions to
the wrong ledger — so the SDK validates the configuration up front and
fails loudly instead of silently connecting somewhere else.

## Runtime requirements

| Requirement | Minimum | Source |
| --- | --- | --- |
| Node.js | `>= 18.0.0` | `stellar-sdk` v12 documents Node 18 as the oldest supported maintenance release; this repo's CI pins Node 20 (`.github/workflows/ci.yml`, `NODE_VERSION: '20'`). |
| TypeScript (building from source) | `>= 5.0.0` | `devDependencies` in `package.json` (installed: 5.9.3). |
| Network access | Outbound HTTPS to the configured Horizon / Soroban RPC endpoint | The SDK makes no transaction without an endpoint; see the network table below. |

The requirements are also exported as data from the SDK —
`RUNTIME_REQUIREMENTS` in `sdk/src/runtimeConfig.ts` — so tooling can
read them instead of parsing this file.

## Networks

| Network | Horizon / RPC endpoint (default) | Network passphrase |
| --- | --- | --- |
| `testnet` | `https://horizon-testnet.stellar.org` | `Test SDF Network ; September 2015` |
| `mainnet` | `https://horizon.stellar.org` | `Public Global Stellar Network ; September 2015` |
| `futurenet` | `https://horizon-futurenet.stellar.org` | `Test SDF Future Network ; October 2022` |
| `standalone` | `http://localhost:8000` | `Standalone Network ; February 2017` |

Matching is exact and case-sensitive: `'MAINNET'`, `'mainnett'` and
`'devnet'` are not networks and are rejected. The defaults live in
`STELLAR_NETWORKS` (`sdk/src/constants.ts`); `resolveNetworkConfig()`
returns a **copy** of the entry, so mutating the result never changes
the shared defaults.

## Configuration

Build a config with `createStellarRWASDK(network, contracts, options)`
(`sdk/src/index.ts`) or resolve one explicitly with
`resolveRuntimeConfig()` (`sdk/src/runtimeConfig.ts`). Either way the
resolved config has no optional fields left:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `network` | `'testnet' \| 'mainnet' \| 'futurenet' \| 'standalone'` | — (required) | Must be a supported name; see above. |
| `serverUrl` | `string` (URL) | The network's default endpoint | Soroban RPC endpoint. |
| `horizonUrl` | `string` (URL) | The network's default endpoint | Horizon REST endpoint. |
| `passphrase` | `string` | The network's default passphrase | Must be the passphrase **of the named network**; see mismatch rule below. |
| `timeoutSeconds` | integer | `30` (`DEFAULT_TIMEOUT_SECONDS`) | Per-request timeout, 1–300 s. |
| `feeRateBps` | integer | `100` (`DEFAULT_FEE_RATE`) | Default fee rate in basis points, 0–10000 (0 = no fee). |

```ts
import { createStellarRWASDK } from './sdk/src/index';

const sdk = createStellarRWASDK('testnet', {
  assetFactory: assetFactoryAddress,
  complianceRegistry: complianceRegistryAddress,
  dividendDistributor: dividendDistributorAddress,
  secondaryMarket: secondaryMarketAddress,
  custodyValidator: custodyValidatorAddress,
});
// serverUrl / horizonUrl / passphrase default to the testnet values above.
```

## Validation rules & failure semantics

Every failure is an `InvalidParametersError` (`code:
'INVALID_PARAMETERS'`, see `sdk/src/errors.ts`) that names the expected
values. The SDK never silently falls back, corrects, or switches
networks.

| Input | Rule | Failure |
| --- | --- | --- |
| `network` | Must be one of `testnet`, `mainnet`, `futurenet`, `standalone` (exact, case-sensitive) | `Invalid network: must be one of testnet, mainnet, futurenet, standalone (received …)` |
| `serverUrl` / `horizonUrl` | Must be a non-empty, parseable URL when provided | `Invalid serverUrl: must be a valid URL` |
| `passphrase` | Must be a non-empty string when provided | `passphrase is required and must be a non-empty string` |
| `timeoutSeconds` | Integer in 1–300 | `timeoutSeconds must be an integer between 1 and 300 seconds` |
| `feeRateBps` | Integer in 0–10000 | `feeRateBps must be an integer between 0 and 10000 basis points` |
| `serverUrl` is another network's default | `serverUrl: https://horizon.stellar.org` (mainnet) with `network: 'testnet'` | `serverUrl '…' is the default endpoint for 'mainnet' but network is 'testnet'. Use network 'mainnet' or a different serverUrl.` |
| `passphrase` belongs to another network | Mainnet passphrase with `network: 'testnet'` | `passphrase belongs to network 'mainnet' but network is 'testnet'. …` |

Notes on the mismatch rules:

- Only **exact matches against another network's defaults** are rejected.
  A custom RPC URL or a custom passphrase (e.g. a local node) passes
  through — the check guards the common misconfiguration, not custom
  setups.
- Before this change, `createStellarRWASDK` with an unknown network
  crashed with a bare `TypeError` (`STELLAR_NETWORKS[network]` is
  `undefined`); it now throws the typed error above. A `defaultFeeRate`
  of `0` used to silently become `100` (`||` fallback); it now stays `0`.

**No partial state.** `resolveRuntimeConfig()` validates *everything*
first and only then builds the result. A failed resolution throws and
returns nothing, so the caller can never observe a half-filled config —
there is nothing to roll back.

## Authorization

- The SDK performs **no authorization check of its own** on network
  selection: naming a network is the caller's decision, and the
  passphrase check above only catches *accidental* mismatches.
- The SDK **never signs, sends, or moves funds on its own** and never
  switches networks implicitly: the network named at construction is the
  network every client uses until `updateConfig()` is called with a new,
  validated network.
- Pointing the SDK at `mainnet` is therefore a deliberate, explicit act:
  use `network: 'mainnet'` (and its passphrase) only when mainnet traffic
  is intended. Test credentials, testnet contract addresses, and testnet
  passphrases must never be reused against the mainnet endpoint.

## No API / storage migration

None required. This change adds a new module (`sdk/src/runtimeConfig.ts`)
and validation at the existing construction entry points; it changes no
stored data, no contract interface, and no public method signature. The
only behavior changes are the failure modes listed above (typed errors
where the SDK previously crashed or silently fell back).

## Verification

```bash
npm test -- --runInBand
```

The regression tests in `sdk/src/__tests__/runtimeConfig.test.ts`
(42 tests) cover network-name validation (valid / invalid / case /
boundary), default endpoint resolution and copy semantics, full config
resolution with defaults and overrides, timeout / fee-rate bounds
(including the 1 / 300 s and 0 / 10000 bps boundaries), cross-network
mismatch detection, and the no-partial-state guarantee.

The `StellarRWASDK` constructor / `createStellarRWASDK` wiring in
`sdk/src/index.ts` (unknown network rejected with
`InvalidParametersError`, timeout / fee overrides bounds-checked) is
verified by a runtime smoke check, not by a jest test: `index.ts` does
not compile under ts-jest on main (44 pre-existing type errors — missing
local type bindings, `Server` no longer exported by stellar-sdk v12 —
plus a phantom `@stellar/stellar-sdk` import in `assetFactory.ts`), so
no jest suite can import it today. The smoke check compiles the SDK with
`tsc` (emit despite the pre-existing errors) and calls the factory with
an unknown network, an out-of-range timeout, and an out-of-range fee
rate, asserting each throws `InvalidParametersError`; see the PR
description for the command and output.

Pre-existing test-suite state (unchanged by this PR except where noted):
`npm test -- --runInBand` on the unmodified tree is 69 pass / 6 suites
fail. This PR additionally fixes two small pre-existing blockers so the
suite can run further — the missing retry-constants import in
`sdk/src/errors.ts` (without it, `errors` / `validation` /
`gasEstimator` suites cannot compile) and the `window` reference in
`sdk/src/logger.ts` (no DOM lib in `tsconfig.json`) — and converts the
three vitest-importing suites to jest (vitest is not installed). Two
suites still cannot run on main for reasons outside this issue:
`dividendClient.claimAll` and `secondaryMarket.vwapTwap`, whose source
modules do not compile against stellar-sdk v12; fixing those modules is
a separate issue. Full-suite numbers are in the PR description.
