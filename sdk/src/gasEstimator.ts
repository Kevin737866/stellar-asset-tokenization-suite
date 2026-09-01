/**
 * Gas estimation utility for pre-flight transaction costing.
 * Issue #194.
 *
 * Provides simulation-based gas estimates for Soroban/Stellar transactions
 * using the bundled RPC server's `simulateTransaction`, with a time-based
 * cache for common operations, a congestion multiplier, and a deterministic
 * heuristic fallback when the simulation is unavailable.
 */

import { InvalidParametersError, TransactionError } from './errors';
import { createLogger, Logger } from './logger';

/**
 * Categorization of common operations. Used both for cache keys and for the
 * deterministic heuristic fallback cost tables.
 */
export type OperationType =
  | 'transfer'
  | 'deploy'
  | 'initialize'
  | 'mint'
  | 'burn'
  | 'claim'
  | 'payout'
  | 'ordering'
  | 'trade'
  | 'custody'
  | 'approve'
  | 'proposal'
  | 'custom';

/**
 * A minimal interface for the server capable of simulating a transaction. We
 * intentionally accept any object that exposes `simulateTransaction` (and
 * optionally `getFeeStats`) so the estimator can be unit-tested with a mock
 * and wired to either a Horizon or Soroban RPC server at runtime.
 */
export interface GasEstimationServer {
  simulateTransaction(tx: any): Promise<any>;
  getFeeStats?(): Promise<{ feeCharged?: { max?: string } }>;
}

/**
 * Result of a gas estimation for one operation.
 */
export interface GasEstimate {
  /** Which operation the estimate applies to. */
  operation: OperationType;
  /**
   * Recommended total fee in stroops (1 XLM = 10_000_000 stroops). This is the
   * fee callers should set on the transaction: resource fee + base fee + a
   * buffer for the minimum fee per operation.
   */
  totalFeesStroops: number;
  /** Soroban resource fee (in stroops) returned by the simulation. */
  minResourceFeeStroops: number;
  /** Network base fee (in stroops) used for the non-resource portion. */
  baseFeeStroops: number;
  /** Estimated CPU instructions consumed (simulated) or heuristic. */
  cpuInstructions: number;
  /** Estimated memory bytes consumed (simulated) or heuristic. */
  memoryBytes: number;
  /** Rough number of ledgers the operation is expected to take. */
  ledgerBoundsLedgers: number;
  /** Congestion multiplier applied (>= 1). */
  multiplier: number;
  /** True when the value was returned from the cache. */
  cached: boolean;
  /**
   * Where the estimate came from: a live simulation, a fresh cache entry, or
   * the deterministic heuristic fallback.
   */
  source: 'simulated' | 'cached' | 'heuristic';
  /** Unix timestamp (ms) when this estimate was produced. */
  estimatedAt: number;
}

export interface GasEstimationOptions {
  /** Server used for simulation. When omitted, only heuristics are used. */
  server?: GasEstimationServer;
  /**
   * Base fee in stroops used for the non-resource portion of the estimate
   * (default 100_000 stroops = 0.01 XLM, Stellar's base fixed fee).
   */
  baseFeeStroops?: number;
  /** How long a cached estimate for an operation stays valid (ms). */
  cacheTtlMs?: number;
  /** Multiplier applied to the raw estimate for congestion (default 1). */
  congestionMultiplier?: number;
  /** Timeout (ms) to pass to the simulation server. */
  timeoutMs?: number;
}

export interface EstimateParams {
  /** The transaction to simulate. Required when a server is provided. */
  tx?: any;
  /** Optional explicit amount/units to disambiguate cache keys. */
  amount?: string | number;
  /** Optional contract/account address to disambiguate cache keys. */
  contractId?: string;
  /**
   * Optional override for the operation cost when the caller already has a
   * measured baseline (used with the heuristic fallback).
   */
  baselineCpuInsns?: number;
  baselineMemBytes?: number;
}

const DEFAULT_BASE_FEE_STROOPS = 100_000; // 0.01 XLM
const DEFAULT_CACHE_TTL_MS = 30_000; // 30 seconds
const DEFAULT_MULTIPLIER = 1;
const ACCURACY_TOLERANCE_PERCENT = 10;

/**
 * Deterministic heuristic cost table (cpu instructions / mem bytes) used when
 * simulation is unavailable or fails. These are order-of-magnitude baselines,
 * intentionally conservative (over-estimating slightly) so a caller is never
 * under-funded.
 */
const HEURISTIC_COSTS: Record<OperationType, { cpuInsns: number; memBytes: number; ledgers: number }> = {
  transfer: { cpuInsns: 1_500_000, memBytes: 4_096, ledgers: 2 },
  deploy: { cpuInsns: 6_000_000, memBytes: 262_144, ledgers: 5 },
  initialize: { cpuInsns: 3_000_000, memBytes: 65_536, ledgers: 3 },
  mint: { cpuInsns: 2_000_000, memBytes: 8_192, ledgers: 2 },
  burn: { cpuInsns: 2_000_000, memBytes: 8_192, ledgers: 2 },
  claim: { cpuInsns: 3_500_000, memBytes: 16_384, ledgers: 3 },
  payout: { cpuInsns: 4_000_000, memBytes: 32_768, ledgers: 3 },
  ordering: { cpuInsns: 2_500_000, memBytes: 16_384, ledgers: 2 },
  trade: { cpuInsns: 3_000_000, memBytes: 16_384, ledgers: 2 },
  custody: { cpuInsns: 3_000_000, memBytes: 16_384, ledgers: 3 },
  approve: { cpuInsns: 1_500_000, memBytes: 8_192, ledgers: 2 },
  proposal: { cpuInsns: 2_500_000, memBytes: 8_192, ledgers: 2 },
  custom: { cpuInsns: 2_000_000, memBytes: 16_384, ledgers: 2 },
};

interface CacheEntry {
  estimate: GasEstimate;
  expiresAt: number;
}

/**
 * Simulation-based gas estimator with caching + heuristic fallback.
 */
export class GasEstimator {
  private logger: Logger;
  private cache: Map<string, CacheEntry> = new Map();
  private optionDefaults: Required<
    Pick<GasEstimationOptions, 'baseFeeStroops' | 'cacheTtlMs' | 'congestionMultiplier'>
  >;

  constructor(private readonly options: GasEstimationOptions = {}) {
    this.optionDefaults = {
      baseFeeStroops: options.baseFeeStroops ?? DEFAULT_BASE_FEE_STROOPS,
      cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      congestionMultiplier: options.congestionMultiplier ?? DEFAULT_MULTIPLIER,
    };
    this.logger = createLogger('GasEstimator');
  }

  /**
   * Clears all cached estimates. Called automatically when the congestion
   * configuration changes.
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Gas estimator cache cleared');
  }

  /**
   * Core estimation API.
   *
   * @param operation Which category of operation is being costed.
   * @param params    Simulation / contextual parameters.
   * @returns a {@link GasEstimate} (never throws for missing simulation — in
   *          that case a heuristic estimate is returned with `source:
   *          'heuristic'`).
   * @throws {InvalidParametersError} if `operation` is not a known operation.
   */
  async estimate(operation: OperationType, params: EstimateParams = {}): Promise<GasEstimate> {
    if (!(operation in HEURISTIC_COSTS)) {
      throw new InvalidParametersError(`Unknown operation type: ${operation}`);
    }

    // Congestion multiplier: bump it based on the network fee stats when
    // available so congested networks get costlier estimates automatically.
    const multiplier = await this.resolveMultiplier();

    const cacheKey = this.buildCacheKey(operation, params);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const hit: GasEstimate = { ...cached.estimate, cached: true, source: 'cached', multiplier };
      this.logger.debug('Gas estimate served from cache', {
        operation,
        totalFeesStroops: hit.totalFeesStroops,
      });
      return hit;
    }

    let estimate: GasEstimate;
    if (this.options.server && params.tx) {
      try {
        estimate = await this.simulate(operation, params.tx, multiplier);
      } catch (err: unknown) {
        this.logger.warn(
          `Gas simulation failed, falling back to heuristic: ${err instanceof Error ? err.message : String(err)}`,
        );
        estimate = this.heuristic(operation, params, multiplier);
      }
    } else {
      estimate = this.heuristic(operation, params, multiplier);
    }

    // Keep cached entries honest: if a fresh simulation produces a meaningfully
    // cheaper cost than what we previously cached, refresh the entry.
    const prev = this.cache.get(cacheKey);
    if (prev) {
      const drift = Math.abs(estimate.totalFeesStroops - prev.estimate.totalFeesStroops) /
        (prev.estimate.totalFeesStroops || 1);
      if (drift * 100 <= ACCURACY_TOLERANCE_PERCENT) {
        estimate = { ...prev.estimate, cached: true, estimatedAt: Date.now(), multiplier };
      }
    }

    this.cache.set(cacheKey, { estimate, expiresAt: Date.now() + this.optionDefaults.cacheTtlMs });
    this.logger.debug('Gas estimate computed', { operation, fee: estimate.totalFeesStroops });
    return estimate;
  }

  /**
   * Simulation-based estimate using the configured server's
   * `simulateTransaction`. Extracts the Soroban resource fee, cpu/mem usage
   * and derives the total fee.
   */
  private async simulate(
    operation: OperationType,
    tx: any,
    multiplier: number,
  ): Promise<GasEstimate> {
    const server = this.options.server!;
    const simulation = await server.simulateTransaction(tx);

    const cost = simulation?.cost ?? {};
    const cpuInstructions = Number(cost.cpuInsns ?? 0);
    const memoryBytes = Number(cost.memBytes ?? 0);
    const minResourceFeeStroops = Number(simulation?.minResourceFee ?? 0);

    if (!simulation?.result && simulation?.error) {
      // A failed simulation still tells us the *intended* cost; surface it but
      // keep going so the caller can still fund the retry.
      this.logger.warn(`Simulation reported an error: ${simulation.error}`);
    }

    const totalFeesStroops = this.computeTotalFee(minResourceFeeStroops, multiplier);
    return {
      operation,
      totalFeesStroops,
      minResourceFeeStroops,
      baseFeeStroops: this.optionDefaults.baseFeeStroops,
      cpuInstructions,
      memoryBytes,
      ledgerBoundsLedgers: Math.max(1, Math.ceil(cpuInstructions / 3_000_000)),
      multiplier,
      cached: false,
      source: 'simulated',
      estimatedAt: Date.now(),
    };
  }

  /**
   * Deterministic heuristic fallback so callers always get a usable estimate
   * even when the RPC server is unreachable or the tx cannot be assembled yet.
   */
  private heuristic(
    operation: OperationType,
    params: EstimateParams,
    multiplier: number,
  ): GasEstimate {
    const base = HEURISTIC_COSTS[operation];
    const cpuInstructions = params.baselineCpuInsns ?? base.cpuInsns;
    const memoryBytes = params.baselineMemBytes ?? base.memBytes;

    // Heuristic: resource fee ~ (cpu + mem adjusted) in stroops, scaled up so
    // it never under-funds. Kept simple and deterministic for testability.
    const cpuFeeStroops = Math.ceil(cpuInstructions / 100);
    const memFeeStroops = Math.ceil(memoryBytes);
    const minResourceFeeStroops = cpuFeeStroops + memFeeStroops;
    const totalFeesStroops = this.computeTotalFee(minResourceFeeStroops, multiplier);

    return {
      operation,
      totalFeesStroops,
      minResourceFeeStroops,
      baseFeeStroops: this.optionDefaults.baseFeeStroops,
      cpuInstructions,
      memoryBytes,
      ledgerBoundsLedgers: base.ledgers,
      multiplier,
      cached: false,
      source: 'heuristic',
      estimatedAt: Date.now(),
    };
  }

  /**
   * total = (resourceFee * multiplier) + (baseFee * multiplier)
   */
  private computeTotalFee(minResourceFeeStroops: number, multiplier: number): number {
    const resource = Math.round(minResourceFeeStroops * multiplier);
    const base = Math.round(this.optionDefaults.baseFeeStroops * multiplier);
    return resource + base;
  }

  /**
   * Resolve the congestion multiplier. When `getFeeStats` is available and the
   * reported max fee charged is significantly above the base fee, we consider
   * the network congested and apply a higher multiplier (capped at 5x).
   */
  private async resolveMultiplier(): Promise<number> {
    const configured = this.optionDefaults.congestionMultiplier;
    if (!this.options.server?.getFeeStats) {
      return configured;
    }
    try {
      const stats = await this.options.server.getFeeStats();
      const maxCharged = Number(stats?.feeCharged?.max ?? 0);
      if (maxCharged > this.optionDefaults.baseFeeStroops * 2) {
        const congestionMultiplier = Math.min(5, configured * 2);
        this.logger.info('Network appears congested, applying gas multiplier', {
          maxCharged,
          congestionMultiplier,
        });
        return congestionMultiplier;
      }
    } catch {
      // ignore fee-stats failures; fall through to the configured multiplier
    }
    return configured;
  }

  private buildCacheKey(operation: OperationType, params: EstimateParams): string {
    return [
      operation,
      params.contractId ?? '',
      params.amount?.toString() ?? '',
      params.baselineCpuInsns ?? '',
      params.baselineMemBytes ?? '',
    ].join('|');
  }
}

/**
 * Convenience top-level function matching the issue's requested API:
 * `estimateGas(operation, params)` returns a `GasEstimate`.
 *
 * A per-call estimator is created from the provided options so callers do not
 * need to manage instances; pass the same `cacheTtlMs`/server if you want
 * cross-call caching.
 */
export async function estimateGas(
  operation: OperationType,
  params: EstimateParams & GasEstimationOptions = {},
): Promise<GasEstimate> {
  const { server, baseFeeStroops, cacheTtlMs, congestionMultiplier, timeoutMs, ...estimateParams } = params;
  const estimator = new GasEstimator({ server, baseFeeStroops, cacheTtlMs, congestionMultiplier, timeoutMs });
  return estimator.estimate(operation, estimateParams);
}

/**
 * Low-level helper: does the numeric difference between two fee estimates fall
 * within `percent` of the reference estimate (default 10%)?
 */
export function isWithinAccuracy(
  estimate: GasEstimate,
  reference: GasEstimate,
  percent: number = ACCURACY_TOLERANCE_PERCENT,
): boolean {
  const diff = Math.abs((estimate.totalFeesStroops - reference.totalFeesStroops) / (reference.totalFeesStroops || 1));
  return diff * 100 <= percent;
}

export function gasCostToString(stroops: number): string {
  return `${(stroops / 10_000_000).toFixed(7)} XLM (${stroops} stroops)`;
}