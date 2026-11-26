/**
 * Regression tests for typed network configuration validation (Issue #389).
 *
 * These tests exercise the pure validator that every SDK client constructor
 * calls before creating clients. They deliberately do not import `index.ts`:
 * the validator is the contract boundary and must be testable without any
 * network access or client side effects.
 */
import { STELLAR_NETWORKS } from '../constants';
import { InvalidParametersError } from '../errors';
import {
  SUPPORTED_NETWORKS,
  isSupportedNetwork,
  validateNetworkConfig,
  validateNetworkName,
} from '../networkConfig';

const validStellar = {
  network: 'testnet' as const,
  serverUrl: 'https://horizon-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  passphrase: STELLAR_NETWORKS.testnet.passphrase,
};

describe('typed network configuration validation (Issue #389)', () => {
  it('exposes every network declared in the constants preset table', () => {
    expect([...SUPPORTED_NETWORKS].sort()).toEqual(Object.keys(STELLAR_NETWORKS).sort());
  });

  it('narrows supported network values and rejects others', () => {
    expect(isSupportedNetwork('mainnet')).toBe(true);
    expect(isSupportedNetwork('localnet')).toBe(false);
    expect(isSupportedNetwork(undefined)).toBe(false);
    expect(validateNetworkName('futurenet')).toBe('futurenet');
    expect(() => validateNetworkName('localnet')).toThrow(InvalidParametersError);
    expect(() => validateNetworkName('localnet')).toThrow(/must be one of testnet, mainnet/);
  });

  it('returns a typed copy of a valid configuration', () => {
    const validated = validateNetworkConfig(validStellar);
    expect(validated).toEqual(validStellar);
    expect(validated.network).toBe('testnet');
  });

  it('allows a custom passphrase and endpoint for standalone networks', () => {
    const custom = {
      network: 'standalone' as const,
      serverUrl: 'http://127.0.0.1:8000',
      passphrase: 'Local Dev Network ; January 2026',
    };
    expect(validateNetworkConfig(custom)).toEqual(custom);
  });

  it('does not mutate the caller configuration object', () => {
    const input = { ...validStellar };
    const snapshot = { ...input };
    validateNetworkConfig(input);
    expect(input).toEqual(snapshot);
  });

  it('rejects a missing or non-object configuration', () => {
    expect(() => validateNetworkConfig(undefined)).toThrow(InvalidParametersError);
    expect(() => validateNetworkConfig(null)).toThrow(/config.stellar is required/);
    expect(() => validateNetworkConfig('testnet')).toThrow(/must be an object/);
    expect(() => validateNetworkConfig([])).toThrow(/must be an object/);
  });

  it('validates the network field first', () => {
    expect(() => validateNetworkConfig({ serverUrl: '', passphrase: '' })).toThrow(
      /config.stellar.network: must be one of/
    );
  });

  it('rejects missing, relative and non-http server URLs', () => {
    const base = { network: 'testnet' as const, passphrase: validStellar.passphrase };
    expect(() => validateNetworkConfig({ ...base, serverUrl: '' })).toThrow(
      /config.stellar.serverUrl is required/
    );
    expect(() => validateNetworkConfig({ ...base, serverUrl: 'horizon.example.org' })).toThrow(
      /must be an absolute URL/
    );
    expect(() => validateNetworkConfig({ ...base, serverUrl: 'ftp://files.example.org' })).toThrow(
      /must use http or https/
    );
  });

  it('rejects an invalid optional horizon URL', () => {
    expect(() => validateNetworkConfig({ ...validStellar, horizonUrl: 'not-a-url' })).toThrow(
      /config.stellar.horizonUrl: must be an absolute URL/
    );
  });

  it('rejects blank, non-string and overlong passphrases', () => {
    const base = { network: 'testnet' as const, serverUrl: validStellar.serverUrl };
    expect(() => validateNetworkConfig({ ...base, passphrase: '   ' })).toThrow(
      /config.stellar.passphrase is required/
    );
    expect(() => validateNetworkConfig({ ...base, passphrase: 42 })).toThrow(
      /config.stellar.passphrase is required/
    );
    expect(() => validateNetworkConfig({ ...base, passphrase: 'x'.repeat(257) })).toThrow(
      /config.stellar.passphrase must not exceed 256 characters/
    );
  });

  it('accepts a passphrase at the documented length boundary', () => {
    const config = { ...validStellar, passphrase: 'x'.repeat(256) };
    expect(validateNetworkConfig(config).passphrase).toBe('x'.repeat(256));
  });

  it('reports field paths from a custom name argument', () => {
    expect(() => validateNetworkConfig({}, 'sdk.network')).toThrow(/sdk.network.network/);
  });
});
