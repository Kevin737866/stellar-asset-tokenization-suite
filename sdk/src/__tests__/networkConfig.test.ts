/**
 * Regression tests for issue #389 — typed network configuration validation
 * before SDK client creation.
 *
 * Covers the validator's success path, invalid inputs and timeout boundaries,
 * plus the guarantee that a rejected constructor/update/factory call leaves no
 * partially configured SDK behind.
 */

import {
  assertSupportedStellarNetwork,
  DEFAULT_REQUEST_TIMEOUT_MS,
  isSupportedStellarNetwork,
  MAX_REQUEST_TIMEOUT_MS,
  MIN_REQUEST_TIMEOUT_MS,
  validateTypedNetworkConfig,
  type TypedNetworkConfigInput,
} from '../core';
import { STELLAR_NETWORKS, SUPPORTED_STELLAR_NETWORKS } from '../constants';
import { InvalidParametersError } from '../errors';
import type { StellarNetwork } from '../types';

// The constructor creates clients immediately after validation. Stub those
// constructors so this suite tests validation ordering and state atomicity
// without depending on live Stellar client internals.
jest.mock('../assetFactory', () => ({ AssetFactory: jest.fn(() => ({})) }));
jest.mock('../complianceClient', () => ({ ComplianceClient: jest.fn(() => ({})) }));
jest.mock('../dividendClient', () => ({ DividendClient: jest.fn(() => ({})) }));
jest.mock('../marketClient', () => ({ MarketClient: jest.fn(() => ({})) }));
jest.mock('../custody', () => ({ CustodyClient: jest.fn(() => ({})) }));

// Load the SDK only after the client constructors are stubbed.
const { createStellarRWASDK, StellarRWASDK } = require('../index') as typeof import('../index');

const VALID_ADDRESS = 'GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG';
const VALID_CONTRACT_ID = 'CA3D5K2AZ5HUVLWWPQJ6TAGQFQ2SBWZWOWLHGW4UMDBFTRHTO6MCGZTL';

const contracts = {
  // AssetFactory validates a C... contract ID; the other clients accept
  // Stellar account-style addresses at construction time.
  assetFactory: VALID_CONTRACT_ID as any,
  complianceRegistry: VALID_ADDRESS as any,
  dividendDistributor: VALID_ADDRESS as any,
  secondaryMarket: VALID_ADDRESS as any,
  custodyValidator: VALID_CONTRACT_ID as any,
};

function validInput(overrides: Partial<TypedNetworkConfigInput> = {}): TypedNetworkConfigInput {
  return {
    network: 'testnet',
    serverUrl: STELLAR_NETWORKS.testnet.serverUrl,
    passphrase: STELLAR_NETWORKS.testnet.passphrase,
    ...overrides,
  };
}

function validSDKConfig(): {
  stellar: TypedNetworkConfigInput;
  contracts: typeof contracts;
} {
  return {
    stellar: validInput(),
    contracts,
  };
}

describe('validateTypedNetworkConfig (#389)', () => {
  it('accepts every supported network and defaults horizonUrl to serverUrl', () => {
    for (const network of SUPPORTED_STELLAR_NETWORKS) {
      const defaults = STELLAR_NETWORKS[network];
      const result = validateTypedNetworkConfig(
        validInput({
          network,
          serverUrl: defaults.serverUrl,
          passphrase: defaults.passphrase,
        })
      );

      expect(result.valid).toBe(true);
      expect(result.network).toBe(network);
      expect(result.serverUrl).toBe(defaults.serverUrl);
      expect(result.horizonUrl).toBe(defaults.serverUrl);
      expect(result.passphrase).toBe(defaults.passphrase);
      expect(result.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    }
  });

  it('accepts an explicit http horizon URL and trims surrounding whitespace', () => {
    const result = validateTypedNetworkConfig(
      validInput({
        serverUrl: `  ${STELLAR_NETWORKS.standalone.serverUrl}  `,
        horizonUrl: ' http://localhost:8000 ',
        passphrase: `  ${STELLAR_NETWORKS.standalone.passphrase}  `,
      })
    );

    expect(result.serverUrl).toBe('http://localhost:8000');
    expect(result.horizonUrl).toBe('http://localhost:8000');
    expect(result.passphrase).toBe(STELLAR_NETWORKS.standalone.passphrase);
  });

  it('accepts the canonical passphrase when matching is required', () => {
    const result = validateTypedNetworkConfig(
      validInput({ network: 'mainnet', passphrase: STELLAR_NETWORKS.mainnet.passphrase }),
      { requireMatchingPassphrase: true }
    );
    expect(result.valid).toBe(true);
    expect(result.network).toBe('mainnet');
  });

  it('allows a custom passphrase when matching is not required', () => {
    const result = validateTypedNetworkConfig(validInput({ passphrase: 'Private Network ; 2026' }));
    expect(result.passphrase).toBe('Private Network ; 2026');
  });

  it('accepts requestTimeoutMs at both inclusive boundaries', () => {
    expect(
      validateTypedNetworkConfig(validInput({ requestTimeoutMs: MIN_REQUEST_TIMEOUT_MS }))
        .requestTimeoutMs
    ).toBe(MIN_REQUEST_TIMEOUT_MS);
    expect(
      validateTypedNetworkConfig(validInput({ requestTimeoutMs: MAX_REQUEST_TIMEOUT_MS }))
        .requestTimeoutMs
    ).toBe(MAX_REQUEST_TIMEOUT_MS);
  });

  it('rejects a missing configuration object', () => {
    expect(() => validateTypedNetworkConfig(undefined as any)).toThrow(InvalidParametersError);
    expect(() => validateTypedNetworkConfig(null as any)).toThrow(InvalidParametersError);
    expect(() => validateTypedNetworkConfig('testnet' as any)).toThrow(InvalidParametersError);
  });

  it('rejects unsupported or non-string networks with the accepted values listed', () => {
    for (const badNetwork of ['devnet', 42, null, undefined]) {
      try {
        validateTypedNetworkConfig(validInput({ network: badNetwork as any }));
        throw new Error('expected validateTypedNetworkConfig to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidParametersError);
        const message = (error as Error).message;
        expect(message).toContain('Unsupported Stellar network');
        expect(message).toContain(String(badNetwork));
        for (const network of SUPPORTED_STELLAR_NETWORKS) {
          expect(message).toContain(network);
        }
      }
    }
  });

  it('rejects missing, malformed and non-HTTP(S) server URLs', () => {
    for (const badUrl of [undefined, '', '   ', 'not-a-url', 'ftp://example.org']) {
      expect(() => validateTypedNetworkConfig(validInput({ serverUrl: badUrl as any })))
        .toThrow(InvalidParametersError);
    }
  });

  it('rejects an invalid horizon URL when one is supplied', () => {
    expect(() => validateTypedNetworkConfig(validInput({ horizonUrl: 'ws://example.org' })))
      .toThrow(InvalidParametersError);
  });

  it('rejects an empty or non-string passphrase', () => {
    for (const passphrase of [undefined, '', '   ', 123]) {
      expect(() => validateTypedNetworkConfig(validInput({ passphrase: passphrase as any })))
        .toThrow(InvalidParametersError);
    }
  });

  it('rejects a passphrase that does not match the selected network', () => {
    try {
      validateTypedNetworkConfig(
        validInput({ network: 'mainnet', passphrase: STELLAR_NETWORKS.testnet.passphrase }),
        { requireMatchingPassphrase: true }
      );
      throw new Error('expected validateTypedNetworkConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidParametersError);
      expect((error as Error).message).toContain('Passphrase mismatch');
      expect((error as Error).message).toContain(STELLAR_NETWORKS.mainnet.passphrase);
    }
  });

  it('rejects out-of-range, fractional and non-numeric request timeouts', () => {
    for (const timeout of [
      MIN_REQUEST_TIMEOUT_MS - 1,
      MAX_REQUEST_TIMEOUT_MS + 1,
      100.5,
      NaN,
      '5000',
    ]) {
      expect(() => validateTypedNetworkConfig(validInput({ requestTimeoutMs: timeout as any })))
        .toThrow(InvalidParametersError);
    }
  });

  it('exposes a typed network guard and assertion helper', () => {
    expect(isSupportedStellarNetwork('testnet')).toBe(true);
    expect(isSupportedStellarNetwork('devnet')).toBe(false);
    expect(isSupportedStellarNetwork(7)).toBe(false);
    expect(() => assertSupportedStellarNetwork('testnet')).not.toThrow();
    expect(() => assertSupportedStellarNetwork('devnet')).toThrow(InvalidParametersError);
  });
});

describe('typed network validation before client creation (#389)', () => {
  it('constructs a fully configured SDK from a valid network configuration', () => {
    const sdk = new StellarRWASDK(validSDKConfig() as any);

    expect(sdk.getConfig().stellar.network).toBe('testnet');
    expect(sdk.assetFactory).toBeDefined();
    expect(sdk.complianceClient).toBeDefined();
    expect(sdk.dividendClient).toBeDefined();
    expect(sdk.marketClient).toBeDefined();
    expect(sdk.custodyClient).toBeDefined();
    expect(() => sdk.validateConfig()).not.toThrow();
  });

  it('rejects an invalid network at construction time', () => {
    const config = validSDKConfig();
    expect(() => new StellarRWASDK({ ...config, stellar: { ...config.stellar, network: 'devnet' as any } } as any))
      .toThrow(InvalidParametersError);
  });

  it('rejects an invalid server URL at construction time', () => {
    const config = validSDKConfig();
    expect(() => new StellarRWASDK({ ...config, stellar: { ...config.stellar, serverUrl: 'ftp://rpc' } } as any))
      .toThrow(InvalidParametersError);
  });

  it('leaves config and clients untouched when an update fails validation', () => {
    const sdk = new StellarRWASDK(validSDKConfig() as any);
    const originalConfig = sdk.getConfig();
    const originalFactory = sdk.assetFactory;
    const originalMarket = sdk.marketClient;

    expect(() =>
      sdk.updateConfig({
        stellar: { ...originalConfig.stellar, network: 'devnet' as StellarNetwork },
      })
    ).toThrow(InvalidParametersError);

    expect(sdk.getConfig()).toBe(originalConfig);
    expect(sdk.getConfig().stellar.network).toBe('testnet');
    expect(sdk.assetFactory).toBe(originalFactory);
    expect(sdk.marketClient).toBe(originalMarket);
  });

  it('applies a valid configuration update and rebuilds its clients', () => {
    const sdk = new StellarRWASDK(validSDKConfig() as any);
    const originalFactory = sdk.assetFactory;

    sdk.updateConfig({
      stellar: {
        ...sdk.getConfig().stellar,
        serverUrl: STELLAR_NETWORKS.mainnet.serverUrl,
      },
    });

    expect(sdk.getConfig().stellar.serverUrl).toBe(STELLAR_NETWORKS.mainnet.serverUrl);
    expect(sdk.assetFactory).not.toBe(originalFactory);
    expect(() => sdk.validateConfig()).not.toThrow();
  });

  it('factory rejects an unsupported network with a typed error', () => {
    expect(() => createStellarRWASDK('devnet' as StellarNetwork, contracts))
      .toThrow(InvalidParametersError);
  });

  it('factory rejects invalid URL overrides before building clients', () => {
    expect(() =>
      createStellarRWASDK('testnet', contracts, { serverUrl: 'ftp://invalid', horizonUrl: 'not-a-url' })
    ).toThrow(InvalidParametersError);
  });

  it('factory creates a working SDK for each supported network', () => {
    for (const network of SUPPORTED_STELLAR_NETWORKS) {
      const sdk = createStellarRWASDK(network, contracts);
      expect(sdk.getConfig().stellar.network).toBe(network);
      expect(sdk.assetFactory).toBeDefined();
    }
  });
});
