/**
 * Tests for interactive CLI — validators and prompt() helper.
 * Issue #205: Add interactive mode with guided prompts for CLI operations.
 */

jest.mock('../custody', () => ({ CustodyClient: jest.fn() }));

import * as readline from 'readline';
import { validators, prompt, promptCommandSelection } from '../cli';

// ── Valid test constants ────────────────────────────────────────────────────
// Stellar secret keys are 56 uppercase base-32 chars starting with 'S'
const VALID_SECRET = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const VALID_ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const VALID_HASH = 'a'.repeat(64);

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

// ── validators ───────────────────────────────────────────────────────────────

describe('validators.network', () => {
  it('accepts valid networks', () => {
    expect(validators.network('testnet')).toBeNull();
    expect(validators.network('mainnet')).toBeNull();
    expect(validators.network('futurenet')).toBeNull();
    expect(validators.network('standalone')).toBeNull();
  });
  it('rejects unknown networks', () => {
    expect(validators.network('devnet')).not.toBeNull();
    expect(validators.network('')).not.toBeNull();
  });
});

describe('validators.secret', () => {
  it('accepts valid 56-char S-prefixed key', () => {
    expect(validators.secret(VALID_SECRET)).toBeNull();
  });
  it('rejects invalid secret key', () => {
    expect(validators.secret('not-a-secret')).not.toBeNull();
    expect(validators.secret('')).not.toBeNull();
  });
});

describe('validators.asset', () => {
  it('accepts XLM and NATIVE', () => {
    expect(validators.asset('XLM')).toBeNull();
    expect(validators.asset('NATIVE')).toBeNull();
  });
  it('accepts CODE:ISSUER format', () => {
    expect(validators.asset(`USDC:${VALID_ADDRESS}`)).toBeNull();
  });
  it('rejects malformed asset strings', () => {
    expect(validators.asset('JUST_CODE')).not.toBeNull();
    expect(validators.asset('A:B:C')).not.toBeNull();
  });
});

describe('validators.positiveNumber', () => {
  it('accepts positive numbers', () => {
    expect(validators.positiveNumber('100')).toBeNull();
    expect(validators.positiveNumber('0.001')).toBeNull();
  });
  it('rejects zero, negatives, and non-numbers', () => {
    expect(validators.positiveNumber('0')).not.toBeNull();
    expect(validators.positiveNumber('-5')).not.toBeNull();
    expect(validators.positiveNumber('abc')).not.toBeNull();
  });
});

describe('validators.feeBasicPoints', () => {
  it('accepts valid fee range', () => {
    expect(validators.feeBasicPoints('1')).toBeNull();
    expect(validators.feeBasicPoints('30')).toBeNull();
    expect(validators.feeBasicPoints('10000')).toBeNull();
  });
  it('rejects out-of-range values', () => {
    expect(validators.feeBasicPoints('0')).not.toBeNull();
    expect(validators.feeBasicPoints('10001')).not.toBeNull();
    expect(validators.feeBasicPoints('abc')).not.toBeNull();
  });
});

describe('validators.slippage', () => {
  it('accepts valid slippage', () => {
    expect(validators.slippage('0')).toBeNull();
    expect(validators.slippage('0.01')).toBeNull();
    expect(validators.slippage('0.99')).toBeNull();
  });
  it('rejects values >= 1 and non-numbers', () => {
    expect(validators.slippage('1')).not.toBeNull();
    expect(validators.slippage('1.5')).not.toBeNull();
    expect(validators.slippage('abc')).not.toBeNull();
  });
});

describe('validators.contractAddress', () => {
  it('accepts valid 56-char uppercase address', () => {
    expect(validators.contractAddress(VALID_ADDRESS)).toBeNull();
  });
  it('rejects short or lowercase addresses', () => {
    expect(validators.contractAddress('GAAZI4TCR3')).not.toBeNull();
    expect(validators.contractAddress('a'.repeat(56))).not.toBeNull();
  });
});

describe('validators.evidenceHash', () => {
  it('accepts valid 64-char hex string', () => {
    expect(validators.evidenceHash(VALID_HASH)).toBeNull();
    expect(validators.evidenceHash('A'.repeat(64))).toBeNull();
  });
  it('rejects non-hex or wrong length', () => {
    expect(validators.evidenceHash('abc123')).not.toBeNull();
    expect(validators.evidenceHash('z'.repeat(64))).not.toBeNull();
  });
});

// ── prompt() ─────────────────────────────────────────────────────────────────

describe('prompt()', () => {
  it('returns the typed answer', async () => {
    const rl = createMockRl(['hello']);
    expect(await prompt(rl, 'Test')).toBe('hello');
  });

  it('returns default when user presses Enter on empty input', async () => {
    const rl = createMockRl(['']);
    expect(await prompt(rl, 'Test', { defaultValue: 'myDefault' })).toBe('myDefault');
  });

  it('re-prompts on empty input when no default is set', async () => {
    const rl = createMockRl(['', 'filled']);
    const result = await prompt(rl, 'Required field');
    expect(result).toBe('filled');
    expect((rl.question as jest.Mock).mock.calls.length).toBe(2);
  });

  it('re-prompts when validation fails, then accepts correct input', async () => {
    const rl = createMockRl(['bad', 'testnet']);
    const result = await prompt(rl, 'Network', { validate: validators.network });
    expect(result).toBe('testnet');
    expect((rl.question as jest.Mock).mock.calls.length).toBe(2);
  });

  it('trims whitespace from the answer', async () => {
    const rl = createMockRl(['  trimmed  ']);
    expect(await prompt(rl, 'Trim test')).toBe('trimmed');
  });
});

// ── promptCommandSelection() ──────────────────────────────────────────────────

describe('promptCommandSelection()', () => {
  it('accepts "create-pool" by name', async () => {
    const rl = createMockRl(['create-pool']);
    expect(await promptCommandSelection(rl)).toBe('create-pool');
  });
  it('accepts "liquidate" by name', async () => {
    const rl = createMockRl(['liquidate']);
    expect(await promptCommandSelection(rl)).toBe('liquidate');
  });
  it('accepts "1" as shorthand for create-pool', async () => {
    const rl = createMockRl(['1']);
    expect(await promptCommandSelection(rl)).toBe('create-pool');
  });
  it('accepts "2" as shorthand for liquidate', async () => {
    const rl = createMockRl(['2']);
    expect(await promptCommandSelection(rl)).toBe('liquidate');
  });
  it('re-prompts on invalid command then accepts valid', async () => {
    const rl = createMockRl(['unknown', 'liquidate']);
    expect(await promptCommandSelection(rl)).toBe('liquidate');
    expect((rl.question as jest.Mock).mock.calls.length).toBe(2);
  });
});
