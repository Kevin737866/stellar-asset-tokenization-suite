/**
 * Unit tests for SDK runtime requirements and network configuration.
 * Drips Wave 11, issue #397.
 *
 * Covers: network-name validation (success / invalid / boundary / unknown),
 * default endpoint resolution, full runtime-config resolution with defaults
 * and overrides, timeout / fee-rate bounds, cross-network mismatch
 * detection, and the no-partial-state guarantee on failed resolution.
 *
 * NOTE: no test constructs a full `StellarRWASDK` successfully on purpose —
 * the SDK constructor cannot complete on main today because the client
 * constructors disagree about the contract-address shape (AssetFactory
 * requires a `C...` contract id, the other clients run `validateAddress`,
 * which only accepts `G...` addresses). That is a separate pre-existing
 * issue; the failure-path tests below throw before any client is built, so
 * they are unaffected by it.
 */

import {
  MAX_FEE_RATE_BPS,
  MAX_TIMEOUT_SECONDS,
  MIN_FEE_RATE_BPS,
  MIN_TIMEOUT_SECONDS,
  RUNTIME_REQUIREMENTS,
  SUPPORTED_NETWORKS,
  isSupportedNetwork,
  resolveNetworkConfig,
  resolveRuntimeConfig,
  validateFeeRateBps,
  validateNetworkName,
  validateRuntimeConfig,
  validateTimeoutSeconds,
} from '../runtimeConfig';
import { STELLAR_NETWORKS } from '../constants';
import { InvalidParametersError } from '../errors';

describe('isSupportedNetwork', () => {
  it.each(['testnet', 'mainnet', 'futurenet', 'standalone'] as const)(
    'accepts %s',
    (network) => {
      expect(isSupportedNetwork(network)).toBe(true);
    },
  );

  it.each(['MAINNET', 'Testnet', 'mainnett', 'devnet', '', ' ', 'testnet '])(
    'rejects %p (case-sensitive, exact match only)',
    (network) => {
      expect(isSupportedNetwork(network)).toBe(false);
    },
  );

  it.each([null, undefined, 123, {}, [], true])(
    'rejects non-string %p',
    (network) => {
      expect(isSupportedNetwork(network)).toBe(false);
    },
  );
});

describe('validateNetworkName', () => {
  it('accepts every supported network', () => {
    for (const network of SUPPORTED_NETWORKS) {
      expect(() => validateNetworkName(network)).not.toThrow();
    }
  });

  it('throws InvalidParametersError naming the supported networks for an unknown name', () => {
    expect(() => validateNetworkName('devnet')).toThrow(InvalidParametersError);
    expect(() => validateNetworkName('devnet')).toThrow(
      'must be one of testnet, mainnet, futurenet, standalone',
    );
  });

  it('throws for null, undefined, empty string and non-strings', () => {
    for (const bad of [null, undefined, '', 42, {}]) {
      expect(() => validateNetworkName(bad)).toThrow(InvalidParametersError);
    }
  });
});

describe('resolveNetworkConfig', () => {
  it('returns the documented defaults for every network', () => {
    expect(resolveNetworkConfig('testnet')).toEqual({
      serverUrl: 'https://horizon-testnet.stellar.org',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
    });
    expect(resolveNetworkConfig('mainnet')).toEqual({
      serverUrl: 'https://horizon.stellar.org',
      horizonUrl: 'https://horizon.stellar.org',
      passphrase: 'Public Global Stellar Network ; September 2015',
    });
    expect(resolveNetworkConfig('futurenet')).toEqual({
      serverUrl: 'https://horizon-futurenet.stellar.org',
      horizonUrl: 'https://horizon-futurenet.stellar.org',
      passphrase: 'Test SDF Future Network ; October 2022',
    });
    expect(resolveNetworkConfig('standalone')).toEqual({
      serverUrl: 'http://localhost:8000',
      horizonUrl: 'http://localhost:8000',
      passphrase: 'Standalone Network ; February 2017',
    });
  });

  it('returns a copy: mutating the result never changes STELLAR_NETWORKS', () => {
    const resolved = resolveNetworkConfig('testnet');
    resolved.serverUrl = 'https://evil.example';
    resolved.passphrase = 'tampered';
    expect(STELLAR_NETWORKS.testnet.serverUrl).toBe('https://horizon-testnet.stellar.org');
    expect(STELLAR_NETWORKS.testnet.passphrase).toBe('Test SDF Network ; September 2015');
  });

  it('throws InvalidParametersError for an unknown network', () => {
    expect(() => resolveNetworkConfig('previewnet')).toThrow(InvalidParametersError);
    expect(() => resolveNetworkConfig(undefined)).toThrow(InvalidParametersError);
  });
});

describe('validateTimeoutSeconds / validateFeeRateBps', () => {
  it('accepts the boundary values', () => {
    expect(() => validateTimeoutSeconds(MIN_TIMEOUT_SECONDS)).not.toThrow();
    expect(() => validateTimeoutSeconds(MAX_TIMEOUT_SECONDS)).not.toThrow();
    expect(() => validateFeeRateBps(MIN_FEE_RATE_BPS)).not.toThrow();
    expect(() => validateFeeRateBps(MAX_FEE_RATE_BPS)).not.toThrow();
  });

  it('rejects zero, negative and above-max timeouts', () => {
    for (const bad of [0, -1, MAX_TIMEOUT_SECONDS + 1, 301]) {
      expect(() => validateTimeoutSeconds(bad)).toThrow(InvalidParametersError);
    }
  });

  it('rejects non-integer and non-number timeouts', () => {
    for (const bad of [30.5, NaN, Infinity, '30', null, undefined]) {
      expect(() => validateTimeoutSeconds(bad)).toThrow(InvalidParametersError);
    }
  });

  it('rejects negative and above-max fee rates', () => {
    for (const bad of [-1, MAX_FEE_RATE_BPS + 1, 10001]) {
      expect(() => validateFeeRateBps(bad)).toThrow(InvalidParametersError);
    }
  });

  it('rejects non-integer and non-number fee rates', () => {
    for (const bad of [1.5, NaN, '100', null, undefined]) {
      expect(() => validateFeeRateBps(bad)).toThrow(InvalidParametersError);
    }
  });
});

describe('resolveRuntimeConfig', () => {
  it('fills every default from the named network', () => {
    expect(resolveRuntimeConfig({ network: 'testnet' })).toEqual({
      network: 'testnet',
      serverUrl: 'https://horizon-testnet.stellar.org',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
      timeoutSeconds: 30,
      feeRateBps: 100,
    });
    expect(resolveRuntimeConfig({ network: 'mainnet' }).passphrase).toBe(
      'Public Global Stellar Network ; September 2015',
    );
  });

  it('respects explicit overrides', () => {
    expect(
      resolveRuntimeConfig({
        network: 'testnet',
        serverUrl: 'https://rpc.example.testnet',
        horizonUrl: 'https://horizon.example.testnet',
        passphrase: 'Custom Test Network ; January 2026',
        timeoutSeconds: 60,
        feeRateBps: 0,
      }),
    ).toEqual({
      network: 'testnet',
      serverUrl: 'https://rpc.example.testnet',
      horizonUrl: 'https://horizon.example.testnet',
      passphrase: 'Custom Test Network ; January 2026',
      timeoutSeconds: 60,
      feeRateBps: 0,
    });
  });

  it('accepts boundary timeout and fee values', () => {
    const resolved = resolveRuntimeConfig({
      network: 'standalone',
      timeoutSeconds: 1,
      feeRateBps: 10000,
    });
    expect(resolved.timeoutSeconds).toBe(1);
    expect(resolved.feeRateBps).toBe(10000);
  });

  it('throws InvalidParametersError for a missing or unknown network', () => {
    expect(() => resolveRuntimeConfig({ network: undefined })).toThrow(InvalidParametersError);
    expect(() => resolveRuntimeConfig({ network: 'localnet' })).toThrow(InvalidParametersError);
  });

  it('throws for a non-object input', () => {
    expect(() => resolveRuntimeConfig(null as any)).toThrow(InvalidParametersError);
    expect(() => resolveRuntimeConfig('testnet' as any)).toThrow(InvalidParametersError);
  });

  it('throws for a malformed RPC URL', () => {
    expect(() => resolveRuntimeConfig({ network: 'testnet', serverUrl: 'not-a-url' })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', serverUrl: '' })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', serverUrl: 123 })).toThrow(
      InvalidParametersError,
    );
  });

  it('throws for a malformed Horizon URL', () => {
    expect(() => resolveRuntimeConfig({ network: 'mainnet', horizonUrl: 'ht!tp://x' })).toThrow(
      InvalidParametersError,
    );
  });

  it('throws for an empty or non-string passphrase', () => {
    expect(() => resolveRuntimeConfig({ network: 'testnet', passphrase: '' })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', passphrase: '   ' })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', passphrase: 42 })).toThrow(
      InvalidParametersError,
    );
  });

  it('throws for out-of-range or non-integer timeout / fee rate', () => {
    expect(() => resolveRuntimeConfig({ network: 'testnet', timeoutSeconds: 0 })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', timeoutSeconds: 301 })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', timeoutSeconds: 30.5 })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', feeRateBps: -1 })).toThrow(
      InvalidParametersError,
    );
    expect(() => resolveRuntimeConfig({ network: 'testnet', feeRateBps: 10001 })).toThrow(
      InvalidParametersError,
    );
  });

  it('rejects a server URL that is another network’s default endpoint', () => {
    // Mainnet Horizon while the network is named testnet: almost certainly
    // a misconfiguration that would send testnet-intended traffic to mainnet.
    expect(() =>
      resolveRuntimeConfig({
        network: 'testnet',
        serverUrl: 'https://horizon.stellar.org',
      }),
    ).toThrow(InvalidParametersError);
    expect(() =>
      resolveRuntimeConfig({
        network: 'mainnet',
        serverUrl: 'https://horizon-testnet.stellar.org',
      }),
    ).toThrow(/default endpoint for 'testnet'/);
  });

  it('rejects a passphrase that belongs to another network', () => {
    expect(() =>
      resolveRuntimeConfig({
        network: 'testnet',
        passphrase: 'Public Global Stellar Network ; September 2015',
      }),
    ).toThrow(InvalidParametersError);
    expect(() =>
      resolveRuntimeConfig({
        network: 'futurenet',
        passphrase: 'Test SDF Network ; September 2015',
      }),
    ).toThrow(/belongs to network 'testnet'/);
  });

  it('leaves no partial state behind: a failed resolution throws and the next valid call still resolves', () => {
    expect(() =>
      resolveRuntimeConfig({ network: 'testnet', timeoutSeconds: 999 }),
    ).toThrow(InvalidParametersError);
    // No half-filled config escapes, and the module is stateless afterwards.
    expect(resolveRuntimeConfig({ network: 'testnet' }).timeoutSeconds).toBe(30);
    expect(STELLAR_NETWORKS.testnet.serverUrl).toBe('https://horizon-testnet.stellar.org');
  });
});

describe('validateRuntimeConfig', () => {
  it('accepts a minimal valid config and a fully overridden one', () => {
    expect(() => validateRuntimeConfig({ network: 'mainnet' })).not.toThrow();
    expect(() =>
      validateRuntimeConfig({
        network: 'standalone',
        serverUrl: 'http://localhost:8000',
        horizonUrl: 'http://localhost:8000',
        passphrase: 'Standalone Network ; February 2017',
        timeoutSeconds: 300,
        feeRateBps: 0,
      }),
    ).not.toThrow();
  });
});

describe('RUNTIME_REQUIREMENTS', () => {
  it('documents the verified minimum runtime', () => {
    expect(RUNTIME_REQUIREMENTS.node).toBe('>=18.0.0');
    expect(RUNTIME_REQUIREMENTS.typescript).toBe('>=5.0.0');
  });
});

// NOTE: the `StellarRWASDK` constructor / `createStellarRWASDK` wiring in
// `sdk/src/index.ts` (unknown network rejected with InvalidParametersError,
// timeout / fee overrides bounds-checked) is verified by the runtime smoke
// check in `docs/sdk-runtime.md`, not by a jest test here: `index.ts` does
// not compile under ts-jest on main (44 pre-existing type errors — missing
// local type bindings, `Server` no longer exported by stellar-sdk v12 —
// plus a phantom `@stellar/stellar-sdk` import in `assetFactory.ts`), so
// no jest suite can import it today. The validation logic the factory
// delegates to (`resolveNetworkConfig`, `validateTimeoutSeconds`,
// `validateFeeRateBps`) is fully covered above.
