/**
 * Dashboard data requirements and empty-state behavior.
 *
 * Drips Wave 11 — issue #437:
 * `feat(ui-dashboard): Document dashboard data requirements and empty-state
 * behavior`.
 *
 * The dashboard (`OwnershipDashboard`) renders a Stellar wallet's RWA
 * portfolio. This module is the single source of truth for what data the
 * dashboard needs, what counts as "empty", and what happens when the data
 * it receives is invalid. It is intentionally framework-free (no React, no
 * SDK imports) so the rules can be unit-tested with the plain Node Jest
 * setup and reused by any future dashboard component.
 *
 * ## Data requirements
 *
 * The dashboard needs exactly two inputs:
 *
 * 1. `userAddress` — the connected Stellar wallet address (`G...`). It is
 *    display-only here: the dashboard never signs, never sends, and never
 *    moves funds. Every state-changing action (lock / unlock / claim) is
 *    delegated to an optional parent callback.
 * 2. `portfolio` — a `Portfolio` (see `sdk/src/types.ts`): an `assets`
 *    array plus `totalValue`, `totalDividends` and `votingPower` as decimal
 *    strings. Each holding carries `asset` (name, symbol, tokenAddress),
 *    `balance` (amount, lockedAmount, votingPower — decimal strings),
 *    `value` and `dividends` (decimal strings) and `percentage` (0–100).
 *
 * ## Authorization
 *
 * - The dashboard itself performs no authorization check: it only ever
 *   displays the holdings of the `userAddress` it was given. The parent
 *   MUST pass the portfolio of the connected wallet and MUST verify, in
 *   its lock / unlock / claim callbacks, that the signer matches
 *   `userAddress` before submitting anything on-chain.
 * - The action callbacks (`onLockTokens`, `onUnlockTokens`,
 *   `onClaimDividends`) are optional. When a callback is absent, the
 *   corresponding action is unavailable — the dashboard never invents a
 *   fallback transaction.
 *
 * ## Failure semantics
 *
 * - Invalid numeric strings (non-numeric, `NaN`, `Infinity`, negative)
 *   are never rendered as `NaN` / `Infinity`. {@link toSafeNumber} clamps
 *   them to `0`; {@link validateDashboardPortfolio} reports each violation
 *   so the UI can explain what is wrong instead of silently showing zeros.
 * - A failed lock / unlock / claim leaves the displayed portfolio
 *   untouched: form inputs are only cleared after a successful callback,
 *   and error state is kept per asset until the next attempt.
 * - A portfolio that fails validation renders the `invalid` state: totals
 *   are shown as $0, no action buttons are offered, and the validation
 *   problems are listed. The dashboard never crashes on malformed data.
 */

/** Minimal structural shape of one portfolio holding (mirrors `AssetHolding` in `sdk/src/types.ts`). */
export interface DashboardHoldingInput {
  asset: {
    name: string;
    symbol: string;
    tokenAddress: string;
  };
  balance: {
    amount: string;
    lockedAmount: string;
    votingPower: string;
  };
  value: string;
  percentage: number;
  dividends: string;
}

/** Minimal structural shape of a portfolio (mirrors `Portfolio` in `sdk/src/types.ts`). */
export interface DashboardPortfolioInput {
  assets: DashboardHoldingInput[];
  totalValue: string;
  totalDividends: string;
  votingPower: string;
}

/**
 * The dashboard's display state, derived from its inputs.
 *
 * - `loading` — the parent is still fetching; skeletons are shown.
 * - `empty` — data loaded fine, but the wallet holds no assets.
 * - `invalid` — the portfolio failed validation (missing fields or
 *   unparseable numbers); the problems are listed, no actions offered.
 * - `ready` — at least one holding is present and the data is valid.
 */
export type DashboardState = 'loading' | 'empty' | 'invalid' | 'ready';

/**
 * Parse a decimal-string amount into a finite, non-negative number.
 *
 * Returns `0` for anything that is not a finite number >= 0: non-numeric
 * strings, `NaN`, `Infinity`, negatives, `null` / `undefined`, and other
 * non-string/non-number input. The dashboard therefore never renders
 * `NaN`, and a clamped value is always paired with a validation problem
 * from {@link validateDashboardPortfolio} so the clamp is visible, not
 * silent.
 */
export function toSafeNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  return 0;
}

export interface DashboardValidation {
  valid: boolean;
  /** One human-readable problem per violation; empty when `valid`. */
  problems: string[];
}

function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()));
}

function isNonNegativeDecimalString(value: unknown): boolean {
  return isDecimalString(value) && Number(value.trim()) >= 0;
}

/**
 * Validate a portfolio against the dashboard's data requirements.
 *
 * Every violation is reported with its location (`assets[i]...` or the
 * totals field) so the UI can show exactly what is wrong. An empty
 * `assets` array is VALID — it is the `empty` state, not an error.
 */
export function validateDashboardPortfolio(portfolio: unknown): DashboardValidation {
  const problems: string[] = [];

  if (typeof portfolio !== 'object' || portfolio === null) {
    return { valid: false, problems: ['portfolio is missing: expected an object with an assets array and decimal-string totals'] };
  }

  const candidate = portfolio as Partial<DashboardPortfolioInput>;

  if (!Array.isArray(candidate.assets)) {
    problems.push('portfolio.assets is missing: expected an array of holdings (empty array means "no assets yet")');
  } else {
    candidate.assets.forEach((holding, index) => {
      const at = `assets[${index}]`;
      if (typeof holding !== 'object' || holding === null) {
        problems.push(`${at} is missing: expected a holding with asset, balance, value, percentage and dividends`);
        return;
      }
      const asset = (holding as Partial<DashboardHoldingInput>).asset;
      if (typeof asset !== 'object' || asset === null) {
        problems.push(`${at}.asset is missing: expected name, symbol and tokenAddress`);
      } else {
        if (typeof asset.name !== 'string' || asset.name.trim() === '') {
          problems.push(`${at}.asset.name is missing: expected a non-empty asset name`);
        }
        if (typeof asset.symbol !== 'string' || asset.symbol.trim() === '') {
          problems.push(`${at}.asset.symbol is missing: expected a non-empty asset symbol`);
        }
        if (typeof asset.tokenAddress !== 'string' || asset.tokenAddress.trim() === '') {
          problems.push(`${at}.asset.tokenAddress is missing: expected a non-empty token address`);
        }
      }
      const balance = (holding as Partial<DashboardHoldingInput>).balance;
      if (typeof balance !== 'object' || balance === null) {
        problems.push(`${at}.balance is missing: expected amount, lockedAmount and votingPower as decimal strings`);
      } else {
        if (!isNonNegativeDecimalString(balance.amount)) {
          problems.push(`${at}.balance.amount is invalid: expected a non-negative decimal string`);
        }
        if (!isNonNegativeDecimalString(balance.lockedAmount)) {
          problems.push(`${at}.balance.lockedAmount is invalid: expected a non-negative decimal string`);
        }
        if (!isNonNegativeDecimalString(balance.votingPower)) {
          problems.push(`${at}.balance.votingPower is invalid: expected a non-negative decimal string`);
        }
      }
      if (!isNonNegativeDecimalString((holding as Partial<DashboardHoldingInput>).value)) {
        problems.push(`${at}.value is invalid: expected a non-negative decimal string`);
      }
      if (!isNonNegativeDecimalString((holding as Partial<DashboardHoldingInput>).dividends)) {
        problems.push(`${at}.dividends is invalid: expected a non-negative decimal string`);
      }
      const percentage = (holding as Partial<DashboardHoldingInput>).percentage;
      if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        problems.push(`${at}.percentage is invalid: expected a number between 0 and 100`);
      }
    });
  }

  if (!isNonNegativeDecimalString(candidate.totalValue)) {
    problems.push('portfolio.totalValue is invalid: expected a non-negative decimal string');
  }
  if (!isNonNegativeDecimalString(candidate.totalDividends)) {
    problems.push('portfolio.totalDividends is invalid: expected a non-negative decimal string');
  }
  if (!isNonNegativeDecimalString(candidate.votingPower)) {
    problems.push('portfolio.votingPower is invalid: expected a non-negative decimal string');
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Derive the dashboard's display state from its inputs.
 *
 * Precedence: `loading` beats everything (the parent is still fetching);
 * an invalid portfolio beats `empty`/`ready` (bad data is shown as a
 * data problem, never as an empty wallet); an empty but valid portfolio
 * is `empty`; anything else with at least one holding is `ready`.
 */
export function getDashboardState(portfolio: unknown, isLoading: boolean): DashboardState {
  if (isLoading) {
    return 'loading';
  }
  const validation = validateDashboardPortfolio(portfolio);
  if (!validation.valid) {
    return 'invalid';
  }
  const assets = (portfolio as DashboardPortfolioInput).assets;
  return assets.length === 0 ? 'empty' : 'ready';
}

/**
 * Documented data requirements, kept next to the code that enforces them
 * so the docs and the implementation cannot drift apart. The human-readable
 * version lives in `docs/ui-dashboard.md`.
 */
export const DASHBOARD_DATA_REQUIREMENTS = {
  inputs: {
    userAddress: 'Connected Stellar wallet address (G...). Display-only; the dashboard never signs or sends.',
    portfolio: 'Portfolio with an assets array and totalValue / totalDividends / votingPower as non-negative decimal strings.',
  },
  authorization:
    'The parent must pass the connected wallet’s own portfolio and must verify in its lock / unlock / claim callbacks that the signer matches userAddress. Absent callbacks mean the action is unavailable.',
  failureSemantics:
    'Invalid numbers render as 0 (never NaN); failed lock / unlock / claim leave the portfolio unchanged; a portfolio that fails validation renders the invalid state with its problems listed.',
  emptyState:
    'A valid portfolio with zero holdings renders the empty state: $0 totals plus an explicit “No assets yet” panel explaining what data is missing and what to do next, instead of blank charts.',
} as const;
