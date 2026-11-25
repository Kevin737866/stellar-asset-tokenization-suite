/**
 * Re-export of core SDK types for use within the UI package via the `@/lib/types` alias.
 *
 * Components import from `@/lib/types` rather than reaching into the SDK
 * directly, keeping the UI decoupled from the SDK's internal path structure.
 */
export type {
  AssetInfo,
  AssetHolding,
  Balance,
  Portfolio,
  KYCStatus,
  TransferLimits,
  ComplianceRule,
  DividendDistribution,
  ClaimInfo,
  DividendConfig,
  Order,
  OrderBook,
  Trade,
  DeploymentOptions,
  SimulationResult,
} from '../../../sdk/src/types';

export { AssetType, VerificationLevel, Currency, OrderType } from '../../../sdk/src/types';
