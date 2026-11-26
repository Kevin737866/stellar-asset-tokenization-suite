'use client';

import React from 'react';
import {
  formatStellarAccount,
  formatStellarNetwork,
  normalizeStellarAccount,
  NOT_CONNECTED_LABEL,
  type StellarNetwork,
} from './walletHeaderModel';

export interface WalletHeaderProps {
  account: string | null | undefined;
  network: StellarNetwork | string | null | undefined;
  title?: string;
  className?: string;
}

export const WalletHeader: React.FC<WalletHeaderProps> = ({
  account,
  network,
  title = 'Stellar RWA Suite',
  className = '',
}) => {
  const normalizedAccount = normalizeStellarAccount(account);
  const accountLabel = formatStellarAccount(account);
  const networkLabel = formatStellarNetwork(network);
  const connectionLabel = normalizedAccount ? 'Connected' : NOT_CONNECTED_LABEL;

  return (
    <header
      className={`flex flex-wrap items-center justify-between gap-4 border-b border-theme-border bg-theme-surface px-6 py-4 ${className}`}
      aria-label="Stellar wallet header"
    >
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold text-theme-text-primary">{title}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            normalizedAccount
              ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
          }`}
          data-status={connectionLabel.toLowerCase()}
        >
          {connectionLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span
          className="text-theme-text-secondary"
          aria-label="Active Stellar account"
          title={normalizedAccount ?? undefined}
        >
          Account: <span className="font-mono text-theme-text-primary">{accountLabel}</span>
        </span>
        <span
          className="text-theme-text-secondary"
          aria-label="Selected Stellar network"
          data-network={networkLabel === 'Unknown network' ? undefined : String(network).trim()}
        >
          Network: <span className="font-medium text-theme-text-primary">{networkLabel}</span>
        </span>
      </div>
    </header>
  );
};

export default WalletHeader;
