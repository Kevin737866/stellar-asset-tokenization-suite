/**
 * Tests for StellarRWASDK.signAndSubmit — the safe transaction signing and
 * submission lifecycle method.
 *
 * The lifecycle covered here:
 *   1. Input validation (tx, signerSecret, options)
 *   2. Pre-flight simulation gate
 *   3. Signing
 *   4. Submission
 *   5. Confirmation polling
 *
 * All stellar-sdk network calls are mocked so tests run offline.
 */

jest.mock('stellar-sdk', () => {
  const SorobanRpcGetTransactionStatus = {
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    NOT_FOUND: 'NOT_FOUND',
  };

  // Factory for a mock SorobanRpc.Server
  const makeSorobanServer = (overrides: {
    simulateStatus?: 'success' | 'error';
    sendStatus?: 'PENDING' | 'ERROR';
    txStatus?: string;
    sendError?: Error;
  } = {}) =>
    jest.fn().mockImplementation(() => ({
      simulateTransaction: jest.fn().mockResolvedValue(
        overrides.simulateStatus === 'error'
          ? { error: 'simulated contract panic', cost: { cpuInsns: '0' } }
          : { result: 'AAAA', cost: { cpuInsns: '500000' }, minResourceFee: '1000' },
      ),
      sendTransaction: overrides.sendError
        ? jest.fn().mockRejectedValue(overrides.sendError)
        : jest.fn().mockResolvedValue({
            hash: 'mock-tx-hash-abc123',
            status: overrides.sendStatus ?? 'PENDING',
            errorResult: overrides.sendStatus === 'ERROR' ? { code: -1 } : undefined,
          }),
      getTransaction: jest.fn().mockResolvedValue({
        status: overrides.txStatus ?? SorobanRpcGetTransactionStatus.SUCCESS,
      }),
    }));

  return {
    SorobanRpc: {
      Server: makeSorobanServer(),
      Api: { GetTransactionStatus: SorobanRpcGetTransactionStatus },
    },
    Server: jest.fn().mockImplementation(() => ({
      network: jest.fn().mockResolvedValue({ latestLedger: 1, protocolVersion: 20 }),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({
        sign: jest.fn(),
        hash: Buffer.from('deadbeef', 'hex'),
      }),
    })),
    Keypair: {
      fromSecret: jest.fn().mockImplementation((secret: string) => {
        if (
          typeof secret !== 'string' ||
          secret.length !== 56 ||
          !secret.startsWith('S')
        ) {
          throw new Error('Invalid Stellar secret key');
        }
        return {
          publicKey: () => 'GABCDE',
          sign: jest.fn(),
        };
      }),
    },
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
      PUBLIC: 'Public Global Stellar Network ; September 2015',
    },
    Address: jest.fn().mockImplementation((addr: string) => ({
      toString: () => addr,
    })),
  };
});

import StellarRWASDK from '../index';
import { InvalidParametersError, TransactionError } from '../errors';
import { Address } from 'stellar-sdk';

// ── helpers ───────────────────────────────────────────────────────────────────

const VALID_SECRET = 'SCZANGBA5RLMQ4ZKHCZEPBKB2YNMQKPNQXMYVBMGQZQXKVHWFLFDLPF';
const VALID_SECRET_LENGTH = 56;

// Ensure our test secret is well-formed
if (VALID_SECRET.length !== VALID_SECRET_LENGTH || !VALID_SECRET.startsWith('S')) {
  throw new Error('Test setup error: VALID_SECRET must be a 56-char string starting with S');
}

function makeAddress(str: string) {
  return new Address(str) as any;
}

function makeSDK() {
  return new StellarRWASDK({
    stellar: {
      network: 'testnet',
      serverUrl: 'https://soroban-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
    },
    contracts: {
      assetFactory: makeAddress('CASSETFACTORY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
      complianceRegistry: makeAddress('CCOMPLIANCE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
      dividendDistributor: makeAddress('CDIVIDEND1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890'),
      secondaryMarket: makeAddress('CMARKET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890AB'),
      custodyValidator: makeAddress('CCUSTODY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567890A'),
    },
  });
}

/** Minimal mock transaction with a no-op sign method. */
function makeTx(signFn: jest.Mock = jest.fn()) {
  return { sign: signFn };
}

// ── Input validation ──────────────────────────────────────────────────────────

describe('StellarRWASDK.signAndSubmit — input validation', () => {
  let sdk: StellarRWASDK;

  beforeEach(() => {
    sdk = makeSDK();
  });

  it('throws InvalidParametersError when tx is null', async () => {
    await expect(sdk.signAndSubmit(null, VALID_SECRET)).rejects.toThrow(InvalidParametersError);
    await expect(sdk.signAndSubmit(null, VALID_SECRET)).rejects.toMatchObject({
      message: expect.stringContaining('tx is required'),
    });
  });

  it('throws InvalidParametersError when tx is undefined', async () => {
    await expect(sdk.signAndSubmit(undefined, VALID_SECRET)).rejects.toThrow(
      InvalidParametersError,
    );
  });

  it('throws InvalidParametersError when tx lacks a .sign method', async () => {
    await expect(sdk.signAndSubmit({}, VALID_SECRET)).rejects.toThrow(InvalidParametersError);
    await expect(sdk.signAndSubmit({}, VALID_SECRET)).rejects.toMatchObject({
      message: expect.stringContaining('.sign(keypair)'),
    });
  });

  it('throws InvalidParametersError when signerSecret is empty string', async () => {
    await expect(sdk.signAndSubmit(makeTx(), '')).rejects.toThrow(InvalidParametersError);
  });

  it('throws InvalidParametersError when signerSecret is not provided', async () => {
    await expect(sdk.signAndSubmit(makeTx(), undefined as any)).rejects.toThrow(
      InvalidParametersError,
    );
  });

  it('throws InvalidParametersError for a syntactically invalid secret key', async () => {
    // Wrong length / doesn't start with S
    await expect(sdk.signAndSubmit(makeTx(), 'NOTAVALIDKEY')).rejects.toThrow(
      InvalidParametersError,
    );
    await expect(sdk.signAndSubmit(makeTx(), 'NOTAVALIDKEY')).rejects.toMatchObject({
      message: expect.stringContaining('valid Stellar secret key'),
    });
  });

  it('throws InvalidParametersError for a non-negative options.fee value of zero', async () => {
    await expect(
      sdk.signAndSubmit(makeTx(), VALID_SECRET, { fee: 0 }),
    ).rejects.toThrow(InvalidParametersError);
  });

  it('throws InvalidParametersError for a negative options.fee', async () => {
    await expect(
      sdk.signAndSubmit(makeTx(), VALID_SECRET, { fee: -100 }),
    ).rejects.toThrow(InvalidParametersError);
  });

  it('throws InvalidParametersError for a zero options.timeout', async () => {
    await expect(
      sdk.signAndSubmit(makeTx(), VALID_SECRET, { timeout: 0 }),
    ).rejects.toThrow(InvalidParametersError);
  });

  it('throws InvalidParametersError for a negative confirmationPolls', async () => {
    await expect(
      sdk.signAndSubmit(makeTx(), VALID_SECRET, { confirmationPolls: -1 }),
    ).rejects.toThrow(InvalidParametersError);
  });
});

// ── Simulation gate ───────────────────────────────────────────────────────────

describe('StellarRWASDK.signAndSubmit — simulation gate', () => {
  let sdk: StellarRWASDK;

  beforeEach(() => {
    sdk = makeSDK();
    // Freeze time to skip the 2-second confirmation sleep.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws TransactionError and does NOT submit when simulation fails', async () => {
    // Patch simulateTransaction to return a failure.
    jest.spyOn(sdk, 'simulateTransaction').mockResolvedValueOnce({
      success: false,
      events: [],
      gasUsed: '0',
      storageChanges: [],
      errorMessage: 'contract panicked: insufficient balance',
    });

    const tx = makeTx();
    await expect(sdk.signAndSubmit(tx, VALID_SECRET)).rejects.toThrow(TransactionError);
    await expect(sdk.signAndSubmit(tx, VALID_SECRET)).rejects.toMatchObject({
      message: expect.stringContaining('simulation failed'),
    });

    // .sign must never have been called because we bailed before signing.
    expect(tx.sign).not.toHaveBeenCalled();
  });

  it('skips simulation and proceeds when skipSimulation is true', async () => {
    const simulateSpy = jest.spyOn(sdk, 'simulateTransaction');

    // Advance fake timers so confirmation polling resolves.
    const submitPromise = sdk.signAndSubmit(makeTx(), VALID_SECRET, {
      skipSimulation: true,
      skipConfirmation: true,
    });
    jest.runAllTimersAsync();
    const result = await submitPromise;

    expect(simulateSpy).not.toHaveBeenCalled();
    expect(result.simulation).toBeNull();
    expect(result.transactionHash).toBeDefined();
  });

  it('attaches simulation result to the return value on success', async () => {
    const mockSim = {
      success: true,
      events: [],
      gasUsed: '500000',
      storageChanges: [],
    };
    jest.spyOn(sdk, 'simulateTransaction').mockResolvedValueOnce(mockSim);

    const submitPromise = sdk.signAndSubmit(makeTx(), VALID_SECRET, {
      skipConfirmation: true,
    });
    jest.runAllTimersAsync();
    const result = await submitPromise;

    expect(result.simulation).toEqual(mockSim);
  });
});

// ── Signing ───────────────────────────────────────────────────────────────────

describe('StellarRWASDK.signAndSubmit — signing', () => {
  let sdk: StellarRWASDK;

  beforeEach(() => {
    sdk = makeSDK();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls tx.sign exactly once with the keypair derived from signerSecret', async () => {
    jest.spyOn(sdk, 'simulateTransaction').mockResolvedValue({
      success: true,
      events: [],
      gasUsed: '100',
      storageChanges: [],
    });

    const signFn = jest.fn();
    const tx = makeTx(signFn);

    const submitPromise = sdk.signAndSubmit(tx, VALID_SECRET, { skipConfirmation: true });
    jest.runAllTimersAsync();
    await submitPromise;

    expect(signFn).toHaveBeenCalledTimes(1);
  });

  it('throws TransactionError when tx.sign throws', async () => {
    jest.spyOn(sdk, 'simulateTransaction').mockResolvedValue({
      success: true,
      events: [],
      gasUsed: '100',
      storageChanges: [],
    });

    const failingSign = jest.fn().mockImplementation(() => {
      throw new Error('HSM device disconnected');
    });
    const tx = makeTx(failingSign);

    await expect(sdk.signAndSubmit(tx, VALID_SECRET)).rejects.toThrow(TransactionError);
    await expect(sdk.signAndSubmit(tx, VALID_SECRET)).rejects.toMatchObject({
      message: expect.stringContaining('signing failed'),
    });
  });
});

// ── Submission ────────────────────────────────────────────────────────────────

describe('StellarRWASDK.signAndSubmit — submission', () => {
  let sdk: StellarRWASDK;

  beforeEach(() => {
    sdk = makeSDK();
    // Always pass simulation so submission code is reached.
    jest.spyOn(sdk, 'simulateTransaction').mockResolvedValue({
      success: true,
      events: [],
      gasUsed: '200',
      storageChanges: [],
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws TransactionError when network rejects with status ERROR', async () => {
    // Re-configure the SorobanRpc mock to return ERROR status.
    const { SorobanRpc } = await import('stellar-sdk');
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockResolvedValue({
        hash: 'err-hash',
        status: 'ERROR',
        errorResult: { code: -1, description: 'tx_bad_seq' },
      }),
      getTransaction: jest.fn(),
    }));

    await expect(sdk.signAndSubmit(makeTx(), VALID_SECRET)).rejects.toThrow(TransactionError);
    await expect(sdk.signAndSubmit(makeTx(), VALID_SECRET)).rejects.toMatchObject({
      message: expect.stringContaining('rejected by network'),
    });
  });

  it('throws TransactionError when sendTransaction rejects with a network error', async () => {
    const { SorobanRpc } = await import('stellar-sdk');
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      getTransaction: jest.fn(),
    }));

    await expect(sdk.signAndSubmit(makeTx(), VALID_SECRET)).rejects.toThrow(TransactionError);
    await expect(sdk.signAndSubmit(makeTx(), VALID_SECRET)).rejects.toMatchObject({
      message: expect.stringContaining('network error during submission'),
    });
  });

  it('returns the transaction hash on successful submission with skipConfirmation', async () => {
    const { SorobanRpc } = await import('stellar-sdk');
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockResolvedValue({
        hash: 'success-hash-xyz',
        status: 'PENDING',
      }),
      getTransaction: jest.fn(),
    }));

    const result = await sdk.signAndSubmit(makeTx(), VALID_SECRET, {
      skipConfirmation: true,
    });

    expect(result.transactionHash).toBe('success-hash-xyz');
    expect(result.confirmed).toBe(false);
  });
});

// ── Confirmation polling ──────────────────────────────────────────────────────

describe('StellarRWASDK.signAndSubmit — confirmation polling', () => {
  let sdk: StellarRWASDK;

  beforeEach(() => {
    sdk = makeSDK();
    jest.spyOn(sdk, 'simulateTransaction').mockResolvedValue({
      success: true,
      events: [],
      gasUsed: '200',
      storageChanges: [],
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns confirmed:false without polling when skipConfirmation is true', async () => {
    const { SorobanRpc } = await import('stellar-sdk');
    const getTransactionMock = jest.fn();
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockResolvedValue({ hash: 'h1', status: 'PENDING' }),
      getTransaction: getTransactionMock,
    }));

    const result = await sdk.signAndSubmit(makeTx(), VALID_SECRET, {
      skipConfirmation: true,
    });

    expect(result.confirmed).toBe(false);
    expect(getTransactionMock).not.toHaveBeenCalled();
  });

  it('returns confirmed:false when confirmationPolls is 0', async () => {
    const { SorobanRpc } = await import('stellar-sdk');
    const getTransactionMock = jest.fn();
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockResolvedValue({ hash: 'h2', status: 'PENDING' }),
      getTransaction: getTransactionMock,
    }));

    const result = await sdk.signAndSubmit(makeTx(), VALID_SECRET, {
      confirmationPolls: 0,
    });

    expect(result.confirmed).toBe(false);
    expect(getTransactionMock).not.toHaveBeenCalled();
  });

  it('throws TransactionError when on-chain status is FAILED', async () => {
    const { SorobanRpc } = await import('stellar-sdk');
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockResolvedValue({ hash: 'h3', status: 'PENDING' }),
      getTransaction: jest.fn().mockResolvedValue({ status: 'FAILED' }),
    }));

    const promise = sdk.signAndSubmit(makeTx(), VALID_SECRET, { confirmationPolls: 1 });
    // Let the 2-second poll timer fire.
    jest.runAllTimersAsync();

    await expect(promise).rejects.toThrow(TransactionError);
    await expect(
      (() => {
        const p2 = sdk.signAndSubmit(makeTx(), VALID_SECRET, { confirmationPolls: 1 });
        jest.runAllTimersAsync();
        return p2;
      })(),
    ).rejects.toMatchObject({
      message: expect.stringContaining('atomically reverted'),
    });
  });

  it('returns confirmed:false when all polls time out without reaching SUCCESS', async () => {
    const { SorobanRpc } = await import('stellar-sdk');
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockResolvedValue({ hash: 'h4', status: 'PENDING' }),
      // Always return NOT_FOUND — tx never lands.
      getTransaction: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
    }));

    const promise = sdk.signAndSubmit(makeTx(), VALID_SECRET, { confirmationPolls: 2 });
    jest.runAllTimersAsync();
    const result = await promise;

    expect(result.confirmed).toBe(false);
    expect(result.transactionHash).toBe('h4');
  });
});

// ── Full happy-path ───────────────────────────────────────────────────────────

describe('StellarRWASDK.signAndSubmit — full successful lifecycle', () => {
  it('returns a fully populated SignAndSubmitResult on success', async () => {
    const sdk = makeSDK();

    const mockSim = {
      success: true,
      events: [],
      gasUsed: '750000',
      storageChanges: [],
    };
    jest.spyOn(sdk, 'simulateTransaction').mockResolvedValue(mockSim);

    jest.useFakeTimers();
    const { SorobanRpc } = await import('stellar-sdk');
    (SorobanRpc.Server as jest.Mock).mockImplementationOnce(() => ({
      sendTransaction: jest.fn().mockResolvedValue({
        hash: 'final-hash-999',
        status: 'PENDING',
      }),
      getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    }));

    const promise = sdk.signAndSubmit(makeTx(), VALID_SECRET, { confirmationPolls: 3 });
    jest.runAllTimersAsync();
    const result = await promise;
    jest.useRealTimers();

    expect(result.transactionHash).toBe('final-hash-999');
    expect(result.confirmed).toBe(true);
    expect(result.status).toBe('SUCCESS');
    expect(result.simulation).toEqual(mockSim);
    expect(typeof result.fee).toBe('string');
  });
});
