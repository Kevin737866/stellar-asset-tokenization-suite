/**
 * Unit tests for the gas estimation utility (Issue #194).
 */

import {
  GasEstimator,
  estimateGas,
  isWithinAccuracy,
  gasCostToString,
  type GasEstimate,
  type GasEstimationServer,
} from '../gasEstimator';
import { InvalidParametersError } from '../errors';

// ── helpers ──────────────────────────────────────────────────────────────────

function mockServer(
  overrides: { result?: any; error?: string; cost?: { cpuInsns: string; memBytes: string } } = {},
): { server: GasEstimationServer; simulate: jest.Mock; feeStats: jest.Mock } {
  const simulate = jest.fn().mockResolvedValue({
    result: overrides.result ?? 'AAAA',
    error: overrides.error,
    cost: overrides.cost ?? { cpuInsns: '1500000', memBytes: '4096' },
    minResourceFee: '120000',
  });
  const feeStats = jest.fn().mockResolvedValue({ feeCharged: { max: '100000' } });
  const server: GasEstimationServer = {
    simulateTransaction: simulate,
    getFeeStats: feeStats,
  };
  return { server, simulate, feeStats };
}

// ── estimateGas ──────────────────────────────────────────────────────────────

describe('estimateGas', () => {
  it('returns a GasEstimate for a valid operation', async () => {
    const estimate = await estimateGas('transfer', {
      tx: { ops: [] },
      server: mockServer().server,
    });

    expect(estimate).toBeDefined();
    expect(estimate.operation).toBe('transfer');
    expect(estimate.cached).toBe(false);
    expect(estimate.source).toBe('simulated');
    expect(typeof estimate.totalFeesStroops).toBe('number');
    expect(estimate.totalFeesStroops).toBeGreaterThan(0);
  });

  it('throws InvalidParametersError for an unknown operation type', async () => {
    await expect(estimateGas('nonexistent' as any, {})).rejects.toThrow(
      InvalidParametersError,
    );
  });

  it('uses the heuristic fallback when no server/tx is provided', async () => {
    const estimate = await estimateGas('deploy', {});
    expect(estimate.source).toBe('heuristic');
    expect(estimate.totalFeesStroops).toBeGreaterThan(0);
  });
});

// ── GasEstimator: caching ────────────────────────────────────────────────────

describe('GasEstimator caching', () => {
  it('serves a second identical call from the cache', async () => {
    const { server, simulate } = mockServer();
    const estimator = new GasEstimator({ server });

    const first = await estimator.estimate('transfer', { tx: { ops: [] } });
    const second = await estimator.estimate('transfer', { tx: { ops: [] } });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.source).toBe('cached');
    expect(second.totalFeesStroops).toBe(first.totalFeesStroops);
    // Cache hit means the simulation ran only once.
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it('returns an estimate within 10% of a fresh simulation', async () => {
    const { server } = mockServer();
    const estimator = new GasEstimator({ server });

    const first = await estimator.estimate('claim', { tx: { ops: [] } });
    const second = await estimator.estimate('claim', { tx: { ops: [] } });

    expect(isWithinAccuracy(second, first)).toBe(true);
  });

  it('recomputes after the TTL expires', async () => {
    const { server, simulate } = mockServer();
    const estimator = new GasEstimator({ server, cacheTtlMs: 0 });

    await estimator.estimate('mint', { tx: { ops: [] } });
    await estimator.estimate('mint', { tx: { ops: [] } });

    expect(simulate).toHaveBeenCalledTimes(2);
  });

  it('disambiguates cache keys by contractId', async () => {
    const { server, simulate } = mockServer();
    const estimator = new GasEstimator({ server });

    await estimator.estimate('approve', {
      tx: { ops: [] },
      contractId: 'CAAA',
    });
    await estimator.estimate('approve', {
      tx: { ops: [] },
      contractId: 'CBBB',
    });

    expect(simulate).toHaveBeenCalledTimes(2);
  });
});

// ── GasEstimator: simulation failure fallback ────────────────────────────────

describe('GasEstimator simulation failure fallback', () => {
  it('falls back to a heuristic estimate when the simulation rejects', async () => {
    const server: GasEstimationServer = {
      simulateTransaction: jest.fn().mockRejectedValue(new Error('rpc down')),
    };
    const estimator = new GasEstimator({ server });

    const estimate = await estimator.estimate('trade', { tx: { ops: [] } });

    expect(estimate.source).toBe('heuristic');
    expect(estimate.cached).toBe(false);
    expect(estimate.totalFeesStroops).toBeGreaterThan(0);
    expect(estimate.operation).toBe('trade');
  });

  it('produces a usable estimate when the simulation returns an error flag', async () => {
    const server: GasEstimationServer = {
      simulateTransaction: jest.fn().mockResolvedValue({
        result: undefined,
        error: 'host error: tested',
        cost: { cpuInsns: '1200000', memBytes: '2048' },
        minResourceFee: '90000',
      }),
    };
    const estimator = new GasEstimator({ server });

    const estimate = await estimator.estimate('custom', { tx: { ops: [] } });

    expect(estimate.source).toBe('simulated');
    expect(estimate.totalFeesStroops).toBeGreaterThan(0);
    expect(estimate.cpuInstructions).toBe(1_200_000);
  });
});

// ── GasEstimator: congestion multiplier ──────────────────────────────────────

describe('GasEstimator congestion multiplier', () => {
  it('applies the configured multiplier to the estimate', async () => {
    const server: GasEstimationServer = {
      simulateTransaction: jest.fn().mockResolvedValue({
        result: 'AAAA',
        cost: { cpuInsns: '1500000', memBytes: '4096' },
        minResourceFee: '100000',
      }),
    };
    const base = new GasEstimator({ server, baseFeeStroops: 100_000 });
    const x2 = new GasEstimator({ server, baseFeeStroops: 100_000, congestionMultiplier: 2 });

    const baseEstimate = await base.estimate('transfer', { tx: { ops: [] } });
    const scaled = await x2.estimate('transfer', { tx: { ops: [] } });

    expect(scaled.totalFeesStroops).toBeCloseTo(baseEstimate.totalFeesStroops * 2);
    expect(scaled.multiplier).toBe(2);
  });

  it('detects a congested network from fee stats and scales the multiplier', async () => {
    const { server } = mockServer();
    const feeStats = jest.fn().mockResolvedValue({ feeCharged: { max: '900000' } });
    server.getFeeStats = feeStats;

    const estimator = new GasEstimator({ server, baseFeeStroops: 100_000 });
    const estimate = await estimator.estimate('transfer', {
      tx: { ops: [] },
    });

    // baseFee 100k, max charged 900k (> 2x) → multiplier doubled from 1 to 2.
    expect(estimate.multiplier).toBe(2);
    expect(feeStats).toHaveBeenCalled();
  });
});

// ── GasEstimator: heuristic costs ────────────────────────────────────────────

describe('GasEstimator heuristic costs', () => {
  it('produces deterministic estimates for every operation type', async () => {
    const estimator = new GasEstimator({});
    const ops = [
      'transfer', 'deploy', 'initialize', 'mint', 'burn', 'claim', 'payout',
      'ordering', 'trade', 'custody', 'approve', 'proposal', 'custom',
    ] as const;

    const estimates: GasEstimate[] = [];
    for (const op of ops) {
      const estimate = await estimator.estimate(op, { amount: '100' });
      expect(estimate.totalFeesStroops).toBeGreaterThan(0);
      expect(estimate.source).toBe('heuristic');
      estimates.push(estimate);
    }

    // A second pass over the same keyed params is served from cache and is
    // within 10% (exactly equal) of the first.
    for (let i = 0; i < ops.length; i++) {
      const again = await estimator.estimate(ops[i], { amount: '100' });
      expect(again.cached).toBe(true);
      expect(isWithinAccuracy(again, estimates[i])).toBe(true);
    }
  });
});

// ── gasCostToString ──────────────────────────────────────────────────────────

describe('gasCostToString', () => {
  it('formats stroops as an XLM amount', () => {
    expect(gasCostToString(100_000)).toBe('0.0100000 XLM (100000 stroops)');
  });
});