/**
 * Wallet connection and signing contract helpers for UI integrators.
 *
 * These utilities codify the input, authorization, and failure semantics
 * documented in `./WALLET_INTEGRATION.md` without mutating caller state.
 */

export type WalletNetwork = 'PUBLIC' | 'TESTNET' | 'FUTURENET';

export const STELLAR_NETWORK_PASSPHRASES: Readonly<Record<WalletNetwork, string>> = {
  PUBLIC: 'Public Global Stellar Network ; September 2015',
  TESTNET: 'Test SDF Network ; September 2015',
  FUTURENET: 'Test SDF Future Network ; October 2022',
};

export interface WalletConnectionState {
  /** Whether the wallet extension is connected and authorized for this origin. */
  connected: boolean;
  /** Connected Stellar Ed25519 public key (G...), or null when disconnected. */
  publicKey: string | null;
  /** Active Stellar network reported by the wallet, or null when disconnected. */
  network: WalletNetwork | null;
}

export interface WalletSigningRequest {
  /** Unsigned Stellar/Soroban transaction envelope in base64 XDR format. */
  xdr: string;
  /** Expected Stellar network configured by the host application. */
  expectedNetwork: WalletNetwork;
  /** Network passphrase passed to the wallet signer; defaults to the expected network passphrase. */
  networkPassphrase?: string;
}

export type WalletValidationErrorCode =
  | 'WALLET_NOT_CONNECTED'
  | 'INVALID_PUBLIC_KEY'
  | 'NETWORK_MISMATCH'
  | 'INVALID_XDR'
  | 'INVALID_NETWORK_PASSPHRASE';

export type WalletValidationResult =
  | { ok: true }
  | { ok: false; code: WalletValidationErrorCode; message: string };

const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Returns a clean, disconnected wallet state snapshot.
 */
export function createDisconnectedWalletState(): WalletConnectionState {
  return {
    connected: false,
    publicKey: null,
    network: null,
  };
}

/**
 * Returns the canonical Stellar network passphrase for a supported network.
 */
export function getExpectedNetworkPassphrase(network: WalletNetwork): string {
  return STELLAR_NETWORK_PASSPHRASES[network];
}

/**
 * Validates whether a string is a syntactically valid Stellar Ed25519 public key.
 */
export function isValidStellarPublicKey(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_PUBLIC_KEY_REGEX.test(value.trim());
}

/**
 * Validates that a wallet connection is authorized, has a valid Stellar public key,
 * and is connected to the expected network.
 */
export function validateWalletConnection(
  state: WalletConnectionState | null | undefined,
  expectedNetwork: WalletNetwork
): WalletValidationResult {
  if (!state || !state.connected) {
    return {
      ok: false,
      code: 'WALLET_NOT_CONNECTED',
      message: 'Connect and authorize a Stellar wallet before continuing.',
    };
  }

  if (!isValidStellarPublicKey(state.publicKey)) {
    return {
      ok: false,
      code: 'INVALID_PUBLIC_KEY',
      message: 'Connected wallet did not provide a valid Stellar public key.',
    };
  }

  if (!state.network || state.network !== expectedNetwork) {
    return {
      ok: false,
      code: 'NETWORK_MISMATCH',
      message: `Wallet network mismatch: expected ${expectedNetwork}, got ${state.network ?? 'UNKNOWN'}.`,
    };
  }

  return { ok: true };
}

/**
 * Validates both wallet connection authorization and signing request inputs
 * prior to invoking the wallet's `signTransaction` method.
 */
export function validateSigningRequest(
  state: WalletConnectionState | null | undefined,
  request: WalletSigningRequest | null | undefined
): WalletValidationResult {
  if (!request) {
    return {
      ok: false,
      code: 'INVALID_XDR',
      message: 'A signing request with an unsigned transaction XDR is required.',
    };
  }

  const connectionCheck = validateWalletConnection(state, request.expectedNetwork);
  if (!connectionCheck.ok) {
    return connectionCheck;
  }

  if (typeof request.xdr !== 'string' || request.xdr.trim().length === 0) {
    return {
      ok: false,
      code: 'INVALID_XDR',
      message: 'Unsigned transaction XDR must be a non-empty string.',
    };
  }

  const expectedPassphrase = getExpectedNetworkPassphrase(request.expectedNetwork);
  if (
    request.networkPassphrase !== undefined &&
    request.networkPassphrase.trim() !== expectedPassphrase
  ) {
    return {
      ok: false,
      code: 'INVALID_NETWORK_PASSPHRASE',
      message: `Network passphrase does not match ${request.expectedNetwork}.`,
    };
  }

  return { ok: true };
}
