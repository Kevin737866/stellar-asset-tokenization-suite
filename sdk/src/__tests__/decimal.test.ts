/**
 * Regression tests for exact decimal parsing (Issue #388).
 * No value in this file may be parsed through a JavaScript `number`.
 */

import {
  exactDecimalToScaled,
  formatExactDecimal,
  parseExactDecimal,
  parseExactScaledAmount,
  scaledToExactDecimal,
} from '../decimal';
import { InvalidParametersError } from '../errors';
import { safeParseAmount, validateAmount } from '../validation';

describe('parseExactDecimal', () => {
  it('parses whole and fractional decimals without rounding', () => {
    expect(parseExactDecimal('123.45')).toEqual({ unscaled: 12345n, scale: 2 });
    expect(parseExactDecimal('0.001')).toEqual({ unscaled: 1n, scale: 3 });
    expect(parseExactDecimal('7')).toEqual({ unscaled: 7n, scale: 0 });
  });

  it('preserves leading zeros, trailing zeros and signs', () => {
    expect(parseExactDecimal('0001.2300')).toEqual({ unscaled: 12300n, scale: 4 });
    expect(parseExactDecimal('-0.001')).toEqual({ unscaled: -1n, scale: 3 });
    expect(parseExactDecimal('+2.50')).toEqual({ unscaled: 250n, scale: 2 });
  });

  it('is exact beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = '9007199254740993.000000000000000001';
    const parsed = parseExactDecimal(huge);

    expect(parsed.unscaled).toBe(9007199254740993000000000000000001n);
    expect(formatExactDecimal(parsed)).toBe(huge);
    // A number-based parser loses precision here; the exact parser does not.
    expect(String(Number(huge))).not.toBe(huge);
    expect(formatExactDecimal(parsed)).toBe(huge);
  });

  it('does not underflow tiny positive decimals to zero', () => {
    const parsed = parseExactDecimal('0.0000000000000000000000000000000001');
    expect(parsed.unscaled).toBe(1n);
    expect(parsed.scale).toBe(34);
  });

  it('rejects excess fractional digits when maxScale is set', () => {
    expect(() => parseExactDecimal('1.234', { maxScale: 2 })).toThrow(InvalidParametersError);
    expect(() => parseExactDecimal('1.23', { maxScale: 2 })).not.toThrow();
  });

  it('honours sign restrictions', () => {
    expect(() => parseExactDecimal('-1', { allowNegative: false })).toThrow(InvalidParametersError);
    expect(() => parseExactDecimal('+1', { allowPositiveSign: false })).toThrow(InvalidParametersError);
  });

  it('rejects malformed input explicitly instead of coercing it', () => {
    const invalid: unknown[] = [null, undefined, 1, 1.5, 1n, '', '.5', '1.', '1e3', ' 1', '1 ', 'abc', '--1', 'NaN'];
    for (const value of invalid) {
      expect(() => parseExactDecimal(value as string)).toThrow(InvalidParametersError);
    }
  });

  it('rejects an invalid maxScale option', () => {
    expect(() => parseExactDecimal('1', { maxScale: -1 })).toThrow(InvalidParametersError);
    expect(() => parseExactDecimal('1', { maxScale: 1.5 })).toThrow(InvalidParametersError);
  });
});

describe('formatExactDecimal', () => {
  it('round-trips parsed values exactly', () => {
    for (const value of ['0', '1', '1.0', '1.2300', '-0.0000001', '123456789012345678901234567890.123']) {
      expect(formatExactDecimal(parseExactDecimal(value))).toBe(value);
    }
  });

  it('renders scaled integers with the requested precision', () => {
    expect(formatExactDecimal(scaledToExactDecimal(1n, 18))).toBe('0.000000000000000001');
    expect(formatExactDecimal(scaledToExactDecimal(-1500000000000000000n, 18))).toBe('-1.500000000000000000');
  });

  it('rejects malformed ExactDecimal objects', () => {
    expect(() => formatExactDecimal({ unscaled: '1' as any, scale: 0 })).toThrow(InvalidParametersError);
    expect(() => formatExactDecimal({ unscaled: 1n, scale: -1 })).toThrow(InvalidParametersError);
  });
});

describe('scaling helpers', () => {
  it('scales exact decimals to integer amounts', () => {
    expect(exactDecimalToScaled(parseExactDecimal('1.25'), 18)).toBe(1250000000000000000n);
    expect(exactDecimalToScaled(parseExactDecimal('0.000000000000000001'), 18)).toBe(1n);
    expect(parseExactScaledAmount('2.5', 6)).toBe(2500000n);
  });

  it('never silently truncates excess precision', () => {
    expect(() => exactDecimalToScaled(parseExactDecimal('1.123'), 2)).toThrow(InvalidParametersError);
    expect(() => parseExactScaledAmount('1.123', 2)).toThrow(InvalidParametersError);
  });

  it('rejects invalid scale options', () => {
    expect(() => exactDecimalToScaled(parseExactDecimal('1'), -1)).toThrow(InvalidParametersError);
    expect(() => scaledToExactDecimal(1n, 1.5)).toThrow(InvalidParametersError);
  });
});

describe('amount validation and legacy parsing', () => {
  it('validateAmount accepts tiny positive decimals that parseFloat would underflow', () => {
    expect(() => validateAmount('0.0000000000000000000000000000000001', 'amount')).not.toThrow();
  });

  it('validateAmount still rejects zero, negatives and malformed strings', () => {
    expect(() => validateAmount('0', 'amount')).toThrow(InvalidParametersError);
    expect(() => validateAmount('-1', 'amount')).toThrow(InvalidParametersError);
    expect(() => validateAmount('abc', 'amount')).toThrow(InvalidParametersError);
  });

  it('safeParseAmount keeps its 18-decimal truncation behaviour', () => {
    expect(safeParseAmount('1.1234567890123456789', 'amount')).toBe(1123456789012345678n);
  });
});
