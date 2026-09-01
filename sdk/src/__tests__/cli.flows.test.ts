/**
 * Tests for interactive CLI — prompt flows and runInteractive().
 * Issue #205: Add interactive mode with guided prompts for CLI operations.
 */

jest.mock('../custody', () => ({
  CustodyClient: jest.fn().mockImplementation(() => ({
    verifyAssetBacking: jest.fn().mockResolvedValue({
      isValid: false,
      alerts: ['test alert'],
      latestAttestation: null,
      insuranceStatus: 'uncovered',
    }),
    triggerInsuranceClaim: jest.fn().mockResolvedValue({ hash: 'liquidation-hash' }),
  })),
}));

import * as readline from 'readline';
import { promptCreatePool, promptLiquidate, runInteractive } from '../cli';

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

// ── promptCreatePool() ────────────────────────────────────────────────────────

describe('promptCreatePool()', () => {
  it('collects all required fields correctly', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, 'XLM', `USDC:${VALID_ADDRESS}`, '100', '200', '30', '0.01',
    ]);
    const result = await promptCreatePool(rl);
    expect(result['network']).toBe('testnet');
    expect(result['secret']).toBe(VALID_SECRET);
    expect(result['asset-a']).toBe('XLM');
    expect(result['asset-b']).toBe(`USDC:${VALID_ADDRESS}`);
    expect(result['amount-a']).toBe('100');
    expect(result['amount-b']).toBe('200');
    expect(result['fee']).toBe('30');
    expect(result['slippage']).toBe('0.01');
  });

  it('re-prompts on invalid network then accepts valid input', async () => {
    const rl = createMockRl([
      'badnet', 'testnet', VALID_SECRET, 'XLM', `USDC:${VALID_ADDRESS}`, '100', '200', '30', '0.01',
    ]);
    const result = await promptCreatePool(rl);
    expect(result['network']).toBe('testnet');
    expect((rl.question as jest.Mock).mock.calls.length).toBeGreaterThan(8);
  });

  it('re-prompts on invalid secret key', async () => {
    const rl = createMockRl([
      'testnet', 'not-a-valid-secret', VALID_SECRET,
      'XLM', `USDC:${VALID_ADDRESS}`, '100', '200', '30', '0.01',
    ]);
    const result = await promptCreatePool(rl);
    expect(result['secret']).toBe(VALID_SECRET);
  });

  it('re-prompts on invalid asset format', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, 'NOT_VALID_ASSET', 'XLM',
      `USDC:${VALID_ADDRESS}`, '100', '200', '30', '0.01',
    ]);
    const result = await promptCreatePool(rl);
    expect(result['asset-a']).toBe('XLM');
  });

  it('re-prompts on non-positive amounts', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, 'XLM', `USDC:${VALID_ADDRESS}`,
      '-5', '100', '0', '200', '30', '0.01',
    ]);
    const result = await promptCreatePool(rl);
    expect(result['amount-a']).toBe('100');
    expect(result['amount-b']).toBe('200');
  });
});

// ── promptLiquidate() ─────────────────────────────────────────────────────────

describe('promptLiquidate()', () => {
  it('collects all required fields correctly', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, VALID_ADDRESS, VALID_ADDRESS,
      VALID_HASH, 'undercollateralized', 'no',
    ]);
    const result = await promptLiquidate(rl);
    expect(result['network']).toBe('testnet');
    expect(result['secret']).toBe(VALID_SECRET);
    expect(result['asset-id']).toBe(VALID_ADDRESS);
    expect(result['custody-validator']).toBe(VALID_ADDRESS);
    expect(result['evidence-hash']).toBe(VALID_HASH);
    expect(result['reason']).toBe('undercollateralized');
    expect(result['force']).toBeUndefined();
  });

  it('sets force=true when user answers "yes"', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, VALID_ADDRESS, VALID_ADDRESS,
      VALID_HASH, 'undercollateralized', 'yes',
    ]);
    const result = await promptLiquidate(rl);
    expect(result['force']).toBe('true');
  });

  it('sets force=true when user answers "y"', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, VALID_ADDRESS, VALID_ADDRESS,
      VALID_HASH, 'undercollateralized', 'y',
    ]);
    const result = await promptLiquidate(rl);
    expect(result['force']).toBe('true');
  });

  it('re-prompts on invalid evidence hash', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, VALID_ADDRESS, VALID_ADDRESS,
      'tooshort', VALID_HASH, 'undercollateralized', 'no',
    ]);
    const result = await promptLiquidate(rl);
    expect(result['evidence-hash']).toBe(VALID_HASH);
  });

  it('re-prompts on invalid contract address', async () => {
    const rl = createMockRl([
      'testnet', VALID_SECRET, 'tooshort', VALID_ADDRESS,
      VALID_ADDRESS, VALID_HASH, 'undercollateralized', 'no',
    ]);
    const result = await promptLiquidate(rl);
    expect(result['asset-id']).toBe(VALID_ADDRESS);
  });
});

// ── runInteractive() ──────────────────────────────────────────────────────────

describe('runInteractive()', () => {
  it('cancels gracefully when user answers "no" at the confirmation step (create-pool)', async () => {
    const rl = createMockRl([
      '1', 'testnet', VALID_SECRET, 'XLM', `USDC:${VALID_ADDRESS}`,
      '100', '200', '30', '0.01', 'no',
    ]);
    await expect(runInteractive(rl)).resolves.toBeUndefined();
  });

  it('cancels gracefully when user answers "no" at confirmation step (liquidate)', async () => {
    const rl = createMockRl([
      '2', 'testnet', VALID_SECRET, VALID_ADDRESS, VALID_ADDRESS,
      VALID_HASH, 'undercollateralized', 'no', 'no',
    ]);
    await expect(runInteractive(rl)).resolves.toBeUndefined();
  });

  it('proceeds past confirmation for create-pool and completes with mocked network', async () => {
    const rl = createMockRl([
      '1', 'testnet', VALID_SECRET, 'XLM', `USDC:${VALID_ADDRESS}`,
      '100', '200', '30', '0.01', 'yes',
    ]);
    // With the mocked Horizon.Server the call resolves successfully.
    // This verifies the full create-pool flow runs end-to-end.
    await expect(runInteractive(rl)).resolves.toBeUndefined();
  });

  it('accepts "liquidate" command by name with cancellation', async () => {
    const rl = createMockRl([
      'liquidate', 'testnet', VALID_SECRET, VALID_ADDRESS, VALID_ADDRESS,
      VALID_HASH, 'undercollateralized', 'no', 'no',
    ]);
    await expect(runInteractive(rl)).resolves.toBeUndefined();
  });
});
