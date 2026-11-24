import { calculateOrderProceeds, formatQuoteAmount } from '../lib/orderProceeds';

describe('calculateOrderProceeds', () => {
  it('computes net proceeds for a sell order', () => {
    const preview = calculateOrderProceeds('sell', '2.5', '4', {
      baseFee: '100',
      tradingFee: '0.1',
      feeCurrency: 'XLM',
    });

    expect(preview).not.toBeNull();
    expect(preview?.grossValue).toBe('10');
    expect(preview?.tradingFee).toBe('0.1');
    expect(preview?.netProceeds).toBe('9.9');
    expect(preview?.totalCost).toBe('10.1');
    expect(preview?.networkFee).toBe('100');
    expect(preview?.feeCurrency).toBe('XLM');
    expect(preview?.feeEstimateAvailable).toBe(true);
  });

  it('computes the total cost for a buy order', () => {
    const preview = calculateOrderProceeds('buy', '1250.5', '2', {
      tradingFee: '2.5',
    });

    expect(preview?.totalCost).toBe('2503.5');
    expect(preview?.netProceeds).toBe('2498.5');
  });

  it('keeps decimal precision for fractional prices', () => {
    const preview = calculateOrderProceeds('sell', '0.1', '0.2', {
      tradingFee: '0',
    });

    expect(preview?.grossValue).toBe('0.02');
    expect(preview?.netProceeds).toBe('0.02');
  });

  it('returns null for missing, zero, negative or non-numeric inputs', () => {
    expect(calculateOrderProceeds('sell', '', '10', null)).toBeNull();
    expect(calculateOrderProceeds('sell', 'abc', '10', null)).toBeNull();
    expect(calculateOrderProceeds('sell', '0', '10', null)).toBeNull();
    expect(calculateOrderProceeds('sell', '-1', '10', null)).toBeNull();
    expect(calculateOrderProceeds('sell', '1e3', '10', null)).toBeNull();
    expect(calculateOrderProceeds('buy', '10', '', null)).toBeNull();
    expect(calculateOrderProceeds('buy', '10', '0', null)).toBeNull();
    expect(calculateOrderProceeds('buy', '10', '-5', null)).toBeNull();
  });

  it('falls back to zero fees when the estimate is unavailable', () => {
    const preview = calculateOrderProceeds('sell', '10', '3', null);

    expect(preview?.feeEstimateAvailable).toBe(false);
    expect(preview?.tradingFee).toBe('0');
    expect(preview?.netProceeds).toBe('30');
    expect(preview?.networkFee).toBe('0');
    expect(preview?.feeCurrency).toBe('XLM');
  });

  it('clamps net proceeds at zero when fees exceed the gross value', () => {
    const preview = calculateOrderProceeds('sell', '1', '1', {
      tradingFee: '5',
    });

    expect(preview?.grossValue).toBe('1');
    expect(preview?.netProceeds).toBe('0');
    expect(preview?.totalCost).toBe('6');
  });

  it('ignores malformed fee values instead of throwing', () => {
    const preview = calculateOrderProceeds('sell', '2', '2', {
      baseFee: 'not-a-fee',
      tradingFee: '-1',
      feeCurrency: '  ',
    });

    expect(preview?.feeEstimateAvailable).toBe(false);
    expect(preview?.tradingFee).toBe('0');
    expect(preview?.networkFee).toBe('0');
    expect(preview?.feeCurrency).toBe('XLM');
  });
});

describe('formatQuoteAmount', () => {
  it('formats amounts with two decimals and thousands separators', () => {
    expect(formatQuoteAmount('1234.5678')).toBe('1,234.57');
    expect(formatQuoteAmount('0')).toBe('0.00');
  });

  it('keeps extra precision for sub-cent amounts', () => {
    expect(formatQuoteAmount('0.00001234')).toBe('0.0000123');
  });

  it('returns the raw value when it cannot be parsed', () => {
    expect(formatQuoteAmount('n/a')).toBe('n/a');
  });
});
