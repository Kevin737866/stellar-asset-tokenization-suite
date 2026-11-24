/**
 * Semantics for the wallet disconnect action and account-scoped UI views.
 *
 * Input: a disconnect applies only to a connected account. Blank or whitespace
 * addresses are treated as disconnected, and addresses are compared verbatim
 * because Stellar addresses are case-sensitive.
 *
 * Authorization: disconnect is a local session action. It never requests a
 * signature, never submits a transaction and never transmits account data. The
 * wallet adapter callback is invoked only for a connected account and only
 * when no disconnect is already in flight.
 *
 * Failure: a rejected adapter call produces a `failed` outcome. Callers keep
 * the account and all of its views unchanged so no partial state is left
 * behind. Account-scoped views are cleared only after a successful disconnect
 * transitions the account to null (or when the user switches accounts).
 */

export type DisconnectOutcome =
  | { readonly status: 'success' }
  | { readonly status: 'skipped'; readonly reason: 'no-account' | 'already-disconnecting' }
  | { readonly status: 'failed'; readonly error: unknown };

export function canonicalAccount(account: string | null | undefined): string | null {
  if (typeof account !== 'string') return null;
  const trimmed = account.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when the session moved from one connected account to another. */
export function isAccountSwitch(previous: string | null | undefined, next: string | null | undefined): boolean {
  const before = canonicalAccount(previous);
  const after = canonicalAccount(next);
  return before !== null && after !== null && before !== after;
}

/** True when a connected account was disconnected. */
export function isDisconnect(previous: string | null | undefined, next: string | null | undefined): boolean {
  return canonicalAccount(previous) !== null && canonicalAccount(next) === null;
}

/**
 * Account-scoped views must be cleared on disconnect and on account switch,
 * but never on first connect (there is nothing stale to clear yet).
 */
export function shouldClearAccountViews(
  previous: string | null | undefined,
  next: string | null | undefined
): boolean {
  return isDisconnect(previous, next) || isAccountSwitch(previous, next);
}

/**
 * Runs the adapter disconnect with explicit input and failure semantics. This
 * helper is pure with respect to component state; the caller updates the
 * account (and therefore the views) only on a `success` outcome.
 */
export async function runWalletDisconnect(options: {
  account: string | null | undefined;
  inFlight: boolean;
  disconnect: () => Promise<void> | void;
}): Promise<DisconnectOutcome> {
  if (options.inFlight) return { status: 'skipped', reason: 'already-disconnecting' };
  if (canonicalAccount(options.account) === null) return { status: 'skipped', reason: 'no-account' };

  try {
    await options.disconnect();
    return { status: 'success' };
  } catch (error) {
    return { status: 'failed', error };
  }
}
