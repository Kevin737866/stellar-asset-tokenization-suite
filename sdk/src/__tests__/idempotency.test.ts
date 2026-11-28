import {
  IdempotencyGuard,
  BatchTransactionBuilder,
  StellarRWASDK,
  InvalidParametersError,
  UnauthorizedError,
  TransactionError,
} from '../index';

jest.mock('../errors', () => {
  class BaseError extends Error {
    public readonly details?: unknown;
    constructor(message: string, details?: unknown) {
      super(message);
      this.name = new.target.name;
      this.details = details;
    }
  }
  class RWASDKError extends BaseError {}
  class InvalidParametersError extends RWASDKError {}
  class UnauthorizedError extends RWASDKError {}
  class TransactionError extends RWASDKError {}
  class ContractError extends RWASDKError {}
  class NetworkError extends RWASDKError {}
  class HorizonError extends RWASDKError {}
  return {
    RWASDKError,
    InvalidParametersError,
    UnauthorizedError,
    TransactionError,
    ContractError,
    NetworkError,
    HorizonError,
    defaultRetryConfig: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000, backoffMultiplier: 2, jitter: false },
    parseHorizonError: jest.fn(),
    describeHorizonError: jest.fn(),
  };
});

const mockSendTransaction = jest.fn();
const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();

jest.mock('stellar-sdk', () => {
  class MockAddress {
    private readonly value: string;
    constructor(value: string) {
      this.value = value;
    }
    toString(): string {
      return this.value;
    }
  }

  class MockTransactionBuilder {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { built: true };
    }
  }

  return {
    Address: MockAddress,
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        sendTransaction: mockSendTransaction,
        simulateTransaction: mockSimulateTransaction,
      })),
    },
    Server: jest.fn().mockImplementation(() => ({
      network: jest.fn(),
      simulateTransaction: mockSimulateTransaction,
    })),
    TransactionBuilder: MockTransactionBuilder,
    Operation: {
      invokeContractFunction: jest.fn((op) => op),
    },
  };
});

import { Address } from 'stellar-sdk';

const CALLER_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const CALLER_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

describe('IdempotencyGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deduplicates completed submissions for the same key, caller, and payload', async () => {
    const guard = new IdempotencyGuard();
    const executor = jest.fn().mockResolvedValue({ txHash: 'abc123' });

    const first = await guard.execute('idem-1', CALLER_A, 'fp-1', executor);
    const second = await guard.execute('idem-1', CALLER_A, 'fp-1', executor);

    expect(first).toEqual({ txHash: 'abc123' });
    expect(second).toBe(first);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(guard.has('idem-1')).toBe(true);
    expect(guard.size).toBe(1);
  });

  it('coalesces concurrent in-flight submissions for the same key, caller, and payload', async () => {
    const guard = new IdempotencyGuard();
    let resolveFn!: (value: { txHash: string }) => void;
    const executor = jest.fn(
      () =>
        new Promise<{ txHash: string }>((resolve) => {
          resolveFn = resolve;
        }),
    );

    const p1 = guard.execute('idem-inflight', CALLER_A, 'fp-1', executor);
    const p2 = guard.execute('idem-inflight', CALLER_A, 'fp-1', executor);

    expect(executor).toHaveBeenCalledTimes(1);
    resolveFn({ txHash: 'inflight-hash' });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ txHash: 'inflight-hash' });
    expect(r2).toBe(r1);
  });

  it('does not leave partial state when execution fails, allowing safe retry', async () => {
    const guard = new IdempotencyGuard();
    const executor = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient network failure'))
      .mockResolvedValueOnce({ txHash: 'retry-success' });

    await expect(guard.execute('idem-retry', CALLER_A, 'fp-1', executor)).rejects.toThrow(
      'transient network failure',
    );
    expect(guard.has('idem-retry')).toBe(false);
    expect(guard.size).toBe(0);

    const retryResult = await guard.execute('idem-retry', CALLER_A, 'fp-1', executor);
    expect(retryResult).toEqual({ txHash: 'retry-success' });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(guard.has('idem-retry')).toBe(true);
  });

  it('rejects cross-caller reuse of an active key with UnauthorizedError without mutating state', async () => {
    const guard = new IdempotencyGuard();
    const executor = jest.fn().mockResolvedValue({ txHash: 'owner-hash' });

    await guard.execute('idem-shared', CALLER_A, 'fp-1', executor);

    await expect(
      guard.execute('idem-shared', CALLER_B, 'fp-1', jest.fn()),
    ).rejects.toThrow(UnauthorizedError);

    expect(guard.get('idem-shared')?.caller).toBe(CALLER_A);
    expect(guard.size).toBe(1);
  });

  it('rejects same-caller reuse with a different payload fingerprint with InvalidParametersError', async () => {
    const guard = new IdempotencyGuard();
    await guard.execute('idem-payload', CALLER_A, 'fp-1', async () => 'ok-1');

    await expect(
      guard.execute('idem-payload', CALLER_A, 'fp-2', async () => 'ok-2'),
    ).rejects.toThrow(InvalidParametersError);

    expect(guard.get('idem-payload')?.result).toBe('ok-1');
  });

  it('validates idempotencyKey and TTL inputs and leaves no partial state on invalid input', async () => {
    const guard = new IdempotencyGuard();

    await expect(guard.execute('', CALLER_A, 'fp-1', async () => 'x')).rejects.toThrow(
      InvalidParametersError,
    );
    await expect(guard.execute('   ', CALLER_A, 'fp-1', async () => 'x')).rejects.toThrow(
      InvalidParametersError,
    );
    await expect(guard.execute('a'.repeat(129), CALLER_A, 'fp-1', async () => 'x')).rejects.toThrow(
      InvalidParametersError,
    );
    await expect(guard.execute('bad\nkey', CALLER_A, 'fp-1', async () => 'x')).rejects.toThrow(
      InvalidParametersError,
    );
    await expect(guard.execute('valid-key', CALLER_A, 'fp-1', async () => 'x', 0)).rejects.toThrow(
      InvalidParametersError,
    );
    await expect(guard.execute('valid-key', CALLER_A, 'fp-1', async () => 'x', -10)).rejects.toThrow(
      InvalidParametersError,
    );

    expect(guard.size).toBe(0);

    // Boundary: 128-char key is accepted
    const maxKey = 'k'.repeat(128);
    await expect(guard.execute(maxKey, CALLER_A, 'fp-1', async () => 'boundary-ok')).resolves.toBe(
      'boundary-ok',
    );
    expect(guard.has(maxKey)).toBe(true);
  });

  it('evicts expired records after TTL elapses and supports clear()', async () => {
    const guard = new IdempotencyGuard(10);
    const executor = jest
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    await expect(guard.execute('idem-ttl', CALLER_A, 'fp-1', executor, 5)).resolves.toBe('first');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(guard.has('idem-ttl')).toBe(false);

    await expect(guard.execute('idem-ttl', CALLER_A, 'fp-1', executor, 5000)).resolves.toBe('second');
    expect(executor).toHaveBeenCalledTimes(2);

    guard.clear('idem-ttl');
    expect(guard.size).toBe(0);
  });
});

describe('BatchTransactionBuilder duplicate-submission protection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue({ accountId: () => CALLER_A, sequenceNumber: () => '1' });
    mockSimulateTransaction.mockResolvedValue({ result: { retval: 'ok' }, cost: { cpuInsns: 100 } });
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'batch-tx-hash-1' });
  });

  it('returns cached result on duplicate submit with the same idempotencyKey', async () => {
    const builder = new BatchTransactionBuilder(
      'https://soroban-testnet.stellar.org',
      'Test SDF Network ; September 2015',
    );
    builder.add({
      label: 'mint',
      contractId: CONTRACT_ID,
      functionName: 'mint',
      args: ['100'],
    });

    const source = new Address(CALLER_A);
    const first = await builder.submit(source, { idempotencyKey: 'batch-key-1' });
    const second = await builder.submit(source, { idempotencyKey: 'batch-key-1' });

    expect(first.transactionHash).toBe('batch-tx-hash-1');
    expect(second).toBe(first);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a different caller reusing the same idempotencyKey', async () => {
    const builder = new BatchTransactionBuilder(
      'https://soroban-testnet.stellar.org',
      'Test SDF Network ; September 2015',
    );
    builder.add({
      label: 'mint',
      contractId: CONTRACT_ID,
      functionName: 'mint',
      args: ['100'],
    });

    await builder.submit(new Address(CALLER_A), { idempotencyKey: 'batch-key-2' });

    await expect(
      builder.submit(new Address(CALLER_B), { idempotencyKey: 'batch-key-2' }),
    ).rejects.toThrow(UnauthorizedError);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
  });

  it('clears the idempotency key when batch submission fails so retry succeeds', async () => {
    mockSendTransaction
      .mockResolvedValueOnce({ status: 'ERROR', errorResult: 'tx_bad_seq' })
      .mockResolvedValueOnce({ status: 'PENDING', hash: 'batch-tx-hash-retry' });

    const builder = new BatchTransactionBuilder(
      'https://soroban-testnet.stellar.org',
      'Test SDF Network ; September 2015',
    );
    builder.add({
      label: 'mint',
      contractId: CONTRACT_ID,
      functionName: 'mint',
      args: ['100'],
    });

    const source = new Address(CALLER_A);
    await expect(builder.submit(source, { idempotencyKey: 'batch-key-fail' })).rejects.toThrow(
      TransactionError,
    );

    const retry = await builder.submit(source, { idempotencyKey: 'batch-key-fail' });
    expect(retry.transactionHash).toBe('batch-tx-hash-retry');
    expect(mockSendTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('StellarRWASDK.executeIdempotent', () => {
  it('deduplicates arbitrary submissions and supports clearIdempotencyKey', async () => {
    const sdk = Object.create(StellarRWASDK.prototype) as StellarRWASDK;
    (sdk as any)._idempotencyGuard = new IdempotencyGuard();

    const caller = new Address(CALLER_A);
    const fn = jest.fn().mockResolvedValueOnce('tx-1').mockResolvedValueOnce('tx-2');

    expect(await sdk.executeIdempotent(caller, 'sdk-key-1', 'op:1', fn)).toBe('tx-1');
    expect(await sdk.executeIdempotent(caller, 'sdk-key-1', 'op:1', fn)).toBe('tx-1');
    expect(fn).toHaveBeenCalledTimes(1);

    sdk.clearIdempotencyKey('sdk-key-1');
    expect(await sdk.executeIdempotent(caller, 'sdk-key-1', 'op:1', fn)).toBe('tx-2');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
