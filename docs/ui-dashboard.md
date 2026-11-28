# UI Dashboard — Data Requirements & Empty-State Behavior

> Drips Wave 11, issue
> [#437](https://github.com/Kevin737866/stellar-asset-tokenization-suite/issues/437)
> — `feat(ui-dashboard): Document dashboard data requirements and empty-state
> behavior`. Implementation: `ui/src/components/OwnershipDashboard.tsx` and
> `ui/src/components/dashboardData.ts` (the single source of truth for the
> rules below, kept next to the code so docs and implementation cannot drift
> apart).

## What the dashboard is

`OwnershipDashboard` renders one Stellar wallet's real-world-asset
portfolio: overview totals, distribution / performance charts, holdings,
dividends and voting power. It is display-only plus three delegated
actions (lock / unlock / claim).

## Data requirements

| Input | Type | Required | Notes |
| --- | --- | --- | --- |
| `userAddress` | `string` | Yes | Connected Stellar wallet address (`G...`). Display-only. |
| `portfolio.assets` | `AssetHolding[]` | Yes | May be empty — that is the empty state, not an error. |
| `portfolio.totalValue` | decimal `string` | Yes | Non-negative, e.g. `"2500"`. |
| `portfolio.totalDividends` | decimal `string` | Yes | Non-negative decimal string. |
| `portfolio.votingPower` | decimal `string` | Yes | Non-negative decimal string. |
| `asset.name` / `asset.symbol` / `asset.tokenAddress` | `string` | Yes, per holding | Non-empty. |
| `balance.amount` / `balance.lockedAmount` / `balance.votingPower` | decimal `string` | Yes, per holding | Non-negative. |
| `holding.value` / `holding.dividends` | decimal `string` | Yes, per holding | Non-negative. |
| `holding.percentage` | `number` | Yes, per holding | Between 0 and 100 inclusive. |
| `onLockTokens` / `onUnlockTokens` / `onClaimDividends` | callbacks | No | Optional. When absent, that action is unavailable — the dashboard never invents a fallback transaction. |
| `isLoading` | `boolean` | No | Defaults to `false`. While `true`, skeletons are shown. |

The canonical TypeScript shapes are `Portfolio`, `AssetHolding` and
`Balance` in `sdk/src/types.ts`, re-exported for the UI from
`ui/src/lib/types.ts`.

## Display states

| State | When | What the user sees |
| --- | --- | --- |
| `loading` | `isLoading` is `true` | Skeleton cards and chart placeholders. |
| `empty` | Data loaded and valid, `assets` is empty | Overview cards with $0 totals, plus an explicit **“No assets yet”** panel explaining what data the dashboard needs and that the sections appear automatically once the wallet holds an asset. Charts and lists are not rendered blank. |
| `invalid` | `portfolio` fails validation | Overview cards with $0 totals, plus a **“Dashboard data couldn’t be read”** panel listing each invalid field with its location (e.g. `assets[0].balance.amount …`). No action buttons are offered. |
| `ready` | Valid portfolio with ≥ 1 holding | Full dashboard: overview cards, charts, holdings, dividends and voting tabs. |

Precedence: `loading` beats everything; `invalid` beats `empty`/`ready`
(bad data is shown as a data problem, never as an empty wallet).

## Authorization

The dashboard itself performs no authorization check — it only ever
displays the holdings of the `userAddress` it was given. The parent MUST:

1. pass the portfolio of the **connected** wallet, and
2. verify in its lock / unlock / claim callbacks that the **signer
   matches `userAddress`** before submitting anything on-chain.

The dashboard never signs, sends, or moves funds.

## Failure semantics

- **Invalid numbers** (non-numeric, `NaN`, `Infinity`, negative) are never
  rendered as `NaN`. `toSafeNumber` clamps them to `0`, and
  `validateDashboardPortfolio` reports each violation so the clamp is
  visible, not silent.
- **Failed operations** (lock / unlock / claim) leave the displayed
  portfolio untouched: form inputs are only cleared after a successful
  callback, and the error is kept per asset until the next attempt.
  Network errors additionally surface via the banner and a retryable
  toast.
- **Malformed portfolio data** (missing `assets`, wrong types) never
  crashes the dashboard — it renders the `invalid` state.

## Verification

```bash
cd ui && npm run type-check
npm test -- --runInBand ui/src/components/__tests__/dashboardData.test.ts
```

The regression tests in
`ui/src/components/__tests__/dashboardData.test.ts` cover safe number
parsing, validation (valid / missing / unparseable / negative / boundary
percentages) and the full state derivation matrix.
