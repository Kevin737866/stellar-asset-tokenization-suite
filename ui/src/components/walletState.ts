/**
 * Wallet connection state and authorization helpers for AssetDeployer.
 *
 * Keeps wallet validation, state transitions, and deployment authorization
 * pure and testable with explicit input and failure semantics.
 */

export type WalletConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface WalletState {
  status: WalletConnectionStatus;
  address: string | null;
  network: string | null;
  error: string | null;
}

export interface WalletControlProps {
  /** Controlled connected Stellar public key (G...). */
  walletAddress?: string | null;
  /** Optional Stellar network name (e.g., TESTNET, PUBLIC). */
  walletNetwork?: string | null;
  /** Explicit controlled connection flag. */
  isWalletConnected?: boolean;
  /** Controlled connecting flag. */
  isConnectingWallet?: boolean;
  /** Controlled wallet error message. */
  walletError?: string | null;
}

export interface WalletConnectResult {
  address: string;
  network?: string | null;
}

export interface DeploymentAuthorization {
  allowed: boolean;
  reason?: string;
}

export const DISCONNECTED_WALLET_STATE: WalletState = {
  status: 'disconnected',
  address: null,
  network: null,
  error: null,
};

/**
 * Stellar Ed25519 public keys start with 'G' followed by 55 base32 characters (A-Z, 2-7).
 */
const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Validates that a value is a well-formed Stellar public key.
 */
export function isValidStellarPublicKey(address: unknown): address is string {
  if (typeof address !== 'string') {
    return false;
  }
  const trimmed = address.trim();
  return STELLAR_PUBLIC_KEY_REGEX.test(trimmed);
}

/**
 * Truncates a Stellar public key for compact UI display.
 */
export function formatWalletAddress(
  address: string,
  prefixLen = 6,
  suffixLen = 4
): string {
  const trimmed = address.trim();
  if (trimmed.length <= prefixLen + suffixLen + 3) {
    return trimmed;
  }
  return `${trimmed.slice(0, prefixLen)}...${trimmed.slice(-suffixLen)}`;
}

/**
 * Resolves the effective wallet state from optional controlled props and internal state.
 * Controlled props take precedence when any controlled wallet prop is provided.
 */
export function resolveWalletState(
  controlled: WalletControlProps,
  internal: WalletState
): WalletState {
  const hasControlledProps =
    controlled.walletAddress !== undefined ||
    controlled.isWalletConnected !== undefined ||
    controlled.isConnectingWallet !== undefined ||
    controlled.walletError !== undefined ||
    controlled.walletNetwork !== undefined;

  if (!hasControlledProps) {
    return internal;
  }

  if (controlled.isConnectingWallet) {
    return {
      status: 'connecting',
      address: null,
      network: controlled.walletNetwork ?? null,
      error: null,
    };
  }

  if (controlled.walletError) {
    return {
      status: 'error',
      address: null,
      network: null,
      error: controlled.walletError,
    };
  }

  const rawAddress = controlled.walletAddress?.trim() || null;
  const explicitlyDisconnected = controlled.isWalletConnected === false;

  if (explicitlyDisconnected || !rawAddress) {
    return {
      status: 'disconnected',
      address: null,
      network: null,
      error: null,
    };
  }

  if (!isValidStellarPublicKey(rawAddress)) {
    return {
      status: 'error',
      address: null,
      network: null,
      error: 'Invalid Stellar wallet public key.',
    };
  }

  return {
    status: 'connected',
    address: rawAddress,
    network: controlled.walletNetwork ?? null,
    error: null,
  };
}

/**
 * Checks whether the current wallet state authorizes asset deployment.
 */
export function canDeployWithWallet(state: WalletState): DeploymentAuthorization {
  if (state.status === 'connecting') {
    return {
      allowed: false,
      reason: 'Wallet connection is in progress. Please wait until connected.',
    };
  }

  if (state.status === 'error') {
    return {
      allowed: false,
      reason: state.error || 'Wallet connection error. Please reconnect your wallet.',
    };
  }

  if (state.status !== 'connected' || !isValidStellarPublicKey(state.address)) {
    return {
      allowed: false,
      reason: 'Connect a Stellar wallet before deploying an asset.',
    };
  }

  return { allowed: true };
}

/**
 * Executes a wallet connection attempt with atomic state semantics:
 * - On success with a valid Stellar public key, returns a connected WalletState.
 * - On invalid key or thrown error, returns an error WalletState with no partial address/network.
 */
export async function executeWalletConnect(
  connector: () => Promise<WalletConnectResult | string | null | undefined>
): Promise<WalletState> {
  try {
    const result = await connector();
    const rawAddress =
      typeof result === 'string' ? result : result?.address ?? null;
    const network =
      typeof result === 'object' && result !== null
        ? result.network ?? null
        : null;

    if (!rawAddress || !rawAddress.trim()) {
      return {
        status: 'error',
        address: null,
        network: null,
        error: 'Wallet did not return a public key. Connection was cancelled or rejected.',
      };
    }

    const trimmedAddress = rawAddress.trim();
    if (!isValidStellarPublicKey(trimmedAddress)) {
      return {
        status: 'error',
        address: null,
        network: null,
        error: 'Wallet returned an invalid Stellar public key.',
      };
    }

    return {
      status: 'connected',
      address: trimmedAddress,
      network,
      error: null,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to connect wallet. Please try again.';
    return {
      status: 'error',
      address: null,
      network: null,
      error: message,
    };
  }
}

/**
 * Executes a wallet disconnection attempt with atomic state semantics:
 * - On success, returns DISCONNECTED_WALLET_STATE.
 * - On failure, preserves currentState unchanged and surfaces the error message.
 */
export async function executeWalletDisconnect(
  currentState: WalletState,
  disconnector?: () => Promise<void> | void
): Promise<{ state: WalletState; error?: string }> {
  try {
    if (disconnector) {
      await disconnector();
    }
    return { state: DISCONNECTED_WALLET_STATE };
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Failed to disconnect wallet.';
    return {
      state: currentState,
      error: message,
    };
  }
}
