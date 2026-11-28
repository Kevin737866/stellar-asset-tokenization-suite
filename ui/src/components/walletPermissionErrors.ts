export type WalletPermissionErrorKind =
  | 'user_rejected'
  | 'not_connected'
  | 'wallet_locked'
  | 'wallet_not_installed'
  | 'network_mismatch'
  | 'bad_auth';

export interface WalletPermissionErrorExplanation {
  kind: WalletPermissionErrorKind;
  title: string;
  message: string;
  recoverySteps: string[];
  retryable: boolean;
}

interface NormalizedErrorInput {
  code: string;
  message: string;
}

function normalizeErrorInput(error: unknown): NormalizedErrorInput | null {
  if (error === null || error === undefined) {
    return null;
  }

  if (typeof error === 'string') {
    const trimmed = error.trim();
    return trimmed ? { code: '', message: trimmed } : null;
  }

  if (typeof error !== 'object') {
    return null;
  }

  const record = error as Record<string, unknown>;
  const rawCode = record.code ?? record.errorCode ?? record.name;
  const rawMessage = record.message ?? record.error ?? record.reason;

  const code =
    typeof rawCode === 'string' || typeof rawCode === 'number'
      ? String(rawCode).trim()
      : '';
  const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';

  if (!code && !message) {
    return null;
  }

  return { code, message };
}

const USER_REJECTED_CODES = new Set([
  '4001',
  'USER_DECLINED',
  'USER_REJECTED',
  'ACTION_REJECTED',
  'REQUEST_REJECTED',
  'SIGNING_CANCELLED',
  'SIGNING_CANCELED',
]);

const NOT_CONNECTED_CODES = new Set([
  '4100',
  'UNAUTHORIZED',
  'PERMISSION_DENIED',
  'ACCESS_DENIED',
  'WALLET_NOT_CONNECTED',
  'NOT_CONNECTED',
  'SITE_NOT_AUTHORIZED',
]);

const WALLET_LOCKED_CODES = new Set(['WALLET_LOCKED', 'ACCOUNT_LOCKED']);

const WALLET_NOT_INSTALLED_CODES = new Set([
  'WALLET_NOT_INSTALLED',
  'WALLET_NOT_FOUND',
  'FREIGHTER_NOT_INSTALLED',
  'PROVIDER_NOT_FOUND',
]);

const NETWORK_MISMATCH_CODES = new Set([
  'NETWORK_MISMATCH',
  'WRONG_NETWORK',
  'CHAIN_MISMATCH',
]);

const BAD_AUTH_CODES = new Set(['TX_BAD_AUTH', 'TX_BAD_AUTH_EXTRA']);

/**
 * Classifies wallet permission and authorization errors into user-friendly
 * explanations with actionable recovery steps.
 *
 * Returns `null` when the error is not a recognized wallet permission error.
 */
export function explainWalletPermissionError(
  error: unknown
): WalletPermissionErrorExplanation | null {
  const normalized = normalizeErrorInput(error);
  if (!normalized) {
    return null;
  }

  const upperCode = normalized.code.toUpperCase();
  const lowerMessage = normalized.message.toLowerCase();

  if (
    WALLET_NOT_INSTALLED_CODES.has(upperCode) ||
    lowerMessage.includes('freighter is not installed') ||
    lowerMessage.includes('wallet not installed') ||
    lowerMessage.includes('extension not installed') ||
    lowerMessage.includes('no wallet detected') ||
    lowerMessage.includes('wallet not found')
  ) {
    return {
      kind: 'wallet_not_installed',
      title: 'Wallet Extension Not Found',
      message:
        'A compatible Stellar wallet extension (such as Freighter) was not detected in your browser.',
      recoverySteps: [
        'Install the Freighter browser extension from the official browser extension store.',
        'Enable the extension and refresh this page.',
        'Click Connect Wallet and approve the connection prompt.',
      ],
      retryable: true,
    };
  }

  if (
    WALLET_LOCKED_CODES.has(upperCode) ||
    lowerMessage.includes('wallet is locked') ||
    lowerMessage.includes('wallet locked') ||
    lowerMessage.includes('unlock your wallet') ||
    lowerMessage.includes('unlock freighter')
  ) {
    return {
      kind: 'wallet_locked',
      title: 'Wallet Locked',
      message:
        'Your Stellar wallet is currently locked and cannot authorize this request.',
      recoverySteps: [
        'Open your Stellar wallet extension (e.g., Freighter).',
        'Enter your password to unlock the wallet.',
        'Return to this page and retry the operation.',
      ],
      retryable: true,
    };
  }

  if (
    NETWORK_MISMATCH_CODES.has(upperCode) ||
    lowerMessage.includes('network mismatch') ||
    lowerMessage.includes('wrong network') ||
    lowerMessage.includes('switch network') ||
    lowerMessage.includes('different network')
  ) {
    return {
      kind: 'network_mismatch',
      title: 'Wallet Network Mismatch',
      message:
        'Your wallet is connected to a different Stellar network than this application expects.',
      recoverySteps: [
        'Open your Stellar wallet extension settings.',
        'Switch to the Stellar network (Testnet or Mainnet) required by this app.',
        'Retry the operation once the network matches.',
      ],
      retryable: true,
    };
  }

  if (
    USER_REJECTED_CODES.has(upperCode) ||
    lowerMessage.includes('user declined') ||
    lowerMessage.includes('user rejected') ||
    lowerMessage.includes('rejected by user') ||
    lowerMessage.includes('user denied') ||
    lowerMessage.includes('request rejected') ||
    lowerMessage.includes('signing cancelled') ||
    lowerMessage.includes('signing canceled')
  ) {
    return {
      kind: 'user_rejected',
      title: 'Wallet Permission Denied',
      message:
        'The wallet connection or transaction signing request was declined.',
      recoverySteps: [
        'Review the requested action and account details in this app.',
        'Retry the action and click Approve in your wallet extension popup.',
        'Check that your browser is not blocking or hiding the wallet popup window.',
      ],
      retryable: true,
    };
  }

  if (
    NOT_CONNECTED_CODES.has(upperCode) ||
    lowerMessage.includes('wallet is not connected') ||
    lowerMessage.includes('wallet not connected') ||
    lowerMessage.includes('not connected') ||
    lowerMessage.includes('permission denied') ||
    lowerMessage.includes('access denied') ||
    lowerMessage.includes('site not authorized') ||
    lowerMessage.includes('not allowed to access') ||
    lowerMessage.includes('unauthorized')
  ) {
    return {
      kind: 'not_connected',
      title: 'Wallet Access Not Granted',
      message:
        'This site does not currently have permission to access your Stellar wallet account.',
      recoverySteps: [
        'Open your Stellar wallet extension and confirm it is unlocked.',
        'Grant site access in your wallet connected-sites or permissions settings.',
        'Reconnect your wallet in this app and retry the operation.',
      ],
      retryable: true,
    };
  }

  if (
    BAD_AUTH_CODES.has(upperCode) ||
    lowerMessage.includes('tx_bad_auth')
  ) {
    return {
      kind: 'bad_auth',
      title: 'Transaction Authorization Failed',
      message:
        'The transaction was rejected due to invalid or missing wallet signatures.',
      recoverySteps: [
        'Confirm that the active account in your wallet matches the account required for this action.',
        'If this is a multi-signature account, ensure all required signers have signed.',
        'Reconnect your wallet and retry signing the transaction.',
      ],
      retryable: true,
    };
  }

  return null;
}

/**
 * Returns `true` if the error is a recognized wallet permission or authorization error.
 */
export function isWalletPermissionError(error: unknown): boolean {
  return explainWalletPermissionError(error) !== null;
}
