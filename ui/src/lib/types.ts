// Shared type definitions for the Stellar RWA UI

export type AssetType =
  | 'real_estate'
  | 'commodity'
  | 'invoice'
  | 'security'
  | 'bond'
  | 'art'
  | 'intellectual_property';

export interface DeploymentOptions {
  name: string;
  symbol: string;
  totalSupply: string;
  decimals: number;
  assetType: AssetType;
  metadata: Record<string, string>;
  complianceRegistry: string;
  dividendDistributor: string;
}

export interface Balance {
  asset: string;
  amount: string;
  lockedAmount: string;
  votingPower: string;
  assetType?: AssetType;
}

export interface AssetInfo {
  address: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  assetType: AssetType;
  isPaused?: boolean;
}

export interface AssetHolding {
  asset: AssetInfo;
  balance: Balance;
  value: string;
  valueUsd?: string;
  percentage: number;
  percentageOfPortfolio?: number;
  dividends: string;
}

export interface Portfolio {
  /** Array of held assets — used by OwnershipDashboard */
  assets: AssetHolding[];
  /** Legacy alias kept for components that use `holdings` */
  holdings?: AssetHolding[];
  /** Total portfolio value as a decimal string (e.g. "12345.67") */
  totalValue: string;
  totalValueUsd: string;
  totalDividends: string;
  votingPower: string;
  pnlUsd?: string;
  pnlPercent?: number;
}

// Wallet-specific types

/** Current connection state of the wallet */
export type WalletStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'unsupported';

/** Supported wallet providers */
export type WalletProvider = 'freighter' | 'albedo' | 'xbull' | 'rabet';

export interface WalletInfo {
  provider: WalletProvider;
  address: string;
  network: string;
  balance?: string;
}

export interface WalletConnectOptions {
  provider: WalletProvider;
  network?: string;
}
