/**
 * Regression tests for CLI process exit codes (issue #414).
 * Validation failures exit 2, network failures exit 4, success exits 0.
 */

const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();
const mockVerifyAssetBacking = jest.fn();
const mockTriggerInsuranceClaim = jest.fn();

jest.mock('../custody', () => ({
  CustodyClient: jest.fn().mockImplementation(() => ({
    verifyAssetBacking: mockVerifyAssetBacking,
    triggerInsuranceClaim: mockTriggerInsuranceClaim,
  })),
}));

jest.mock('../typeGenerator', () => ({
  runTypeGenerator: jest.fn(),
}));

import { CustodyClient } from '../custody';
import { runTypeGenerator } from '../typeGenerator';
import { CliDeps, CliNetworkError, CliValidationError, runCli } from '../cli';

const horizonDeps: CliDeps = {
  createHorizonServer: () => ({
    loadAccount: mockLoadAccount,
    submitTransaction: mockSubmitTransaction,
  }),
};

const SECRET = 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const HASH = 'a'.repeat(64);

function createPoolArgs(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    'asset-a': 'XLM',
    'asset-b': `USDC:${ADDRESS}`,
    'amount-a': '100',
    'amount-b': '200',
    secret: SECRET,
    ...overrides,
  };
  return ['create-pool', ...Object.entries(base).flatMap(([k, v]) => [`--${k}`, v])];
}

function liquidateArgs(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    'asset-id': ADDRESS,
    'custody-validator': ADDRESS,
    secret: SECRET,
    'evidence-hash': HASH,
    force: 'true',
    ...overrides,
  };
  return ['liquidate', ...Object.entries(base).flatMap(([k, v]) => [`--${k}`, v])];
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyAssetBacking.mockResolvedValue({
    isValid: false,
    alerts: [],
    latestAttestation: null,
    insuranceStatus: 'uncovered',
  });
  mockTriggerInsuranceClaim.mockResolvedValue({ hash: 'liquidation-hash' });
  mockLoadAccount.mockResolvedValue({
    accountId: () => ADDRESS,
    sequenceNumber: () => '1',
    incrementSequenceNumber: () => {},
    balances: [],
  });
  mockSubmitTransaction.mockResolvedValue({ hash: 'tx-hash', ledger: 1 });
});

describe('CLI error exit codes', () => {
  it('maps validation errors to 2 and network errors to 4', () => {
    expect(new CliValidationError('bad input').exitCode).toBe(2);
    expect(new CliNetworkError('offline').exitCode).toBe(4);
  });
});

describe('runCli() success paths', () => {
  it('returns 0 for empty args and help', async () => {
    expect(await runCli([])).toBe(0);
    expect(await runCli(['--help'])).toBe(0);
    expect(await runCli(['generate-types', '--help'])).toBe(0);
  });

  it('returns 0 when liquidation succeeds', async () => {
    expect(await runCli(liquidateArgs())).toBe(0);
    expect(mockTriggerInsuranceClaim).toHaveBeenCalledTimes(1);
  });
});

describe('runCli() validation failures', () => {
  it('returns 2 and does not touch the network for an unknown command', async () => {
    expect(await runCli(['bogus'])).toBe(2);
    expect(mockLoadAccount).not.toHaveBeenCalled();
    expect(CustodyClient).not.toHaveBeenCalled();
  });

  it('returns 2 for missing required options without partial execution', async () => {
    expect(await runCli(['create-pool'])).toBe(2);
    expect(await runCli(['liquidate'])).toBe(2);
    expect(mockLoadAccount).not.toHaveBeenCalled();
    expect(CustodyClient).not.toHaveBeenCalled();
  });

  it.each([
    createPoolArgs({ 'amount-a': '-1' }),
    createPoolArgs({ 'amount-b': '0' }),
    createPoolArgs({ fee: '0' }),
    createPoolArgs({ slippage: '1.5' }),
    createPoolArgs({ 'asset-a': 'NOT_VALID_ASSET' }),
    createPoolArgs({ network: 'badnet' }),
    createPoolArgs({ secret: 'not-a-secret' }),
    liquidateArgs({ 'asset-id': 'short' }),
    liquidateArgs({ 'custody-validator': 'short' }),
    liquidateArgs({ 'evidence-hash': 'abc' }),
    liquidateArgs({ network: 'badnet' }),
  ].map((argv) => [argv]))('returns 2 for invalid input: %j', async (argv) => {
    expect(await runCli(argv, horizonDeps)).toBe(2);
    expect(mockLoadAccount).not.toHaveBeenCalled();
    expect(CustodyClient).not.toHaveBeenCalled();
  });

  it('returns 2 when generate-types receives no contracts or schemas', async () => {
    expect(await runCli(['generate-types'])).toBe(2);
    expect(runTypeGenerator).not.toHaveBeenCalled();
  });
});

describe('runCli() network failures', () => {
  it('returns 4 when Horizon cannot load the account', async () => {
    mockLoadAccount.mockRejectedValueOnce(new Error('horizon unavailable'));
    expect(await runCli(createPoolArgs(), horizonDeps)).toBe(4);
  });

  it('returns 4 when the custody client cannot trigger liquidation', async () => {
    mockTriggerInsuranceClaim.mockRejectedValueOnce(new Error('rpc unavailable'));
    expect(await runCli(liquidateArgs())).toBe(4);
  });

  it('returns 4 when contract schemas cannot be fetched', async () => {
    (runTypeGenerator as jest.Mock).mockRejectedValueOnce(new Error('rpc unavailable'));
    expect(
      await runCli(['generate-types', '--contracts', ADDRESS, '--rpc-url', 'http://localhost:8000'])
    ).toBe(4);
  });
});
