/**
 * UI-layer type definitions shared across dashboard components.
 *
 * Types that are purely presentational or extend the SDK's types for UI
 * rendering purposes live here rather than in the SDK package.
 */

// ── Asset types ────────────────────────────────────────────────────────────────

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

// ── Portfolio / ownership types ────────────────────────────────────────────────

export interface Balance {
  available: string;
  locked: string;
  total: string;
}

export interface AssetInfo {
  address: string;
  name: string;
  symbol: string;
  assetType: AssetType;
  totalSupply: string;
  decimals: number;
  complianceRegistry?: string;
  dividendDistributor?: string;
}

export interface DividendInfo {
  distributionId: number;
  amount: string;
  token: string;
  claimable: boolean;
  claimedAt?: Date;
}

export interface AssetHolding {
  asset: AssetInfo;
  balance: Balance;
  value: string;
  percentage: number;
  dividends?: DividendInfo[];
  lockedUntil?: Date;
}

export interface Portfolio {
  totalValue: string;
  currency: string;
  assets: AssetHolding[];
  lastUpdated: Date;
}
