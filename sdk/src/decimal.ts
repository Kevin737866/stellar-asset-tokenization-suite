/**
 * Exact, lossless base-10 decimal parsing.
 *
 * JavaScript `number` values are IEEE-754 doubles: parsing a decimal string
 * with `Number()` / `parseFloat()` can round it (for example
 * `0.100000000000000005` becomes `0.1`, and very small values underflow to
 * `0`). Soroban amounts are integer i128 values, so any rounding at the SDK
 * boundary would silently change the value that is sent on-chain.
 *
 * The helpers in this module therefore operate only on strings and `bigint`;
 * no `number` conversion is performed at any point. Invalid input is rejected
 * explicitly instead of being coerced or truncated.
 */

import { DEFAULT_DECIMALS } from './constants';
import { InvalidParametersError } from './errors';

/** A base-10 decimal represented exactly as `unscaled * 10^-scale`. */
export interface ExactDecimal {
  /** Signed integer with the decimal point removed ("123.45" -> 12345n). */
  unscaled: bigint;
  /** Number of base-10 digits after the decimal point. */
  scale: number;
}

export interface ParseExactDecimalOptions {
  /** Field name used in error messages. Default: `value`. */
  name?: string;
  /** Accept a leading `-`. Default: `true`. */
  allowNegative?: boolean;
  /** Accept a leading `+`. Default: `true`. */
  allowPositiveSign?: boolean;
  /**
   * Reject decimals with more than this many fractional digits instead of
   * truncating them. Default: unlimited.
   */
  maxScale?: number;
}

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

function assertScaleOption(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidParametersError(`${name} must be a non-negative integer`);
  }
}

/**
 * Parse a decimal string into an {@link ExactDecimal}.
 *
 * Accepted grammar: `[+|-]<digits>[.<digits>]`. Leading zeros are allowed;
 * `.5`, `1.`, exponent notation, whitespace and non-string inputs are not.
 * The returned `unscaled` bigint keeps every supplied digit — nothing is
 * rounded, coerced or discarded.
 *
 * @throws {InvalidParametersError} for malformed input, disallowed signs, or
 *   a fractional part longer than `maxScale`.
 */
export function parseExactDecimal(
  value: string,
  options: ParseExactDecimalOptions = {}
): ExactDecimal {
  const name = options.name ?? 'value';

  if (typeof value !== 'string') {
    throw new InvalidParametersError(`Invalid ${name}: must be a decimal string`);
  }
  if (options.maxScale !== undefined) {
    assertScaleOption(options.maxScale, `${name} maxScale`);
  }

  const match = DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new InvalidParametersError(
      `Invalid ${name}: expected a base-10 decimal string (e.g. "123.45")`
    );
  }

  const [, sign, whole, fraction = ''] = match;
  if (sign === '-' && options.allowNegative === false) {
    throw new InvalidParametersError(`Invalid ${name}: must not be negative`);
  }
  if (sign === '+' && options.allowPositiveSign === false) {
    throw new InvalidParametersError(`Invalid ${name}: must not include a leading "+"`);
  }

  const scale = fraction.length;
  if (options.maxScale !== undefined && scale > options.maxScale) {
    throw new InvalidParametersError(
      `Invalid ${name}: ${scale} fractional digits exceed the maximum of ${options.maxScale}`
    );
  }

  // `BigInt` on a decimal digit string is exact for arbitrarily long inputs.
  const magnitude = BigInt(`${whole}${fraction}`);
  return { unscaled: sign === '-' ? -magnitude : magnitude, scale };
}

/**
 * Render an {@link ExactDecimal} back to its canonical decimal string.
 * Trailing zeros are preserved so the representation round-trips exactly.
 */
export function formatExactDecimal(value: ExactDecimal): string {
  if (!value || typeof value.unscaled !== 'bigint' || !Number.isInteger(value.scale) || value.scale < 0) {
    throw new InvalidParametersError('Invalid decimal: expected an ExactDecimal object');
  }

  const negative = value.unscaled < 0n;
  const digits = (negative ? -value.unscaled : value.unscaled).toString().padStart(value.scale + 1, '0');
  const sign = negative ? '-' : '';

  if (value.scale === 0) return `${sign}${digits}`;
  const splitAt = digits.length - value.scale;
  return `${sign}${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
}

/**
 * Scale an exact decimal to an integer with `decimals` fractional digits.
 *
 * This is the value that should be passed as a Soroban `i128` amount. A
 * decimal with more fractional digits than `decimals` is rejected rather than
 * silently truncated.
 */
export function exactDecimalToScaled(
  value: ExactDecimal,
  decimals: number = DEFAULT_DECIMALS,
  options: { name?: string } = {}
): bigint {
  const name = options.name ?? 'value';
  assertScaleOption(decimals, 'decimals');
  if (!value || typeof value.unscaled !== 'bigint' || !Number.isInteger(value.scale) || value.scale < 0) {
    throw new InvalidParametersError(`Invalid ${name}: expected an ExactDecimal object`);
  }
  if (value.scale > decimals) {
    throw new InvalidParametersError(
      `Invalid ${name}: ${value.scale} fractional digits exceed the target scale of ${decimals}`
    );
  }
  return value.unscaled * (10n ** BigInt(decimals - value.scale));
}

/** Build an {@link ExactDecimal} from an already-scaled integer amount. */
export function scaledToExactDecimal(
  unscaled: bigint,
  decimals: number = DEFAULT_DECIMALS,
  options: { name?: string } = {}
): ExactDecimal {
  const name = options.name ?? 'value';
  assertScaleOption(decimals, 'decimals');
  if (typeof unscaled !== 'bigint') {
    throw new InvalidParametersError(`Invalid ${name}: expected a bigint`);
  }
  return { unscaled, scale: decimals };
}

/**
 * Convenience helper: parse a decimal string and scale it in one step.
 *
 * Equivalent to `exactDecimalToScaled(parseExactDecimal(input, options), decimals, options)`
 * but validates everything before producing a result.
 */
export function parseExactScaledAmount(
  input: string,
  decimals: number = DEFAULT_DECIMALS,
  options: ParseExactDecimalOptions = {}
): bigint {
  assertScaleOption(decimals, 'decimals');
  const parsed = parseExactDecimal(input, { ...options, maxScale: decimals });
  return exactDecimalToScaled(parsed, decimals, options);
}
