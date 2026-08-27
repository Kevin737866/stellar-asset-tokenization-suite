/**
 * Unit tests for validation functions.
 * Issue #220: SDK unit tests achieving 80%+ code coverage.
 */

import {
  validateAddress,
  validateAmount,
  validateNonEmptyString,
  validatePositiveInteger,
  validateNonNegativeInteger,
  validateRange,
  validateServerUrl,
  validateContractId,
  validateBoolean,
  validateEnum
} from '../validation';
import { InvalidParametersError } from '../errors';

describe('validateAddress', () => {
  const validAddress = 'GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG';

  it('accepts a valid Stellar address string', () => {
    expect(() => validateAddress(validAddress, 'test')).not.toThrow();
  });

  it('accepts a valid Stellar address with object toString', () => {
    const addrObj = { toString: () => validAddress };
    expect(() => validateAddress(addrObj, 'test')).not.toThrow();
  });

  it('throws InvalidParametersError for null', () => {
    expect(() => validateAddress(null, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws InvalidParametersError for undefined', () => {
    expect(() => validateAddress(undefined, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for invalid format', () => {
    expect(() => validateAddress('not-an-address', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for empty string', () => {
    expect(() => validateAddress('', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for object without valid toString', () => {
    const obj = { toString: () => 'invalid' };
    expect(() => validateAddress(obj, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for non-string non-object types', () => {
    expect(() => validateAddress(42 as any, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('includes parameter name in error message', () => {
    try {
      validateAddress(null, 'myParam');
    } catch (e: any) {
      expect(e.message).toContain('myParam');
    }
  });
});

describe('validateAmount', () => {
  it('accepts a positive numeric string', () => {
    expect(() => validateAmount('100', 'test')).not.toThrow();
  });

  it('accepts a decimal string', () => {
    expect(() => validateAmount('100.50', 'test')).not.toThrow();
  });

  it('accepts a positive number', () => {
    expect(() => validateAmount(100, 'test')).not.toThrow();
  });

  it('accepts a positive bigint', () => {
    expect(() => validateAmount(100n, 'test')).not.toThrow();
  });

  it('throws for null', () => {
    expect(() => validateAmount(null, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for zero as string', () => {
    expect(() => validateAmount('0', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for zero as number', () => {
    expect(() => validateAmount(0, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for zero as bigint', () => {
    expect(() => validateAmount(0n, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for negative string', () => {
    expect(() => validateAmount('-100', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for negative number', () => {
    expect(() => validateAmount(-50, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for NaN', () => {
    expect(() => validateAmount(NaN, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for Infinity', () => {
    expect(() => validateAmount(Infinity, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for non-numeric string', () => {
    expect(() => validateAmount('abc', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for array', () => {
    expect(() => validateAmount([] as any, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for empty string', () => {
    expect(() => validateAmount('', 'test'))
      .toThrow(InvalidParametersError);
  });
});

describe('validateNonEmptyString', () => {
  it('accepts a non-empty string', () => {
    expect(() => validateNonEmptyString('hello', 'test')).not.toThrow();
  });

  it('throws for null', () => {
    expect(() => validateNonEmptyString(null, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for empty string', () => {
    expect(() => validateNonEmptyString('', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for whitespace-only string', () => {
    expect(() => validateNonEmptyString('   ', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for non-string types', () => {
    expect(() => validateNonEmptyString(42 as any, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for string exceeding maxLength', () => {
    const longString = 'a'.repeat(300);
    expect(() => validateNonEmptyString(longString, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('accepts string within maxLength', () => {
    const string = 'a'.repeat(100);
    expect(() => validateNonEmptyString(string, 'test', 150)).not.toThrow();
  });
});

describe('validatePositiveInteger', () => {
  it('accepts a positive integer', () => {
    expect(() => validatePositiveInteger(42, 'test')).not.toThrow();
  });

  it('throws for null', () => {
    expect(() => validatePositiveInteger(null, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for zero', () => {
    expect(() => validatePositiveInteger(0, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for negative', () => {
    expect(() => validatePositiveInteger(-1, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for float', () => {
    expect(() => validatePositiveInteger(3.14, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for string', () => {
    expect(() => validatePositiveInteger('5' as any, 'test'))
      .toThrow(InvalidParametersError);
  });
});

describe('validateNonNegativeInteger', () => {
  it('accepts zero', () => {
    expect(() => validateNonNegativeInteger(0, 'test')).not.toThrow();
  });

  it('accepts a positive integer', () => {
    expect(() => validateNonNegativeInteger(42, 'test')).not.toThrow();
  });

  it('throws for negative', () => {
    expect(() => validateNonNegativeInteger(-1, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for float', () => {
    expect(() => validateNonNegativeInteger(1.5, 'test'))
      .toThrow(InvalidParametersError);
  });
});

describe('validateRange', () => {
  it('accepts a value within range', () => {
    expect(() => validateRange(50, 0, 100, 'test')).not.toThrow();
  });

  it('accepts a value at min boundary', () => {
    expect(() => validateRange(0, 0, 100, 'test')).not.toThrow();
  });

  it('accepts a value at max boundary', () => {
    expect(() => validateRange(100, 0, 100, 'test')).not.toThrow();
  });

  it('throws for value below min', () => {
    expect(() => validateRange(-1, 0, 100, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for value above max', () => {
    expect(() => validateRange(101, 0, 100, 'test'))
      .toThrow(InvalidParametersError);
  });
});

describe('validateServerUrl', () => {
  it('accepts a valid URL', () => {
    expect(() => validateServerUrl('https://horizon-testnet.stellar.org', 'test'))
      .not.toThrow();
  });

  it('accepts a localhost URL', () => {
    expect(() => validateServerUrl('http://localhost:8000', 'test'))
      .not.toThrow();
  });

  it('throws for null', () => {
    expect(() => validateServerUrl(null, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for empty string', () => {
    expect(() => validateServerUrl('', 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for invalid URL format', () => {
    expect(() => validateServerUrl('not-a-url', 'test'))
      .toThrow(InvalidParametersError);
  });
});

describe('validateContractId', () => {
  it('accepts a valid contract ID', () => {
    expect(() => validateContractId('CA3D5K2AZ5HUVLWWPQJ6TAGQFQ2SBWZWOWLHGW4UMDBFTRHTO6MCGZTL', 'test'))
      .not.toThrow();
  });

  it('throws for null', () => {
    expect(() => validateContractId(null, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for non-string', () => {
    expect(() => validateContractId(123 as any, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for invalid format', () => {
    expect(() => validateContractId('invalid', 'test'))
      .toThrow(InvalidParametersError);
  });
});

describe('validateBoolean', () => {
  it('accepts true', () => {
    expect(() => validateBoolean(true, 'test')).not.toThrow();
  });

  it('accepts false', () => {
    expect(() => validateBoolean(false, 'test')).not.toThrow();
  });

  it('throws for string "true"', () => {
    expect(() => validateBoolean('true' as any, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for number 1', () => {
    expect(() => validateBoolean(1 as any, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for null', () => {
    expect(() => validateBoolean(null as any, 'test'))
      .toThrow(InvalidParametersError);
  });
});

describe('validateEnum', () => {
  const Colors = { RED: 'red', GREEN: 'green', BLUE: 'blue' } as const;

  it('accepts a valid enum value', () => {
    expect(() => validateEnum('red', Colors, 'test')).not.toThrow();
  });

  it('throws for invalid enum value', () => {
    expect(() => validateEnum('purple', Colors, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('throws for null', () => {
    expect(() => validateEnum(null, Colors, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('includes valid options in error message', () => {
    try {
      validateEnum('purple', Colors, 'color');
    } catch (e: any) {
      expect(e.message).toContain('red');
      expect(e.message).toContain('green');
      expect(e.message).toContain('blue');
    }
  });
});

// ─── edge cases & branch coverage ──────────────────────────────────────────

describe('validation edge cases (90%+ branch coverage)', () => {
  it('validateAddress handles object with toString that returns valid address', () => {
    const obj = { toString: () => 'GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG' };
    expect(() => validateAddress(obj, 'test')).not.toThrow();
  });

  it('validateAddress throws for object without toString', () => {
    const obj = { something: 'else' } as any;
    expect(() => validateAddress(obj, 'test')).toThrow(InvalidParametersError);
  });

  it('validateAmount handles large bigint', () => {
    expect(() => validateAmount(BigInt('9999999999999999999999999999'), 'test'))
      .not.toThrow();
  });

  it('validateAmount handles string with large number', () => {
    expect(() => validateAmount('999999999999999999.999999', 'test'))
      .not.toThrow();
  });

  it('validateNonEmptyString default maxLength is 256', () => {
    const str = 'a'.repeat(256);
    expect(() => validateNonEmptyString(str, 'test')).not.toThrow();
  });

  it('validateNonEmptyString over default maxLength throws', () => {
    const str = 'a'.repeat(257);
    expect(() => validateNonEmptyString(str, 'test')).toThrow(InvalidParametersError);
  });

  it('validatePositiveInteger throws for bigint', () => {
    expect(() => validatePositiveInteger(BigInt(5) as any, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('validateNonNegativeInteger throws for null', () => {
    expect(() => validateNonNegativeInteger(null, 'test'))
      .toThrow(InvalidParametersError);
  });

  it('validateRange handles edge boundaries', () => {
    expect(() => validateRange(0, 0, 0, 'zero')).not.toThrow();
    expect(() => validateRange(-0, 0, 0, 'zero')).not.toThrow();
  });
});
