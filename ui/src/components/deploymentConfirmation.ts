import type { AssetType, DeploymentOptions } from '@/lib/types';

export interface DeploymentSummaryMetadataEntry {
  key: string;
  value: string;
}

export interface DeploymentConfirmationSummary {
  options: DeploymentOptions;
  assetTypeLabel: string;
  formattedTotalSupply: string;
  metadataEntries: DeploymentSummaryMetadataEntry[];
  warnings: string[];
}

export interface DeploymentConfirmationBuildResult {
  summary: DeploymentConfirmationSummary | null;
  errors: Record<string, string>;
}

export interface DeploymentConfirmationGateOptions {
  acknowledged: boolean;
  isSubmitting?: boolean;
  isLoading?: boolean;
  walletConnected?: boolean;
}

export interface DeploymentConfirmationGateResult {
  allowed: boolean;
  reason?: string;
}

const VALID_ASSET_TYPES = new Set<string>([
  'real_estate',
  'commodity',
  'invoice',
  'security',
  'bond',
  'art',
  'intellectual_property',
]);

export function formatAssetTypeLabel(assetType: AssetType): string {
  return assetType
    .split('_')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function formatSupplyDisplay(totalSupply: string): string {
  const numeric = Number(totalSupply);
  if (!Number.isFinite(numeric)) {
    return totalSupply;
  }
  return numeric.toLocaleString('en-US', { maximumFractionDigits: 18 });
}

/**
 * Validates deployment options and builds an immutable pre-deployment
 * confirmation summary. Returns `{ summary: null, errors }` when any required
 * field is missing or out of bounds.
 */
export function buildDeploymentConfirmationSummary(
  input: DeploymentOptions
): DeploymentConfirmationBuildResult {
  const errors: Record<string, string> = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
  const totalSupplyRaw = typeof input.totalSupply === 'string' ? input.totalSupply.trim() : '';
  const decimals = Number(input.decimals);
  const assetType = input.assetType;
  const complianceRegistry =
    typeof input.complianceRegistry === 'string' ? input.complianceRegistry.trim() : '';
  const dividendDistributor =
    typeof input.dividendDistributor === 'string' ? input.dividendDistributor.trim() : '';

  if (!name) {
    errors.name = 'Asset name is required';
  } else if (name.length < 3) {
    errors.name = 'Asset name must be at least 3 characters';
  }

  if (!symbol) {
    errors.symbol = 'Asset symbol is required';
  } else if (symbol.length < 2 || symbol.length > 8) {
    errors.symbol = 'Asset symbol must be 2-8 characters';
  } else if (!/^[A-Z0-9]+$/.test(symbol)) {
    errors.symbol = 'Asset symbol must contain only uppercase letters and numbers';
  }

  const parsedSupply = Number(totalSupplyRaw);
  if (!totalSupplyRaw) {
    errors.totalSupply = 'Total supply is required';
  } else if (!Number.isFinite(parsedSupply) || parsedSupply <= 0) {
    errors.totalSupply = 'Total supply must be a positive number';
  }

  if (!assetType || !VALID_ASSET_TYPES.has(assetType)) {
    errors.assetType = 'Asset type is required';
  }

  if (!complianceRegistry) {
    errors.complianceRegistry = 'Compliance registry address is required';
  }

  if (!dividendDistributor) {
    errors.dividendDistributor = 'Dividend distributor address is required';
  }

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    errors.decimals = 'Decimals must be an integer between 0 and 18';
  }

  if (Object.keys(errors).length > 0) {
    return { summary: null, errors };
  }

  const rawMetadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const normalizedMetadata: Record<string, string> = {};
  const metadataEntries: DeploymentSummaryMetadataEntry[] = [];

  for (const [key, value] of Object.entries(rawMetadata)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      continue;
    }
    const normalizedValue = typeof value === 'string' ? value.trim() : String(value ?? '');
    normalizedMetadata[trimmedKey] = normalizedValue;
    metadataEntries.push({ key: trimmedKey, value: normalizedValue });
  }

  const warnings: string[] = [
    'Deploying an RWA token creates an irreversible smart contract on the Stellar network and consumes XLM fees.',
  ];

  if (complianceRegistry === dividendDistributor) {
    warnings.push(
      'Compliance registry and dividend distributor addresses are identical. Verify this is intentional before deploying.'
    );
  }

  if (metadataEntries.length === 0) {
    warnings.push('No asset metadata fields are attached to this deployment.');
  }

  const normalizedOptions: DeploymentOptions = {
    name,
    symbol,
    totalSupply: totalSupplyRaw,
    decimals,
    assetType,
    metadata: normalizedMetadata,
    complianceRegistry,
    dividendDistributor,
  };

  return {
    summary: {
      options: normalizedOptions,
      assetTypeLabel: formatAssetTypeLabel(assetType),
      formattedTotalSupply: formatSupplyDisplay(totalSupplyRaw),
      metadataEntries,
      warnings,
    },
    errors: {},
  };
}

/**
 * Explicit authorization and readiness gate evaluated before invoking onDeploy.
 */
export function canConfirmDeployment(
  summary: DeploymentConfirmationSummary | null,
  gate: DeploymentConfirmationGateOptions
): DeploymentConfirmationGateResult {
  if (!summary) {
    return {
      allowed: false,
      reason: 'A valid deployment summary is required before confirming deployment.',
    };
  }

  if (gate.walletConnected === false) {
    return {
      allowed: false,
      reason: 'Connect and authorize a Stellar wallet before deploying an asset.',
    };
  }

  if (gate.isSubmitting || gate.isLoading) {
    return {
      allowed: false,
      reason: 'A deployment is already in progress.',
    };
  }

  if (!gate.acknowledged) {
    return {
      allowed: false,
      reason: 'Explicitly acknowledge the deployment summary before proceeding.',
    };
  }

  return { allowed: true };
}
