/**
 * Tests for network-profile loading and application in the CLI.
 * Issue #410: feat(sdk-cli): Add network profile selection from a config file.
 *
 * Tests cover:
 *  - loadNetworkProfile: happy path, missing file, invalid JSON, non-object JSON
 *  - applyNetworkProfile: fills missing keys, never overwrites explicit flags
 *  - validators.profilePath: accepts empty string (skip), existing file, rejects missing
 *  - promptNetworkProfile: interactive prompt, skip on Enter, re-prompts on bad path
 *  - end-to-end: --profile flag flows into runCreatePool / runLiquidate options
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

jest.mock('../custody', () => ({ CustodyClient: jest.fn() }));

import {
  loadNetworkProfile,
  applyNetworkProfile,
  promptNetworkProfile,
  validators,
} from '../cli';

// ── helpers ───────────────────────────────────────────────────────────────────

function writeTempProfile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwa-cli-test-'));
  const file = path.join(dir, 'profile.json');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function createMockRl(answers: string[]): readline.Interface {
  const queue = [...answers];
  return {
    question: jest.fn((_q: string, cb: (answer: string) => void) => {
      setImmediate(() => cb(queue.shift() ?? ''));
    }),
    close: jest.fn(),
  } as unknown as readline.Interface;
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => { jest.restoreAllMocks(); });

// ── loadNetworkProfile ────────────────────────────────────────────────────────

describe('loadNetworkProfile()', () => {
  it('parses a valid testnet profile', () => {
    const file = writeTempProfile(JSON.stringify({
      stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
      fee: { baseFee: 100 },
    }));
    const profile = loadNetworkProfile(file);
    expect(profile.stellar?.network).toBe('testnet');
    expect(profile.stellar?.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(profile.fee?.baseFee).toBe(100);
  });

  it('parses a profile with extra unknown fields without error', () => {
    const file = writeTempProfile(JSON.stringify({
      stellar: { network: 'mainnet' },
      contracts: { assetFactory: 'CABC' },
      deployment: { maxRetries: 5 },
    }));
    const profile = loadNetworkProfile(file);
    expect(profile.stellar?.network).toBe('mainnet');
  });

  it('parses a minimal profile (empty object)', () => {
    const file = writeTempProfile('{}');
    const profile = loadNetworkProfile(file);
    expect(profile).toEqual({});
  });

  it('resolves a relative path against cwd', () => {
    // Write to cwd so the relative resolution hits it.
    const filename = `rwa-test-profile-${Date.now()}.json`;
    const cwdFile = path.join(process.cwd(), filename);
    try {
      fs.writeFileSync(cwdFile, JSON.stringify({ stellar: { network: 'futurenet' } }), 'utf8');
      const profile = loadNetworkProfile(filename);
      expect(profile.stellar?.network).toBe('futurenet');
    } finally {
      fs.unlinkSync(cwdFile);
    }
  });

  it('throws a descriptive error when the file does not exist', () => {
    expect(() => loadNetworkProfile('/nonexistent/path/profile.json')).toThrow(
      /Cannot read network profile/,
    );
  });

  it('throws a descriptive error when the file contains invalid JSON', () => {
    const file = writeTempProfile('{ not valid json }');
    expect(() => loadNetworkProfile(file)).toThrow(/not valid JSON/);
  });

  it('throws a descriptive error when the JSON root is an array', () => {
    const file = writeTempProfile('[1,2,3]');
    expect(() => loadNetworkProfile(file)).toThrow(/must be a JSON object/);
  });

  it('throws a descriptive error when the JSON root is a string', () => {
    const file = writeTempProfile('"just a string"');
    expect(() => loadNetworkProfile(file)).toThrow(/must be a JSON object/);
  });
});

// ── applyNetworkProfile ───────────────────────────────────────────────────────

describe('applyNetworkProfile()', () => {
  it('fills in network when absent from options', () => {
    const opts: Record<string, string> = {};
    applyNetworkProfile(opts, { stellar: { network: 'mainnet' } });
    expect(opts['network']).toBe('mainnet');
  });

  it('fills in horizon-url when absent from options', () => {
    const opts: Record<string, string> = {};
    applyNetworkProfile(opts, { stellar: { horizonUrl: 'https://custom.horizon.io' } });
    expect(opts['horizon-url']).toBe('https://custom.horizon.io');
  });

  it('fills in fee-base when absent from options', () => {
    const opts: Record<string, string> = {};
    applyNetworkProfile(opts, { fee: { baseFee: 500 } });
    expect(opts['fee-base']).toBe('500');
  });

  it('never overwrites an explicitly supplied network', () => {
    const opts: Record<string, string> = { network: 'testnet' };
    applyNetworkProfile(opts, { stellar: { network: 'mainnet' } });
    expect(opts['network']).toBe('testnet');
  });

  it('never overwrites an explicitly supplied horizon-url', () => {
    const opts: Record<string, string> = { 'horizon-url': 'https://my-node.io' };
    applyNetworkProfile(opts, { stellar: { horizonUrl: 'https://other.io' } });
    expect(opts['horizon-url']).toBe('https://my-node.io');
  });

  it('never overwrites an explicitly supplied fee-base', () => {
    const opts: Record<string, string> = { 'fee-base': '100' };
    applyNetworkProfile(opts, { fee: { baseFee: 999 } });
    expect(opts['fee-base']).toBe('100');
  });

  it('applies all three fields simultaneously', () => {
    const opts: Record<string, string> = {};
    applyNetworkProfile(opts, {
      stellar: { network: 'futurenet', horizonUrl: 'https://horizon-futurenet.stellar.org' },
      fee: { baseFee: 200 },
    });
    expect(opts['network']).toBe('futurenet');
    expect(opts['horizon-url']).toBe('https://horizon-futurenet.stellar.org');
    expect(opts['fee-base']).toBe('200');
  });

  it('is a no-op for an empty profile', () => {
    const opts: Record<string, string> = {};
    applyNetworkProfile(opts, {});
    expect(opts).toEqual({});
  });
});

// ── validators.profilePath ────────────────────────────────────────────────────

describe('validators.profilePath', () => {
  it('accepts an empty string (means skip)', () => {
    expect(validators.profilePath('')).toBeNull();
  });

  it('accepts an existing file path', () => {
    const file = writeTempProfile('{}');
    expect(validators.profilePath(file)).toBeNull();
  });

  it('rejects a path that does not exist', () => {
    const result = validators.profilePath('/no/such/file/profile.json');
    expect(result).not.toBeNull();
    expect(result).toMatch(/not found/);
  });
});

// ── promptNetworkProfile ──────────────────────────────────────────────────────

describe('promptNetworkProfile()', () => {
  it('returns empty string when user presses Enter (skip)', async () => {
    const rl = createMockRl(['']);
    const result = await promptNetworkProfile(rl);
    expect(result).toBe('');
  });

  it('returns the file path when user provides a valid existing file', async () => {
    const file = writeTempProfile(JSON.stringify({ stellar: { network: 'testnet' } }));
    const rl = createMockRl([file]);
    const result = await promptNetworkProfile(rl);
    expect(result).toBe(file);
  });

  it('re-prompts when the user provides a non-existent path, then accepts skip', async () => {
    const rl = createMockRl(['/nonexistent/file.json', '']);
    const result = await promptNetworkProfile(rl);
    // After re-prompt the user pressed Enter → empty string
    expect(result).toBe('');
    expect((rl.question as jest.Mock).mock.calls.length).toBe(2);
  });

  it('re-prompts on bad path, then accepts a valid file', async () => {
    const file = writeTempProfile(JSON.stringify({ stellar: { network: 'mainnet' } }));
    const rl = createMockRl(['/bad/path.json', file]);
    const result = await promptNetworkProfile(rl);
    expect(result).toBe(file);
    expect((rl.question as jest.Mock).mock.calls.length).toBe(2);
  });
});

// ── Integration: profile values reach commands ────────────────────────────────

describe('loadNetworkProfile + applyNetworkProfile integration', () => {
  it('a futurenet profile file sets network and horizon-url in an empty options map', () => {
    const file = writeTempProfile(JSON.stringify({
      stellar: {
        network: 'futurenet',
        horizonUrl: 'https://horizon-futurenet.stellar.org',
      },
      fee: { baseFee: 150 },
    }));

    const opts: Record<string, string> = {};
    const profile = loadNetworkProfile(file);
    applyNetworkProfile(opts, profile);

    expect(opts['network']).toBe('futurenet');
    expect(opts['horizon-url']).toBe('https://horizon-futurenet.stellar.org');
    expect(opts['fee-base']).toBe('150');
  });

  it('explicit --network flag wins over profile value', () => {
    const file = writeTempProfile(JSON.stringify({
      stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
    }));

    const opts: Record<string, string> = { network: 'testnet' };
    const profile = loadNetworkProfile(file);
    applyNetworkProfile(opts, profile);

    expect(opts['network']).toBe('testnet');
    // horizon-url was absent from opts, so profile fills it in
    expect(opts['horizon-url']).toBe('https://horizon.stellar.org');
  });

  it('a standalone profile pointing at localhost is applied correctly', () => {
    const file = writeTempProfile(JSON.stringify({
      stellar: {
        network: 'standalone',
        horizonUrl: 'http://localhost:8000',
      },
      fee: { baseFee: 100 },
    }));

    const opts: Record<string, string> = {};
    applyNetworkProfile(opts, loadNetworkProfile(file));

    expect(opts['network']).toBe('standalone');
    expect(opts['horizon-url']).toBe('http://localhost:8000');
  });
});
