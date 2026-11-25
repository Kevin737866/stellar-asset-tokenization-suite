import { DEFAULT_DECIMALS } from './constants';
import { exactDecimalToScaled, parseExactDecimal } from './decimal';
import { InvalidParametersError } from './errors';

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
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
    // Parse with bigint only: `parseFloat` would round long decimals and can
    // underflow tiny positive values to zero. (Issue #388)
    const parsed = parseExactDecimal(amount, {
      name,
      allowNegative: false,
      allowPositiveSign: false,
    });
    if (parsed.unscaled <= 0n) {
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

/**
 * Scale a decimal string to an 18-decimal integer.
 *
 * Uses exact parsing (no `parseFloat`/`Number`). For backwards compatibility
 * fractional digits beyond 18 are still truncated; callers that need to reject
 * that loss of precision should use `parseExactScaledAmount` from `decimal.ts`.
 */
export function safeParseAmount(value: string, name: string): bigint {
  const parsed = parseExactDecimal(value, {
    name,
    allowNegative: false,
    allowPositiveSign: false,
  });
  const truncated = parsed.scale > DEFAULT_DECIMALS
    ? {
        unscaled: parsed.unscaled / (10n ** BigInt(parsed.scale - DEFAULT_DECIMALS)),
        scale: DEFAULT_DECIMALS,
      }
    : parsed;
  return exactDecimalToScaled(truncated, DEFAULT_DECIMALS, { name });
}
