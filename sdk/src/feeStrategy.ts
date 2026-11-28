/** Error thrown when a fee strategy configuration or resolved fee violates safe protocol bounds. */
export class FeeStrategyError extends Error {
  public readonly code = 'INVALID_PARAMETERS';

  constructor(message: string) {
    super(message);
    this.name = 'FeeStrategyError';
  }
}

/** Stellar protocol minimum base fee per operation (in stroops). */
export const STELLAR_MIN_BASE_FEE_STROOPS = 100;

/** Stellar XDR uint32 hard ceiling for a transaction fee (in stroops). */
export const STELLAR_MAX_PROTOCOL_FEE_STROOPS = 0xffffffff;

/** Safe default upper cap for SDK transaction fees (1 XLM = 10,000,000 stroops). */
export const DEFAULT_MAX_FEE_STROOPS = 10_000_000;

/** Supported fee calculation modes. */
export type FeeStrategyMode = 'fixed' | 'dynamic' | 'custom';

/** Runtime context supplied when resolving a transaction fee. */
export interface FeeStrategyContext {
  /** Number of operations in the transaction (must be a positive integer). */
  operationCount: number;
  /** Optional simulated/estimated fee in stroops (used by dynamic/custom modes). */
  estimatedFeeStroops?: number;
  /** Optional explicit per-call fee override in stroops (still validated against bounds). */
  overrideFeeStroops?: number;
}

/** Configuration for the SDK's transaction fee strategy. */
export interface FeeStrategyConfig {
  /** Fee resolution mode: `'fixed'`, `'dynamic'`, or `'custom'`. */
  mode: FeeStrategyMode;
  /** Required when `mode === 'fixed'`: exact fee in stroops. */
  fixedFeeStroops?: number;
  /** Base fee per operation in stroops for `'dynamic'` mode (default: 100). */
  baseFeeStroops?: number;
  /** Multiplier applied in `'dynamic'` mode (default: 1). */
  multiplier?: number;
  /** Minimum allowed fee in stroops (default: 100; cannot be below protocol minimum). */
  minFeeStroops?: number;
  /** Maximum allowed fee in stroops (default: 10,000,000; cannot exceed uint32 max). */
  maxFeeStroops?: number;
  /**
   * When `true`, computed fees outside `[effectiveMin, maxFeeStroops]` are clamped
   * into bounds instead of throwing {@link InvalidParametersError}. Default: `false`.
   */
  clampToBounds?: boolean;
  /** Required when `mode === 'custom'`: synchronous fee resolver returning stroops. */
  resolver?: (context: FeeStrategyContext) => number;
}

/** Result returned by {@link resolveTransactionFee}. */
export interface ResolvedFeeResult {
  /** Final fee in stroops guaranteed to be within safe protocol bounds. */
  feeStroops: number;
  /** Strategy mode used to compute the fee. */
  mode: FeeStrategyMode;
  /** `true` if the raw computed fee was clamped to fit within bounds. */
  clamped: boolean;
  /** Effective protocol bounds enforced for this resolution. */
  bounds: {
    minFeeStroops: number;
    maxFeeStroops: number;
  };
}

/** Default fee strategy using dynamic estimation with safe protocol bounds. */
export const DEFAULT_FEE_STRATEGY: Readonly<FeeStrategyConfig> = Object.freeze({
  mode: 'dynamic',
  baseFeeStroops: STELLAR_MIN_BASE_FEE_STROOPS,
  multiplier: 1,
  minFeeStroops: STELLAR_MIN_BASE_FEE_STROOPS,
  maxFeeStroops: DEFAULT_MAX_FEE_STROOPS,
  clampToBounds: false,
});

function assertSafePositiveInt(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new FeeStrategyError(`${fieldName} must be a positive integer`);
  }
  return value;
}

/**
 * Validate and normalize a {@link FeeStrategyConfig} against Stellar protocol bounds.
 *
 * @throws {InvalidParametersError} if any field is invalid or violates protocol bounds.
 */
export function validateFeeStrategy(strategy: FeeStrategyConfig): FeeStrategyConfig {
  if (!strategy || typeof strategy !== 'object') {
    throw new FeeStrategyError('feeStrategy must be an object');
  }

  const validModes: readonly FeeStrategyMode[] = ['fixed', 'dynamic', 'custom'];
  if (!validModes.includes(strategy.mode)) {
    throw new FeeStrategyError(
      `feeStrategy.mode must be one of: ${validModes.join(', ')}`
    );
  }

  const minFeeStroops = strategy.minFeeStroops ?? STELLAR_MIN_BASE_FEE_STROOPS;
  const maxFeeStroops = strategy.maxFeeStroops ?? DEFAULT_MAX_FEE_STROOPS;

  assertSafePositiveInt(minFeeStroops, 'feeStrategy.minFeeStroops');
  assertSafePositiveInt(maxFeeStroops, 'feeStrategy.maxFeeStroops');

  if (minFeeStroops < STELLAR_MIN_BASE_FEE_STROOPS) {
    throw new FeeStrategyError(
      `feeStrategy.minFeeStroops (${minFeeStroops}) cannot be below Stellar protocol minimum (${STELLAR_MIN_BASE_FEE_STROOPS})`
    );
  }
  if (maxFeeStroops > STELLAR_MAX_PROTOCOL_FEE_STROOPS) {
    throw new FeeStrategyError(
      `feeStrategy.maxFeeStroops (${maxFeeStroops}) cannot exceed Stellar protocol maximum (${STELLAR_MAX_PROTOCOL_FEE_STROOPS})`
    );
  }
  if (minFeeStroops > maxFeeStroops) {
    throw new FeeStrategyError(
      `feeStrategy.minFeeStroops (${minFeeStroops}) cannot exceed feeStrategy.maxFeeStroops (${maxFeeStroops})`
    );
  }

  if (strategy.clampToBounds !== undefined && typeof strategy.clampToBounds !== 'boolean') {
    throw new FeeStrategyError('feeStrategy.clampToBounds must be a boolean');
  }

  if (strategy.mode === 'fixed') {
    const fixed = assertSafePositiveInt(strategy.fixedFeeStroops, 'feeStrategy.fixedFeeStroops');
    if (!strategy.clampToBounds && (fixed < minFeeStroops || fixed > maxFeeStroops)) {
      throw new FeeStrategyError(
        `feeStrategy.fixedFeeStroops (${fixed}) must be within [${minFeeStroops}, ${maxFeeStroops}]`
      );
    }
  }

  if (strategy.mode === 'dynamic') {
    const baseFee = strategy.baseFeeStroops ?? STELLAR_MIN_BASE_FEE_STROOPS;
    assertSafePositiveInt(baseFee, 'feeStrategy.baseFeeStroops');
    if (baseFee < STELLAR_MIN_BASE_FEE_STROOPS) {
      throw new FeeStrategyError(
        `feeStrategy.baseFeeStroops (${baseFee}) cannot be below Stellar protocol minimum (${STELLAR_MIN_BASE_FEE_STROOPS})`
      );
    }
    const multiplier = strategy.multiplier ?? 1;
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
      throw new FeeStrategyError('feeStrategy.multiplier must be a finite positive number');
    }
  }

  if (strategy.mode === 'custom' && typeof strategy.resolver !== 'function') {
    throw new FeeStrategyError('feeStrategy.resolver must be a function when mode is "custom"');
  }

  return {
    ...strategy,
    baseFeeStroops: strategy.baseFeeStroops ?? STELLAR_MIN_BASE_FEE_STROOPS,
    multiplier: strategy.multiplier ?? 1,
    minFeeStroops,
    maxFeeStroops,
    clampToBounds: strategy.clampToBounds ?? false,
  };
}

/**
 * Resolve a transaction fee in stroops using the given {@link FeeStrategyConfig}
 * and enforce safe Stellar protocol bounds.
 *
 * @throws {InvalidParametersError} if the strategy, context, or resolved fee is invalid or out of bounds.
 */
export function resolveTransactionFee(
  strategy: FeeStrategyConfig,
  context: FeeStrategyContext,
): ResolvedFeeResult {
  const normalized = validateFeeStrategy(strategy);

  if (!context || typeof context !== 'object') {
    throw new FeeStrategyError('context must be an object');
  }
  const operationCount = assertSafePositiveInt(context.operationCount, 'context.operationCount');

  if (context.estimatedFeeStroops !== undefined) {
    assertSafePositiveInt(context.estimatedFeeStroops, 'context.estimatedFeeStroops');
  }
  if (context.overrideFeeStroops !== undefined) {
    assertSafePositiveInt(context.overrideFeeStroops, 'context.overrideFeeStroops');
  }

  const protocolMinForOps = operationCount * STELLAR_MIN_BASE_FEE_STROOPS;
  const effectiveMin = Math.max(normalized.minFeeStroops!, protocolMinForOps);
  const effectiveMax = normalized.maxFeeStroops!;

  if (effectiveMin > effectiveMax) {
    throw new FeeStrategyError(
      `Effective protocol minimum fee (${effectiveMin} stroops for ${operationCount} ops) exceeds maxFeeStroops (${effectiveMax})`
    );
  }

  let rawFee: number;
  if (context.overrideFeeStroops !== undefined) {
    rawFee = context.overrideFeeStroops;
  } else if (normalized.mode === 'fixed') {
    rawFee = normalized.fixedFeeStroops!;
  } else if (normalized.mode === 'dynamic') {
    const baseline = context.estimatedFeeStroops ?? (operationCount * normalized.baseFeeStroops!);
    rawFee = Math.ceil(baseline * normalized.multiplier!);
  } else {
    const customResult = normalized.resolver!(context);
    if (typeof customResult !== 'number' || !Number.isFinite(customResult) || customResult <= 0) {
      throw new FeeStrategyError('Custom fee resolver must return a finite positive number');
    }
    rawFee = Math.ceil(customResult);
  }

  let finalFee = rawFee;
  let clamped = false;

  if (rawFee < effectiveMin || rawFee > effectiveMax) {
    if (normalized.clampToBounds) {
      finalFee = Math.min(Math.max(rawFee, effectiveMin), effectiveMax);
      clamped = true;
    } else {
      throw new FeeStrategyError(
        `Resolved fee (${rawFee} stroops) is outside safe protocol bounds [${effectiveMin}, ${effectiveMax}]`
      );
    }
  }

  return {
    feeStroops: finalFee,
    mode: normalized.mode,
    clamped,
    bounds: {
      minFeeStroops: effectiveMin,
      maxFeeStroops: effectiveMax,
    },
  };
}
