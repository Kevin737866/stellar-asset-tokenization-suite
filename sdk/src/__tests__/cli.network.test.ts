/**
 * Tests for safe CLI network selection — resolveNetwork() and the mainnet
 * confirmation guard. Issue #417: Document CLI install, configuration, and
 * safe network selection.
 */

jest.mock('../custody', () => ({ CustodyClient: jest.fn() }));

import { STELLAR_NETWORKS } from '../constants';
import {
  SUPPORTED_NETWORKS,
  assertMainnetConfirmed,
  resolveNetwork,
} from '../cli';

// ── SUPPORTED_NETWORKS ──────────────────────────────────────────────────────

describe('SUPPORTED_NETWORKS', () => {
  it('matches the networks defined in STELLAR_NETWORKS exactly', () => {
    expect([...SUPPORTED_NETWORKS].sort()).toEqual(Object.keys(STELLAR_NETWORKS).sort());
  });
});

// ── resolveNetwork() ────────────────────────────────────────────────────────

describe('resolveNetwork()', () => {
  it('resolves every supported network to its configured Horizon + passphrase', () => {
    for (const name of SUPPORTED_NETWORKS) {
      const resolved = resolveNetwork(name);
      expect(resolved.name).toBe(name);
      expect(resolved.horizonUrl).toBe(STELLAR_NETWORKS[name].horizonUrl);
      expect(resolved.passphrase).toBe(STELLAR_NETWORKS[name].passphrase);
    }
  });

  it('marks only mainnet as production', () => {
    expect(resolveNetwork('mainnet').isProduction).toBe(true);
    expect(resolveNetwork('testnet').isProduction).toBe(false);
    expect(resolveNetwork('futurenet').isProduction).toBe(false);
    expect(resolveNetwork('standalone').isProduction).toBe(false);
  });

  it('trims surrounding whitespace from the network name', () => {
    expect(resolveNetwork('  testnet  ').name).toBe('testnet');
  });

  it('rejects unknown networks, naming the value and the supported list', () => {
    expect(() => resolveNetwork('devnet')).toThrow(
      'Unsupported network: "devnet". Supported: testnet, mainnet, futurenet, standalone'
    );
    expect(() => resolveNetwork('')).toThrow('Unsupported network');
  });

  it('rejects case variants instead of silently normalizing them', () => {
    expect(() => resolveNetwork('MAINNET')).toThrow('Unsupported network');
    expect(() => resolveNetwork('Mainnet')).toThrow('Unsupported network');
  });

  it('accepts a custom --horizon-url override and returns it', () => {
    const resolved = resolveNetwork('mainnet', 'https://horizon.example.com');
    expect(resolved.horizonUrl).toBe('https://horizon.example.com');
    expect(resolved.name).toBe('mainnet');
  });

  it('accepts a localhost override for standalone', () => {
    const resolved = resolveNetwork('standalone', 'http://localhost:9000');
    expect(resolved.horizonUrl).toBe('http://localhost:9000');
  });

  it('rejects a --horizon-url pointing at another network\'s public Horizon', () => {
    expect(() =>
      resolveNetwork('mainnet', 'https://horizon-testnet.stellar.org')
    ).toThrow("points at a different network's public Horizon");
    expect(() =>
      resolveNetwork('testnet', 'https://horizon.stellar.org')
    ).toThrow("points at a different network's public Horizon");
    expect(() =>
      resolveNetwork('futurenet', 'https://horizon.stellar.org')
    ).toThrow("points at a different network's public Horizon");
  });

  it('accepts the matching public Horizon as an explicit override', () => {
    expect(
      resolveNetwork('testnet', 'https://horizon-testnet.stellar.org').horizonUrl
    ).toBe('https://horizon-testnet.stellar.org');
  });

  it('rejects a malformed --horizon-url', () => {
    expect(() => resolveNetwork('testnet', 'not-a-url')).toThrow(
      'Invalid --horizon-url "not-a-url"'
    );
  });

  it('ignores an empty-string --horizon-url override (uses the default)', () => {
    expect(resolveNetwork('testnet', '').horizonUrl).toBe(
      STELLAR_NETWORKS['testnet'].horizonUrl
    );
  });
});

// ── assertMainnetConfirmed() ────────────────────────────────────────────────

describe('assertMainnetConfirmed()', () => {
  it('passes for test networks without any confirmation', () => {
    expect(() => assertMainnetConfirmed(resolveNetwork('testnet'), false)).not.toThrow();
    expect(() => assertMainnetConfirmed(resolveNetwork('futurenet'), false)).not.toThrow();
    expect(() => assertMainnetConfirmed(resolveNetwork('standalone'), false)).not.toThrow();
  });

  it('refuses mainnet without explicit confirmation', () => {
    expect(() => assertMainnetConfirmed(resolveNetwork('mainnet'), false)).toThrow(
      '--confirm-mainnet'
    );
  });

  it('allows mainnet with explicit confirmation', () => {
    expect(() => assertMainnetConfirmed(resolveNetwork('mainnet'), true)).not.toThrow();
  });
});
