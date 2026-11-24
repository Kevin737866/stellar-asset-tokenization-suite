'use client';

import React, { useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { canonicalAccount, runWalletDisconnect } from './walletSession';

export interface WalletDisconnectButtonProps {
  account: string | null | undefined;
  onDisconnect: () => Promise<void> | void;
  onDisconnected?: () => void;
  onError?: (error: unknown) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * Disconnects the wallet and lets the owner clear the session account.
 *
 * The button itself never mutates account data: it calls `onDisconnect`, then
 * `onDisconnected` only after success so the owner can set the account to null
 * and account-scoped views can clear. Failed attempts leave the session intact
 * and are reported through `onError`.
 */
export function WalletDisconnectButton({
  account,
  onDisconnect,
  onDisconnected,
  onError,
  disabled = false,
  label = 'Disconnect wallet',
}: WalletDisconnectButtonProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const isConnected = canonicalAccount(account) !== null;
  const isDisabled = !isConnected || disabled || isDisconnecting;

  const handleClick = async () => {
    if (isDisabled) return;

    setIsDisconnecting(true);
    try {
      const outcome = await runWalletDisconnect({
        account,
        inFlight: false,
        disconnect: onDisconnect,
      });

      if (outcome.status === 'success') {
        onDisconnected?.();
      } else if (outcome.status === 'failed') {
        onError?.(outcome.error);
      }
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-label={label}
      aria-busy={isDisconnecting}
      className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {isDisconnecting ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <LogOut className="h-4 w-4" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

export default WalletDisconnectButton;
