import {
  DEFAULT_FEE_STRATEGY,
  DEFAULT_MAX_FEE_STROOPS,
  FeeStrategyError,
  STELLAR_MAX_PROTOCOL_FEE_STROOPS,
  STELLAR_MIN_BASE_FEE_STROOPS,
  resolveTransactionFee,
  validateFeeStrategy,
} from '../feeStrategy';

describe('Configurable fee strategy with safe protocol bounds', () => {
  describe('validateFeeStrategy', () => {
    it('normalizes valid dynamic, fixed, and custom strategies', () => {
      const dynamic = validateFeeStrategy({ mode: 'dynamic', multiplier: 1.5 });
      expect(dynamic.minFeeStroops).toBe(STELLAR_MIN_BASE_FEE_STROOPS);
      expect(dynamic.maxFeeStroops).toBe(DEFAULT_MAX_FEE_STROOPS);
      expect(dynamic.clampToBounds).toBe(false);

      const fixed = validateFeeStrategy({ mode: 'fixed', fixedFeeStroops: 5000 });
      expect(fixed.fixedFeeStroops).toBe(5000);

      const custom = validateFeeStrategy({
        mode: 'custom',
        resolver: ({ operationCount }) => operationCount * 250,
      });
      expect(typeof custom.resolver).toBe('function');
    });

    it('rejects invalid mode, bounds, and mode-specific parameters', () => {
      expect(() => validateFeeStrategy({ mode: 'invalid' as any })).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'dynamic', minFeeStroops: STELLAR_MIN_BASE_FEE_STROOPS - 1 })
      ).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'dynamic', maxFeeStroops: STELLAR_MAX_PROTOCOL_FEE_STROOPS + 1 })
      ).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'dynamic', minFeeStroops: 5000, maxFeeStroops: 1000 })
      ).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'dynamic', multiplier: 0 })
      ).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'dynamic', multiplier: Number.NaN })
      ).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'fixed' })
      ).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'fixed', fixedFeeStroops: 50_000_000, maxFeeStroops: 10_000_000 })
      ).toThrow(FeeStrategyError);
      expect(() =>
        validateFeeStrategy({ mode: 'custom' })
      ).toThrow(FeeStrategyError);
    });
  });

  describe('resolveTransactionFee', () => {
    it('resolves dynamic fees from estimatedFeeStroops or baseFeeStroops * operationCount', () => {
      const fromEstimate = resolveTransactionFee(
        { mode: 'dynamic', multiplier: 1.5 },
        { operationCount: 2, estimatedFeeStroops: 1200 },
      );
      expect(fromEstimate).toEqual({
        feeStroops: 1800,
        mode: 'dynamic',
        clamped: false,
        bounds: {
          minFeeStroops: 200,
          maxFeeStroops: DEFAULT_MAX_FEE_STROOPS,
        },
      });

      const fromBase = resolveTransactionFee(
        { mode: 'dynamic', baseFeeStroops: 200, multiplier: 2 },
        { operationCount: 3 },
      );
      expect(fromBase.feeStroops).toBe(1200);
      expect(fromBase.bounds.minFeeStroops).toBe(300);
    });

    it('resolves fixed and custom strategies and honors overrideFeeStroops within bounds', () => {
      const fixed = resolveTransactionFee(
        { mode: 'fixed', fixedFeeStroops: 2500 },
        { operationCount: 5 },
      );
      expect(fixed.feeStroops).toBe(2500);
      expect(fixed.clamped).toBe(false);

      const custom = resolveTransactionFee(
        { mode: 'custom', resolver: ({ operationCount }) => operationCount * 333.3 },
        { operationCount: 3 },
      );
      expect(custom.feeStroops).toBe(1000);

      const override = resolveTransactionFee(
        DEFAULT_FEE_STRATEGY,
        { operationCount: 1, estimatedFeeStroops: 1100, overrideFeeStroops: 4000 },
      );
      expect(override.feeStroops).toBe(4000);
    });

    it('throws when resolved fee violates protocol bounds and clampToBounds is false', () => {
      expect(() =>
        resolveTransactionFee(
          { mode: 'dynamic', multiplier: 1, maxFeeStroops: 500 },
          { operationCount: 1, estimatedFeeStroops: 1000 },
        )
      ).toThrow(FeeStrategyError);

      expect(() =>
        resolveTransactionFee(
          { mode: 'fixed', fixedFeeStroops: 200 },
          { operationCount: 5 },
        )
      ).toThrow(FeeStrategyError);

      expect(() =>
        resolveTransactionFee(
          { mode: 'custom', resolver: () => Number.POSITIVE_INFINITY },
          { operationCount: 1 },
        )
      ).toThrow(FeeStrategyError);
    });

    it('clamps out-of-bounds fees when clampToBounds is true', () => {
      const clampedHigh = resolveTransactionFee(
        { mode: 'dynamic', multiplier: 10, maxFeeStroops: 2000, clampToBounds: true },
        { operationCount: 1, estimatedFeeStroops: 1000 },
      );
      expect(clampedHigh.feeStroops).toBe(2000);
      expect(clampedHigh.clamped).toBe(true);

      const clampedLow = resolveTransactionFee(
        { mode: 'fixed', fixedFeeStroops: 150, maxFeeStroops: 2000, clampToBounds: true },
        { operationCount: 5 },
      );
      expect(clampedLow.feeStroops).toBe(500);
      expect(clampedLow.clamped).toBe(true);
    });

    it('rejects invalid context and impossible protocol bounds', () => {
      expect(() =>
        resolveTransactionFee(DEFAULT_FEE_STRATEGY, { operationCount: 0 })
      ).toThrow(FeeStrategyError);

      expect(() =>
        resolveTransactionFee(
          { mode: 'dynamic', maxFeeStroops: 200 },
          { operationCount: 5 },
        )
      ).toThrow(FeeStrategyError);
    });
  });
});
