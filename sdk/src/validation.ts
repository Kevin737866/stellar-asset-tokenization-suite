import { STELLAR_NETWORKS } from './constants';
import { InvalidParametersError } from './errors';
import type { RWASDKConfig } from './types';

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
const AMOUNT_REGEX = /^\d+(\.\d+)?$/;
const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

const NETWORK_CONTRACT_FIELDS = [
  'assetFactory',
  'complianceRegistry',
  'dividendDistributor',
  'secondaryMarket',
  'custodyValidator',
] as const;

function toAddressString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'toString' in value) {
    const str = (value as { toString(): string }).toString();
    return typeof str === 'string' ? str : null;
  }
  return null;
}

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
  if (id == null) {
    throw new InvalidParametersError(`${name} is required`);
  }
  const str = toAddressString(id);
  if (str == null || !CONTRACT_ID_REGEX.test(str)) {
    throw new InvalidParametersError(`Invalid ${name}: must be a valid Stellar contract ID (C...)`);
  }
}

export function validateStellarNetwork(network: unknown, name = 'config.stellar.network'): void {
  if (network == null) {
    throw new InvalidParametersError(`${name} is required`);
  }
  if (typeof network !== 'string' || !(network in STELLAR_NETWORKS)) {
    throw new InvalidParametersError(
      `Invalid ${name}: must be one of ${Object.keys(STELLAR_NETWORKS).join(', ')}`,
    );
  }
}

export function validateNetworkPassphrase(network: string, passphrase: unknown): void {
  const expected = STELLAR_NETWORKS[network]?.passphrase;
  if (expected == null) {
    throw new InvalidParametersError(`Invalid config.stellar.network: unsupported network ${network}`);
  }
  if (passphrase !== expected) {
    throw new InvalidParametersError(
      `Invalid config.stellar.passphrase: must match the ${network} network passphrase`,
      { network, expected, actual: passphrase },
    );
  }
}

export function validateNetworkContractAddresses(contracts: unknown): void {
  if (contracts == null || typeof contracts !== 'object') {
    throw new InvalidParametersError('config.contracts is required');
  }
  for (const field of NETWORK_CONTRACT_FIELDS) {
    validateContractId((contracts as Record<string, unknown>)[field], `config.contracts.${field}`);
  }
}

export function validateNetworkConfig(config: RWASDKConfig): void {
  if (config == null || typeof config !== 'object') {
    throw new InvalidParametersError('config is required');
  }
  if (config.stellar == null || typeof config.stellar !== 'object') {
    throw new InvalidParametersError('config.stellar is required');
  }
  validateStellarNetwork(config.stellar.network);
  validateServerUrl(config.stellar.serverUrl, 'config.stellar.serverUrl');
  validateNetworkPassphrase(config.stellar.network, config.stellar.passphrase);
  validateNetworkContractAddresses(config.contracts);
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
  if (!AMOUNT_REGEX.test(value)) {
    throw new InvalidParametersError(`Invalid ${name}: must be a valid positive number`);
  }
  const [whole, fractional = ''] = value.split('.');
  const wholeBigInt = BigInt(whole.replace(/^0+/, '') || '0');
  const fractionalBigInt = fractional ? BigInt(fractional.padEnd(18, '0').slice(0, 18)) : 0n;
  return wholeBigInt * BigInt(10) ** BigInt(18) + fractionalBigInt;
}
