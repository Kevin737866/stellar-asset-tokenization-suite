# SDK CLI — Install, Configuration & Safe Network Selection

> Drips Wave 11, issue
> [#417](https://github.com/Kevin737866/stellar-asset-tokenization-suite/issues/417)
> — `feat(sdk-cli): Document CLI install, configuration, and safe network
> selection`. Implementation: `sdk/src/cli.ts` (`resolveNetwork`,
> `assertMainnetConfirmed`, `validators`); tests in
> `sdk/src/__tests__/cli.network.test.ts`.

## What the CLI is

The SDK CLI (`sdk/src/cli.ts`) runs the three scripted Stellar operations the
SDK exposes from a terminal: `create-pool` (create and fund a liquidity
pool), `liquidate` (liquidate an undercollateralized RWA position) and
`generate-types` (generate TypeScript types from Soroban contract schemas).
`create-pool` and `liquidate` build, sign and submit real transactions;
`generate-types` is read-only. There is also a guided `--interactive` mode
that prompts for every value and asks for confirmation before submitting.

## Install

```bash
npm install     # install dependencies (stellar-sdk, typescript, jest, …)
npm run build   # compile sdk/src → dist/ (tsc)
node dist/cli.js --help
# or, without building first via the npm script:
npm run cli -- --help
```

> Note: the `generate-types` help text mentions `npx rwa-sdk`, but the
> package defines no `bin` entry, so that invocation is not wired up. Use
> `node dist/cli.js <command>` (or `npm run cli -- <command>`) as above.

## Commands

| Command | What it does | Moves funds? |
| --- | --- | --- |
| `create-pool` | Creates and funds a Stellar liquidity pool (adds trustlines + `liquidityPoolDeposit`) | Yes |
| `liquidate` | Triggers an insurance claim / liquidation on the Custody Validator | Yes |
| `generate-types` | Generates a TypeScript module from Soroban contract schemas (`--contracts` or `--schema`) | No (read-only) |
| `--interactive`, `-i` | Guided prompts for `create-pool` / `liquidate`, with a review + confirm step | Depends on the chosen command |

Run `node dist/cli.js <command> --help` for the full per-command options.

## Configuration

All configuration is passed as command-line flags; the CLI reads no config
file and no environment variables. Defaults are shown below.

### `create-pool`

| Flag | Required | Default | Notes |
| --- | --- | --- | --- |
| `--asset-a <asset>` | Yes | — | `XLM` / `NATIVE`, or `CODE:ISSUER` |
| `--asset-b <asset>` | Yes | — | Same format; assets are sorted lexicographically before deposit |
| `--amount-a <amount>` | Yes | — | Positive number, max amount of Asset A |
| `--amount-b <amount>` | Yes | — | Positive number, max amount of Asset B |
| `--fee <bps>` | No | `30` | Integer 1–10000 basis points |
| `--secret <secret>` | Yes | — | 56-char `S…` secret key of the depositor; never printed (masked as `********` in the interactive review) |
| `--network <network>` | No | `testnet` | See [Safe network selection](#safe-network-selection) |
| `--horizon-url <url>` | No | Default Horizon for `--network` | Override; see the cross-network rule below |
| `--slippage <decimal>` | No | `0.01` | Decimal in `[0, 1)` |
| `--confirm-mainnet` | Only with `--network mainnet` | — | Required; see below |

### `liquidate`

| Flag | Required | Default | Notes |
| --- | --- | --- | --- |
| `--asset-id <address>` | Yes | — | 56-char Stellar contract address of the RWA token |
| `--custody-validator <address>` | Yes | — | 56-char Custody Validator contract address |
| `--secret <secret>` | Yes | — | 56-char `S…` secret key of the authorized admin |
| `--reason <reason>` | No | `undercollateralized` | Short reason code logged on-chain |
| `--evidence-hash <hash>` | Yes | — | 64-char hex string (32 bytes) |
| `--network <network>` | No | `testnet` | See [Safe network selection](#safe-network-selection) |
| `--horizon-url <url>` | No | Default Horizon for `--network` | Override; see the cross-network rule below |
| `--force` | No | off | Skips the collateralization check and liquidates unconditionally |
| `--confirm-mainnet` | Only with `--network mainnet` | — | Required; see below |

### `generate-types`

| Flag | Required | Default | Notes |
| --- | --- | --- | --- |
| `--contracts <id[,id...]>` | One of `--contracts` / `--schema` | — | Contract ids fetched from the network |
| `--schema <file.json>` | (repeatable) | — | Local schema JSON file |
| `--rpc-url <url>` | With `--contracts` | — | Soroban RPC URL |
| `--network <network>` | No | `testnet` | Only used with `--contracts`; validated then |
| `--out <file.ts>` | No | stdout | Write the generated module here |
| `--manual-types <file>` | No | `sdk/src/types.ts` when present | Diff generated names against manual types |
| `--no-client` | No | off | Do not emit the `<Name>Client` interface |
| `--dry-run` | No | off | Print result without writing `--out` |

## Safe network selection

Supported networks (the only values `--network` accepts, enforced by
`resolveNetwork` in `sdk/src/cli.ts` and by `validators.network` in
interactive prompts):

| Network | Horizon (default) | Passphrase | Real funds? |
| --- | --- | --- | --- |
| `testnet` (default) | `https://horizon-testnet.stellar.org` | `Test SDF Network ; September 2015` | No |
| `mainnet` | `https://horizon.stellar.org` | `Public Global Stellar Network ; September 2015` | **Yes** |
| `futurenet` | `https://horizon-futurenet.stellar.org` | `Test SDF Future Network ; October 2022` | No |
| `standalone` | `http://localhost:8000` | `Standalone Network ; February 2017` | No |

Rules, enforced before any network call or transaction is built:

1. **Unknown network rejected.** Any other value (including `devnet`, an
   empty string, or a case variant such as `Mainnet`) fails with
   `Unsupported network: "<value>". Supported: testnet, mainnet, futurenet,
   standalone`. Names are trimmed; case is significant.
2. **Mainnet needs explicit confirmation.** Non-interactive `create-pool` /
   `liquidate` with `--network mainnet` refuse unless `--confirm-mainnet`
   is also passed — the command exits before building or signing anything.
   Test networks never require it. Interactive mode shows an explicit
   `MAINNET selected: this command moves real funds…` warning in its review
   step and still asks `Proceed with these settings?` before submitting.
   `generate-types` is read-only and never requires confirmation.
3. **`--horizon-url` must not cross networks.** An override pointing at a
   *different* network's public Horizon (e.g. `--network mainnet` with
   `https://horizon-testnet.stellar.org`) is rejected with an error naming
   both hosts. A private Horizon, a proxy, or a localhost URL is accepted
   for any network, and a malformed URL is rejected. Without the flag, the
   selected network's default Horizon is used.
4. **Default is testnet.** Omitting `--network` never touches mainnet.

## Authorization

- `create-pool` signs with the `--secret` depositor key; only that account
  funds the pool. `liquidate` signs with the admin `--secret` and submits
  the claim through the Custody Validator — the caller must be the
  authorized admin or the contract rejects the claim.
- The CLI never stores a secret key: it is used in-memory for one run and
  masked in the interactive review. Keep it out of shell history
  (prefer `--interactive`, which reads it from a prompt).
- The interactive review step is the last chance to abort: answering
  anything other than `yes`/`y` cancels the operation with nothing
  submitted.

## Failure semantics

- **Invalid input fails before any side effect.** Missing required flags,
  an unknown network, a missing mainnet confirmation, a cross-network
  `--horizon-url`, an invalid asset/secret/address/evidence-hash all abort
  before a transaction is built or submitted — a failed run leaves no
  partial state (no trustline, no deposit, no claim).
- **Validation order in `create-pool` / `liquidate`:** required flags →
  network resolution (incl. Horizon-override check) → mainnet confirmation
  → key/asset parsing → Horizon connection. A bad network therefore fails
  before the secret key is ever used.
- **`liquidate` without `--force`** first checks collateralization: a fully
  backed position stops the command with an exit code `0` and the hint to
  use `--force`; it is not an error. With `--force`, the check is skipped
  and the claim is submitted unconditionally.
- **Interactive prompts re-prompt** on invalid input instead of exiting, and
  empty required fields are re-asked. The `generate-types` command fails
  when neither `--contracts` nor `--schema` is given.
- **No migration is required by this change.** It adds CLI-side validation
  and documentation only; no contract, SDK API, or stored data changes.

## Verification

```bash
npm run build                                            # tsc: sdk/src must compile
npx jest sdk/src/__tests__/cli.network.test.ts --runInBand   # new network-selection tests
npm test -- --runInBand                                  # full suite (see baseline below)
npm run check:doc-links                                  # validates the links in this doc
```

The regression tests in `sdk/src/__tests__/cli.network.test.ts` cover:
network resolution for all four networks (Horizon + passphrase +
`isProduction`), unknown/empty/case-variant names, whitespace trimming,
custom vs. cross-network vs. malformed `--horizon-url` overrides, and the
mainnet confirmation guard (refused without `--confirm-mainnet`, allowed
with it, never required on test networks). Baseline on the unmodified tree:
84 tests pass and 6 suites fail on the pre-existing missing `vitest` module
— those failures are unrelated to this change and must stay identical.
