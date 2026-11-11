import { InvalidParametersError } from './errors';

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
const AMOUNT_REGEX = /^\d+(\.\d+)?$/;
const CONTRACT_ID_REGEX = /^[A-Z2-7]{56}$/;

export function validateAddress(address: unknown, name: string): void {
  if (address == null) {
    throw new InvalidParametersError(`${name} is required`);
  }
  if (typeof address === 'object' && 'toString' in (address as object)) {
    const str = (address as { toString(): string }).toString();
    if (!STELLAR_ADDRESS_REGEX.test(str)) {
      throw new InvalidParametersError(`Invalid ${name}: must be a valid Stellar address`);
    }
    return;
  }
  if (typeof address !== 'string' || !STELLAR_ADDRESS_REGEX.test(address)) {
    throw new InvalidParametersError(`Invalid ${name}: must be a valid Stellar address`);
  }
}

export function validateAmount(amount: unknown, name: string): void {
  if (amount == null) {
    throw new InvalidParametersError(`${name} is required`);
  }
  if (typeof amount === 'string') {
    if (!AMOUNT_REGEX.test(amount)) {
      throw new InvalidParametersError(`Invalid ${name}: must be a positive number`);
    }
    const num = parseFloat(amount);
    if (num <= 0) {
      throw new InvalidParametersError(`Invalid ${name}: must be greater than zero`);
    }
    return;
  }
  if (typeof amount === 'number') {
    if (!isFinite(amount) || amount <= 0) {
      throw new InvalidParametersError(`Invalid ${name}: must be a positive number`);
    }
    return;
  }
  if (typeof amount === 'bigint') {
    if (amount <= 0n) {
      throw new InvalidParametersError(`Invalid ${name}: must be greater than zero`);
    }
    return;
  }
  throw new InvalidParametersError(`Invalid ${name}: must be a number or numeric string`);
}

export function validateNonEmptyString(value: unknown, name: string, maxLength = 256): void {
  if (value == null || typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidParametersError(`${name} is required and must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new InvalidParametersError(`${name} must not exceed ${maxLength} characters`);
  }
}

export function validatePositiveInteger(value: unknown, name: string): void {
  if (value == null) {
    throw new InvalidParametersError(`${name} is required`);
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidParametersError(`${name} must be a positive integer`);
  }
}

export function validateNonNegativeInteger(value: unknown, name: string): void {
  if (value == null) {
    throw new InvalidParametersError(`${name} is required`);
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new InvalidParametersError(`${name} must be a non-negative integer`);
  }
}

export function validateRange(value: number, min: number, max: number, name: string): void {
  if (typeof value !== 'number' || value < min || value > max) {
    throw new InvalidParametersError(`${name} must be between ${min} and ${max}`);
  }
}

export function validateServerUrl(url: unknown, name: string): void {
  if (url == null || typeof url !== 'string' || url.trim().length === 0) {
    throw new InvalidParametersError(`${name} is required and must be a non-empty URL`);
  }
  try {
    new URL(url);
  } catch {
    throw new InvalidParametersError(`Invalid ${name}: must be a valid URL`);
  }
}

export function validateContractId(id: unknown, name: string): void {
  if (id == null || typeof id !== 'string') {
    throw new InvalidParametersError(`${name} is required`);
  }
  if (!CONTRACT_ID_REGEX.test(id)) {
    throw new InvalidParametersError(`Invalid ${name}: must be a valid Stellar contract ID`);
  }
}

export function validateBoolean(value: unknown, name: string): void {
  if (typeof value !== 'boolean') {
    throw new InvalidParametersError(`${name} must be a boolean`);
  }
}

export function validateEnum<T extends Record<string, string | number>>(value: unknown, allowed: T, name: string): void {
  const values = Object.values(allowed);
  if (!values.includes(value as T[keyof T])) {
    throw new InvalidParametersError(`Invalid ${name}: must be one of ${values.join(', ')}`);
  }
}

export function safeParseAmount(value: string, name: string): bigint {
  return parseExactDecimal(value, 18, name, { allowZero: true }).scaled;
}

export interface ExactDecimalParts {
  scaled: bigint;
  whole: bigint;
  fractional: bigint;
  decimals: number;
  normalized: string;
}

const EXACT_DECIMAL_REGEX = /^\s*([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))\s*$/;

/**
 * Parses a decimal string into fixed-point `bigint` units using pure string/bigint
 * arithmetic without intermediate IEEE-754 floating-point number conversion.
 */
export function parseExactDecimal(
  value: string | bigint,
  decimals = 7,
  name = 'amount',
  options: { allowZero?: boolean; allowNegative?: boolean } = {}
): ExactDecimalParts {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new InvalidParametersError(`Invalid decimals (${decimals}): must be an integer between 0 and 36`);
  }

  const allowZero = options.allowZero ?? false;
  const allowNegative = options.allowNegative ?? false;

  if (typeof value === 'bigint') {
    if (!allowNegative && value < 0n) {
      throw new InvalidParametersError(`Invalid ${name}: negative values are not allowed`);
    }
    if (!allowZero && value === 0n) {
      throw new InvalidParametersError(`Invalid ${name}: must be greater than zero`);
    }
    const base = 10n ** BigInt(decimals);
    const abs = value < 0n ? -value : value;
    return {
      scaled: value,
      whole: abs / base,
      fractional: abs % base,
      decimals,
      normalized: formatExactDecimal(value, decimals),
    };
  }

  if (typeof value !== 'string') {
    throw new InvalidParametersError(`Invalid ${name}: expected decimal string or bigint`);
  }

  const match = EXACT_DECIMAL_REGEX.exec(value);
  if (!match) {
    throw new InvalidParametersError(
      `Invalid ${name}: "${value}" must be a base-10 decimal string without scientific notation`
    );
  }

  const sign = match[1] === '-' ? -1n : 1n;
  if (sign < 0n && !allowNegative) {
    throw new InvalidParametersError(`Invalid ${name}: negative values are not allowed`);
  }

  const rawWhole = match[2] ?? '0';
  const rawFrac = match[3] ?? match[4] ?? '';

  if (rawFrac.length > decimals) {
    throw new InvalidParametersError(
      `Invalid ${name}: fractional precision (${rawFrac.length}) exceeds supported decimals (${decimals})`
    );
  }

  const whole = BigInt(rawWhole);
  const paddedFrac = rawFrac.padEnd(decimals, '0');
  const fractional = paddedFrac.length > 0 ? BigInt(paddedFrac) : 0n;
  const magnitude = whole * (10n ** BigInt(decimals)) + fractional;

  if (!allowZero && magnitude === 0n) {
    throw new InvalidParametersError(`Invalid ${name}: must be greater than zero`);
  }

  const scaled = magnitude === 0n ? 0n : sign * magnitude;
  return {
    scaled,
    whole,
    fractional,
    decimals,
    normalized: formatExactDecimal(scaled, decimals),
  };
}

/**
 * Formats a scaled `bigint` back into an exact canonical decimal string.
 */
export function formatExactDecimal(scaled: bigint, decimals = 7): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new InvalidParametersError(`Invalid decimals (${decimals}): must be an integer between 0 and 36`);
  }
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const prefix = negative ? '-' : '';
  if (decimals === 0) {
    return `${prefix}${abs.toString()}`;
  }
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  if (frac === 0n) {
    return `${prefix}${whole.toString()}`;
  }
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${prefix}${whole.toString()}.${fracStr}`;
}
