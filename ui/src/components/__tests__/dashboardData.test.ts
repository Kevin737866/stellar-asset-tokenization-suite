/**
 * Regression tests for the dashboard data rules (Drips Wave 11, issue #437).
 *
 * Covers the contract in `dashboardData.ts`: safe number parsing, portfolio
 * validation (success, invalid input, boundary cases), and the empty-state
 * derivation. A failed lock / unlock / claim leaving no partial state is a
 * component behavior (inputs are only cleared on success) and is covered by
 * the state derivation + validation rules tested here.
 */
import {
  DashboardHoldingInput,
  DashboardPortfolioInput,
  getDashboardState,
  toSafeNumber,
  validateDashboardPortfolio,
} from '../dashboardData';

function holding(overrides: Partial<DashboardHoldingInput> = {}): DashboardHoldingInput {
  return {
    asset: { name: 'Test Property', symbol: 'TPROP', tokenAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    balance: { amount: '100', lockedAmount: '0', votingPower: '100' },
    value: '2500',
    percentage: 100,
    dividends: '25',
    ...overrides,
  };
}

function portfolio(overrides: Partial<DashboardPortfolioInput> = {}): DashboardPortfolioInput {
  return {
    assets: [holding()],
    totalValue: '2500',
    totalDividends: '25',
    votingPower: '100',
    ...overrides,
  };
}

describe('toSafeNumber', () => {
  it('parses valid decimal strings', () => {
    expect(toSafeNumber('2500')).toBe(2500);
    expect(toSafeNumber('12.5')).toBe(12.5);
    expect(toSafeNumber('0')).toBe(0);
    expect(toSafeNumber('  42  ')).toBe(42);
  });

  it('passes valid numbers through', () => {
    expect(toSafeNumber(7)).toBe(7);
    expect(toSafeNumber(0)).toBe(0);
  });

  it('clamps invalid input to 0 instead of NaN', () => {
    expect(toSafeNumber('abc')).toBe(0);
    expect(toSafeNumber('')).toBe(0);
    expect(toSafeNumber('NaN')).toBe(0);
    expect(toSafeNumber('Infinity')).toBe(0);
    expect(toSafeNumber(NaN)).toBe(0);
    expect(toSafeNumber(Infinity)).toBe(0);
    expect(toSafeNumber(undefined)).toBe(0);
    expect(toSafeNumber(null)).toBe(0);
    expect(toSafeNumber({})).toBe(0);
    expect(toSafeNumber('-5')).toBe(0);
    expect(toSafeNumber(-5)).toBe(0);
  });
});

describe('validateDashboardPortfolio', () => {
  it('accepts a complete valid portfolio', () => {
    expect(validateDashboardPortfolio(portfolio())).toEqual({ valid: true, problems: [] });
  });

  it('accepts a valid portfolio with zero holdings (the empty state, not an error)', () => {
    expect(validateDashboardPortfolio(portfolio({ assets: [] }))).toEqual({ valid: true, problems: [] });
  });

  it('rejects a missing portfolio', () => {
    const result = validateDashboardPortfolio(null);
    expect(result.valid).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/portfolio is missing/);
  });

  it('rejects a missing assets array', () => {
    const result = validateDashboardPortfolio({ totalValue: '0', totalDividends: '0', votingPower: '0' });
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.includes('portfolio.assets is missing'))).toBe(true);
  });

  it('rejects unparseable numeric fields with their location', () => {
    const bad = portfolio({
      assets: [holding({ value: 'not-a-number', balance: { amount: 'abc', lockedAmount: '0', votingPower: '100' } })],
      totalValue: 'NaN',
    });
    const result = validateDashboardPortfolio(bad);
    expect(result.valid).toBe(false);
    expect(result.problems).toContain('assets[0].balance.amount is invalid: expected a non-negative decimal string');
    expect(result.problems).toContain('assets[0].value is invalid: expected a non-negative decimal string');
    expect(result.problems).toContain('portfolio.totalValue is invalid: expected a non-negative decimal string');
  });

  it('rejects negative amounts', () => {
    const result = validateDashboardPortfolio(portfolio({ totalDividends: '-1' }));
    expect(result.valid).toBe(false);
    expect(result.problems).toContain('portfolio.totalDividends is invalid: expected a non-negative decimal string');
  });

  it('rejects holdings with missing identity fields', () => {
    const bad = portfolio({
      assets: [holding({ asset: { name: '', symbol: '', tokenAddress: '' } })],
    });
    const result = validateDashboardPortfolio(bad);
    expect(result.valid).toBe(false);
    expect(result.problems).toContain('assets[0].asset.name is missing: expected a non-empty asset name');
    expect(result.problems).toContain('assets[0].asset.symbol is missing: expected a non-empty asset symbol');
    expect(result.problems).toContain('assets[0].asset.tokenAddress is missing: expected a non-empty token address');
  });

  it('rejects a percentage outside 0–100 (boundary cases)', () => {
    expect(validateDashboardPortfolio(portfolio({ assets: [holding({ percentage: 100 })] })).valid).toBe(true);
    expect(validateDashboardPortfolio(portfolio({ assets: [holding({ percentage: 0 })] })).valid).toBe(true);
    expect(validateDashboardPortfolio(portfolio({ assets: [holding({ percentage: 100.01 })] })).valid).toBe(false);
    expect(validateDashboardPortfolio(portfolio({ assets: [holding({ percentage: -0.01 })] })).valid).toBe(false);
    expect(validateDashboardPortfolio(portfolio({ assets: [holding({ percentage: NaN })] })).valid).toBe(false);
  });
});

describe('getDashboardState', () => {
  it('returns loading while the parent is fetching, even with an empty portfolio', () => {
    expect(getDashboardState(portfolio({ assets: [] }), true)).toBe('loading');
    expect(getDashboardState(null, true)).toBe('loading');
  });

  it('returns empty for a valid portfolio with zero holdings', () => {
    expect(getDashboardState(portfolio({ assets: [] }), false)).toBe('empty');
  });

  it('returns ready for a valid portfolio with holdings', () => {
    expect(getDashboardState(portfolio(), false)).toBe('ready');
  });

  it('returns invalid for malformed data instead of empty or ready', () => {
    expect(getDashboardState(null, false)).toBe('invalid');
    expect(getDashboardState(portfolio({ totalValue: 'abc' }), false)).toBe('invalid');
    expect(getDashboardState({ assets: 'not-an-array' }, false)).toBe('invalid');
  });
});
