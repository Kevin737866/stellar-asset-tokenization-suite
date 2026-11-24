/**
 * Shared semantics for wallet-backed form submissions in the UI.
 *
 * Input policy: every value collected by these forms is public, validated
 * client-side data, so a rejected wallet request is never a reason to discard
 * it. Form values are preserved exactly as entered.
 *
 * Authorization policy: a rejection means the user declined the signing
 * prompt. No transaction was submitted and no authorization was granted, so a
 * rejection must never produce success state, a receipt, or a persisted change.
 *
 * Failure policy: the helpers in this module are pure with respect to component
 * state. They only classify outcomes. Callers clear inputs exclusively in the
 * success branch, so failed or rejected requests cannot leave partial state
 * changes behind.
 */

export type WalletRequestOutcome<T> =
  | { readonly status: 'success'; readonly value: T }
  | { readonly status: 'rejected'; readonly error: unknown }
  | { readonly status: 'failed'; readonly error: unknown };

const REJECTION_CODES: ReadonlySet<string> = new Set([
  '4001',
  'USER_REJECTED',
  'USER_REJECTED_REQUEST',
  'USER_REJECTED_REQUEST_ERROR',
  'WALLET_REJECTED',
  'REJECTED_BY_USER',
  'USER_DECLINED',
  'USER_CANCELLED',
  'USER_CANCELED',
  'SIGN_REJECTED',
  'CONNECTION_REJECTED',
]);

const REJECTION_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\b(?:user|you)\s+(?:has\s+|have\s+)?(?:rejected|denied|declined|cancelled|canceled)\b/i,
  /\b(?:rejected|denied|declined|cancelled|canceled)\s+by\s+(?:the\s+)?user\b/i,
  /\b(?:rejected|denied|declined|cancelled|canceled)\s+(?:this|the)\s+(?:signing|wallet|signature|authorization)\s+request\b/i,
  /\bconnection\s+(?:rejected|denied|declined|cancelled|canceled)\b/i,
  /\b(?:rejected|denied|declined|cancelled|canceled)\s+by\s+the\s+wallet\b/i,
  /\bwallet\s+(?:request\s+)?(?:was\s+)?(?:rejected|denied|declined|cancelled|canceled)\b/i,
  /\b(?:signing|signature|authorization)\s+request\s+(?:was\s+)?(?:rejected|denied|declined|cancelled|canceled)\b/i,
];

export const WALLET_REJECTION_TITLE = 'Wallet Request Rejected';

export const WALLET_REJECTION_MESSAGE =
  'You declined the wallet request. Nothing was submitted, so your form entries have been preserved for review and retry.';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function matchesRejectionCode(error: unknown): boolean {
  const record = asRecord(error);
  if (!record) return false;

  if (record.code !== undefined && record.code !== null) {
    if (REJECTION_CODES.has(String(record.code))) return true;
  }

  if (typeof record.name === 'string' && /user\s*rejected/i.test(record.name)) return true;

  return false;
}

function matchesRejectionMessage(error: unknown): boolean {
  const record = asRecord(error);
  if (!record || typeof record.message !== 'string') return false;
  return REJECTION_MESSAGE_PATTERNS.some((pattern) => pattern.test(record.message as string));
}

/**
 * Returns true only for wallet/user-declined authorization errors.
 *
 * Network failures, Horizon authorization failures (TX_BAD_AUTH) and generic
 * errors are deliberately not treated as wallet rejections: those need their
 * existing failure handling and must not reuse the "entries preserved" copy.
 */
export function isWalletRejection(error: unknown): boolean {
  if (error === null || error === undefined) return false;

  if (matchesRejectionCode(error) || matchesRejectionMessage(error)) return true;

  const record = asRecord(error);
  if (!record) return false;

  return [record.cause, record.error].some(
    (nested) => matchesRejectionCode(nested) || matchesRejectionMessage(nested)
  );
}

/**
 * Runs a wallet-backed request and classifies the result without touching any
 * form state. Rejected requests are kept distinct from other failures so that
 * callers can preserve validated inputs and skip success/failure side effects.
 */
export async function runWalletRequest<T>(
  request: () => Promise<T>
): Promise<WalletRequestOutcome<T>> {
  try {
    return { status: 'success', value: await request() };
  } catch (error) {
    return { status: isWalletRejection(error) ? 'rejected' : 'failed', error };
  }
}
