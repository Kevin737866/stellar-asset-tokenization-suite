'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert, ArrowRightLeft, X } from 'lucide-react';

export type CanonicalStellarNetwork = 'PUBLIC' | 'TESTNET' | 'FUTURENET' | 'STANDALONE';

export const STELLAR_NETWORK_PASSPHRASES: Record<CanonicalStellarNetwork, string> = {
  PUBLIC: 'Public Global Stellar Network ; September 2015',
  TESTNET: 'Test SDF Network ; September 2015',
  FUTURENET: 'Test SDF Future Network ; October 2022',
  STANDALONE: 'Standalone Network ; February 2017',
};

const NETWORK_ALIASES: Record<string, CanonicalStellarNetwork> = {
  PUBLIC: 'PUBLIC',
  MAINNET: 'PUBLIC',
  PUBNET: 'PUBLIC',
  'PUBLIC GLOBAL STELLAR NETWORK ; SEPTEMBER 2015': 'PUBLIC',
  TESTNET: 'TESTNET',
  'TEST SDF NETWORK ; SEPTEMBER 2015': 'TESTNET',
  FUTURENET: 'FUTURENET',
  'TEST SDF FUTURE NETWORK ; OCTOBER 2022': 'FUTURENET',
  STANDALONE: 'STANDALONE',
  LOCAL: 'STANDALONE',
  'STANDALONE NETWORK ; FEBRUARY 2017': 'STANDALONE',
};

const NETWORK_DISPLAY_LABELS: Record<CanonicalStellarNetwork, string> = {
  PUBLIC: 'Stellar Mainnet (PUBLIC)',
  TESTNET: 'Stellar Testnet (TESTNET)',
  FUTURENET: 'Stellar Futurenet (FUTURENET)',
  STANDALONE: 'Standalone / Local Network',
};

export type NetworkMismatchStatus =
  | 'match'
  | 'mismatch'
  | 'wallet_unavailable'
  | 'invalid_config';

export type NetworkMismatchErrorCode =
  | 'NETWORK_MISMATCH'
  | 'WALLET_NETWORK_UNAVAILABLE'
  | 'INVALID_NETWORK_CONFIG';

export interface NetworkMismatchCheckInput {
  /** Expected network name (e.g. 'TESTNET', 'PUBLIC') or passphrase configured by the app. */
  expectedNetwork?: string | null;
  /** Currently active network reported by the connected wallet (e.g. Freighter). */
  walletNetwork?: string | null;
  /** Optional explicit expected Stellar network passphrase. */
  expectedPassphrase?: string | null;
  /** Optional explicit wallet Stellar network passphrase. */
  walletPassphrase?: string | null;
}

export interface NetworkMismatchResult {
  status: NetworkMismatchStatus;
  isMismatch: boolean;
  canSign: boolean;
  expectedNetwork: string | null;
  walletNetwork: string | null;
  expectedLabel: string;
  walletLabel: string;
  reason?: string;
}

export class NetworkMismatchError extends Error {
  public readonly code: NetworkMismatchErrorCode;
  public readonly expectedNetwork: string | null;
  public readonly walletNetwork: string | null;

  constructor(
    code: NetworkMismatchErrorCode,
    message: string,
    expectedNetwork: string | null,
    walletNetwork: string | null
  ) {
    super(message);
    this.name = 'NetworkMismatchError';
    this.code = code;
    this.expectedNetwork = expectedNetwork;
    this.walletNetwork = walletNetwork;
  }
}

/**
 * Normalizes a Stellar network name or passphrase into a canonical identifier
 * when it matches a known Stellar network, or returns a trimmed uppercase
 * string for custom networks. Returns null for empty/missing inputs.
 */
export function normalizeStellarNetwork(networkOrPassphrase?: string | null): string | null {
  if (typeof networkOrPassphrase !== 'string') {
    return null;
  }
  const trimmed = networkOrPassphrase.trim();
  if (!trimmed) {
    return null;
  }
  const upper = trimmed.toUpperCase();
  return NETWORK_ALIASES[upper] ?? upper;
}

/**
 * Formats a Stellar network identifier or passphrase into a human-readable label.
 */
export function formatNetworkLabel(networkOrPassphrase?: string | null): string {
  const normalized = normalizeStellarNetwork(networkOrPassphrase);
  if (!normalized) {
    return 'Unknown Network';
  }
  if (normalized in NETWORK_DISPLAY_LABELS) {
    return NETWORK_DISPLAY_LABELS[normalized as CanonicalStellarNetwork];
  }
  return networkOrPassphrase!.trim();
}

/**
 * Evaluates whether the connected wallet's active network matches the
 * application's expected Stellar network before transaction signing.
 */
export function evaluateNetworkMismatch(input: NetworkMismatchCheckInput): NetworkMismatchResult {
  const expectedNormalized = normalizeStellarNetwork(
    input.expectedNetwork ?? input.expectedPassphrase
  );
  const walletNormalized = normalizeStellarNetwork(
    input.walletNetwork ?? input.walletPassphrase
  );

  const expectedLabel = formatNetworkLabel(input.expectedNetwork ?? input.expectedPassphrase);
  const walletLabel = formatNetworkLabel(input.walletNetwork ?? input.walletPassphrase);

  if (!expectedNormalized) {
    return {
      status: 'invalid_config',
      isMismatch: true,
      canSign: false,
      expectedNetwork: null,
      walletNetwork: walletNormalized,
      expectedLabel,
      walletLabel,
      reason:
        'Application network configuration is missing or invalid. Transaction signing is blocked until a target Stellar network is configured.',
    };
  }

  if (!walletNormalized) {
    return {
      status: 'wallet_unavailable',
      isMismatch: true,
      canSign: false,
      expectedNetwork: expectedNormalized,
      walletNetwork: null,
      expectedLabel,
      walletLabel,
      reason: `Unable to verify your wallet network. Connect your wallet and switch to ${expectedLabel} before signing.`,
    };
  }

  const expectedPassphraseTrimmed = input.expectedPassphrase?.trim();
  const walletPassphraseTrimmed = input.walletPassphrase?.trim();
  const passphraseMismatch =
    Boolean(expectedPassphraseTrimmed) &&
    Boolean(walletPassphraseTrimmed) &&
    expectedPassphraseTrimmed !== walletPassphraseTrimmed;

  if (expectedNormalized !== walletNormalized || passphraseMismatch) {
    return {
      status: 'mismatch',
      isMismatch: true,
      canSign: false,
      expectedNetwork: expectedNormalized,
      walletNetwork: walletNormalized,
      expectedLabel,
      walletLabel,
      reason: `Your wallet is connected to ${walletLabel}, but this transaction requires ${expectedLabel}. Switch your wallet network before signing.`,
    };
  }

  return {
    status: 'match',
    isMismatch: false,
    canSign: true,
    expectedNetwork: expectedNormalized,
    walletNetwork: walletNormalized,
    expectedLabel,
    walletLabel,
  };
}

/**
 * Guards a transaction signing callback so it is never invoked when the wallet
 * network is missing, misconfigured, or does not match the expected network.
 */
export async function guardTransactionSigning<T>(
  input: NetworkMismatchCheckInput,
  signTransaction: () => Promise<T>
): Promise<T> {
  const result = evaluateNetworkMismatch(input);
  if (!result.canSign) {
    const code: NetworkMismatchErrorCode =
      result.status === 'invalid_config'
        ? 'INVALID_NETWORK_CONFIG'
        : result.status === 'wallet_unavailable'
          ? 'WALLET_NETWORK_UNAVAILABLE'
          : 'NETWORK_MISMATCH';

    throw new NetworkMismatchError(
      code,
      result.reason ?? 'Transaction signing blocked due to network mismatch.',
      result.expectedNetwork,
      result.walletNetwork
    );
  }

  return signTransaction();
}

/**
 * React hook that exposes the current network mismatch state and a guarded
 * signing wrapper that prevents transaction signing on network mismatch.
 */
export function useNetworkSigningGuard(input: NetworkMismatchCheckInput) {
  const mismatchResult = useMemo(
    () =>
      evaluateNetworkMismatch({
        expectedNetwork: input.expectedNetwork,
        walletNetwork: input.walletNetwork,
        expectedPassphrase: input.expectedPassphrase,
        walletPassphrase: input.walletPassphrase,
      }),
    [
      input.expectedNetwork,
      input.walletNetwork,
      input.expectedPassphrase,
      input.walletPassphrase,
    ]
  );

  const guardedSign = useCallback(
    async <T,>(signFn: () => Promise<T>): Promise<T> => {
      return guardTransactionSigning(
        {
          expectedNetwork: input.expectedNetwork,
          walletNetwork: input.walletNetwork,
          expectedPassphrase: input.expectedPassphrase,
          walletPassphrase: input.walletPassphrase,
        },
        signFn
      );
    },
    [
      input.expectedNetwork,
      input.walletNetwork,
      input.expectedPassphrase,
      input.walletPassphrase,
    ]
  );

  return {
    mismatchResult,
    canSign: mismatchResult.canSign,
    isMismatch: mismatchResult.isMismatch,
    guardedSign,
  };
}

export interface NetworkMismatchWarningProps extends NetworkMismatchCheckInput {
  /** Human-readable description of the pending action (e.g. "deploying this token"). */
  transactionAction?: string;
  /** Optional handler to switch the connected wallet to the expected network. */
  onSwitchNetwork?: () => Promise<void> | void;
  /** Optional handler to re-fetch the active wallet network. */
  onRefreshNetwork?: () => Promise<void> | void;
  /** Optional handler to cancel the pending signing flow. */
  onCancel?: () => void;
  /** Additional CSS classes for the outer container. */
  className?: string;
}

/**
 * Displays a clear, accessible warning banner before transaction signing
 * whenever the connected wallet's network does not match the expected Stellar network.
 */
export function NetworkMismatchWarning({
  expectedNetwork,
  walletNetwork,
  expectedPassphrase,
  walletPassphrase,
  transactionAction = 'signing this transaction',
  onSwitchNetwork,
  onRefreshNetwork,
  onCancel,
  className = '',
}: NetworkMismatchWarningProps) {
  const [isSwitching, setIsSwitching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const result = useMemo(
    () =>
      evaluateNetworkMismatch({
        expectedNetwork,
        walletNetwork,
        expectedPassphrase,
        walletPassphrase,
      }),
    [expectedNetwork, walletNetwork, expectedPassphrase, walletPassphrase]
  );

  const handleSwitchNetwork = useCallback(async () => {
    if (!onSwitchNetwork || isSwitching) return;
    setActionError(null);
    setIsSwitching(true);
    try {
      await onSwitchNetwork();
    } catch (err: any) {
      setActionError(
        err?.message || 'Unable to switch wallet network automatically. Please switch it manually in your wallet.'
      );
    } finally {
      setIsSwitching(false);
    }
  }, [onSwitchNetwork, isSwitching]);

  const handleRefreshNetwork = useCallback(async () => {
    if (!onRefreshNetwork || isRefreshing) return;
    setActionError(null);
    setIsRefreshing(true);
    try {
      await onRefreshNetwork();
    } catch (err: any) {
      setActionError(
        err?.message || 'Unable to verify the wallet network. Please check your wallet extension.'
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshNetwork, isRefreshing]);

  if (result.status === 'match') {
    return null;
  }

  const isSevere = result.status === 'mismatch' || result.status === 'invalid_config';
  const heading =
    result.status === 'mismatch'
      ? 'Network Mismatch Detected'
      : result.status === 'wallet_unavailable'
        ? 'Wallet Network Unavailable'
        : 'Invalid Network Configuration';

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="network-mismatch-warning"
      data-network-status={result.status}
      className={`rounded-lg border-l-4 p-4 shadow-sm ${
        isSevere
          ? 'border-red-500 bg-red-50 text-red-900 dark:border-red-400 dark:bg-red-950/60 dark:text-red-100'
          : 'border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-400 dark:bg-amber-950/60 dark:text-amber-100'
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        {isSevere ? (
          <ShieldAlert
            className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400 mt-0.5"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5"
            aria-hidden="true"
          />
        )}

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{heading}</h3>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Dismiss network mismatch warning"
                className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <p className="text-sm">
            {result.reason} Transaction signing is blocked before {transactionAction}.
          </p>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md bg-white/70 dark:bg-black/20 p-2.5 text-xs">
            <div>
              <dt className="font-medium opacity-75">Connected Wallet Network</dt>
              <dd className="font-semibold mt-0.5" data-testid="wallet-network-label">
                {result.walletLabel}
              </dd>
            </div>
            <div>
              <dt className="font-medium opacity-75">Expected App Network</dt>
              <dd className="font-semibold mt-0.5" data-testid="expected-network-label">
                {result.expectedLabel}
              </dd>
            </div>
          </dl>

          {actionError && (
            <p className="text-xs font-medium text-red-700 dark:text-red-300" role="status">
              {actionError}
            </p>
          )}

          {(onSwitchNetwork || onRefreshNetwork || onCancel) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {onSwitchNetwork && result.status === 'mismatch' && (
                <button
                  type="button"
                  onClick={handleSwitchNetwork}
                  disabled={isSwitching || isRefreshing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  {isSwitching ? 'Switching...' : `Switch to ${result.expectedLabel}`}
                </button>
              )}

              {onRefreshNetwork && (
                <button
                  type="button"
                  onClick={handleRefreshNetwork}
                  disabled={isSwitching || isRefreshing}
                  className="inline-flex items-center gap-1.5 rounded-md border border-current/25 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  {isRefreshing ? 'Checking...' : 'Re-check Network'}
                </button>
              )}

              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isSwitching || isRefreshing}
                  className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NetworkMismatchWarning;
