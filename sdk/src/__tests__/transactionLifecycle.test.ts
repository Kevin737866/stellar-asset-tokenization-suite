const mockGetAccount = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();

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

  class MockServer {
    getAccount = mockGetAccount;
    sendTransaction = mockSendTransaction;
    getTransaction = mockGetTransaction;
  }

  class MockContract {
    constructor(public readonly contractId: string) {}
  }

  return {
    __esModule: true,
    Address: MockAddress,
    Contract: MockContract,
    SorobanRpc: {
      Server: MockServer,
    },
    Server: MockServer,
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ toXDR: () => 'mock-xdr' }),
    })),
    Operation: {
      invokeContractFunction: jest.fn().mockReturnValue({ type: 'invokeHostFunction' }),
    },
  };
});

jest.mock('@stellar/stellar-sdk', () => {
  class MockServer {
    getAccount = mockGetAccount;
    sendTransaction = mockSendTransaction;
    getTransaction = mockGetTransaction;
  }
  class MockContract {
    constructor(public readonly contractId: string) {}
  }
  return {
    __esModule: true,
    Server: MockServer,
    Contract: MockContract,
    SorobanRpc: { Server: MockServer },
  };
});

jest.mock('../errors', () => {
  class RWASDKError extends Error {
    constructor(message: string, public details?: any) {
      super(message);
      this.name = 'RWASDKError';
    }
  }
  class InvalidParametersError extends RWASDKError {
    constructor(message: string) {
      super(message);
      this.name = 'InvalidParametersError';
    }
  }
  class TransactionError extends RWASDKError {
    constructor(message: string, details?: any) {
      super(message, details);
      this.name = 'TransactionError';
    }
  }
  class ContractError extends RWASDKError {
    constructor(message: string, details?: any) {
      super(message, details);
      this.name = 'ContractError';
    }
  }
  class NetworkError extends RWASDKError {
    constructor(message: string) {
      super(message);
      this.name = 'NetworkError';
    }
  }
  class HorizonError extends RWASDKError {}
  return {
    RWASDKError,
    InvalidParametersError,
    TransactionError,
    ContractError,
    NetworkError,
    HorizonError,
    parseHorizonError: jest.fn(),
    describeHorizonError: jest.fn(),
  };
});

(globalThis as any).defaultRetryConfig = {};

import {
  BatchTransactionBuilder,
  StellarRWASDK,
  InvalidParametersError,
  TransactionError,
  ContractError,
  type TransactionLifecycleEvent,
} from '../index';

const TEST_SERVER_URL = 'https://soroban-testnet.stellar.org';
const TEST_PASSPHRASE = 'Test SDF Network ; September 2015';
const VALID_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const VALID_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

function makeAddress(addr = VALID_ADDRESS): any {
  return { toString: () => addr };
}

function makeSdkConfig(overrides: Record<string, any> = {}): any {
  return {
    stellar: {
      network: 'testnet',
      serverUrl: TEST_SERVER_URL,
      passphrase: TEST_PASSPHRASE,
    },
    contracts: {
      assetFactory: VALID_CONTRACT,
      complianceRegistry: VALID_ADDRESS,
      dividendDistributor: VALID_ADDRESS,
      secondaryMarket: VALID_ADDRESS,
      custodyValidator: VALID_CONTRACT,
    },
    ...overrides,
  };
}

describe('Transaction lifecycle callbacks (submit and confirm phases)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue({ accountId: () => VALID_ADDRESS, sequenceNumber: () => '1' });
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'tx-hash-123' });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS', ledger: 42001 });
  });

  describe('BatchTransactionBuilder', () => {
    it('emits submit and confirm lifecycle events in order on success', async () => {
      const events: TransactionLifecycleEvent[] = [];
      const batch = new BatchTransactionBuilder(TEST_SERVER_URL, TEST_PASSPHRASE)
        .onLifecycle((event) => {
          events.push(event);
        })
        .add({
          label: 'mint',
          contractId: VALID_CONTRACT,
          functionName: 'mint',
          args: [],
        });

      const result = await batch.submit(makeAddress());

      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('tx-hash-123');
      expect(events.map((e) => `${e.phase}:${e.status}`)).toEqual([
        'submit:pending',
        'submit:success',
        'confirm:pending',
        'confirm:success',
      ]);
      expect(events[0].operation).toBe('batch');
      expect(events[0].source).toBe(VALID_ADDRESS);
      expect(events[1].transactionHash).toBe('tx-hash-123');
      expect(events[3].transactionHash).toBe('tx-hash-123');
      expect(events[3].ledger).toBe(42001);
      expect(typeof events[3].timestamp).toBe('number');
    });

    it('emits submit:error and skips confirm when network rejects submission', async () => {
      mockSendTransaction.mockResolvedValue({ status: 'ERROR', errorResult: 'tx_bad_seq' });
      const events: TransactionLifecycleEvent[] = [];

      const batch = new BatchTransactionBuilder(TEST_SERVER_URL, TEST_PASSPHRASE, (e) => {
        events.push(e);
      }).add({
        label: 'mint',
        contractId: VALID_CONTRACT,
        functionName: 'mint',
        args: [],
      });

      await expect(batch.submit(makeAddress())).rejects.toThrow(TransactionError);
      expect(events.map((e) => `${e.phase}:${e.status}`)).toEqual([
        'submit:pending',
        'submit:error',
      ]);
      expect(events[1].errorMessage).toContain('tx_bad_seq');
    });

    it('emits confirm:error when confirmation reports FAILED', async () => {
      mockGetTransaction.mockResolvedValue({ status: 'FAILED', error: 'contract_trap' });
      const events: TransactionLifecycleEvent[] = [];

      const batch = new BatchTransactionBuilder(TEST_SERVER_URL, TEST_PASSPHRASE)
        .onLifecycle((e) => {
          events.push(e);
        })
        .add({
          label: 'mint',
          contractId: VALID_CONTRACT,
          functionName: 'mint',
          args: [],
        });

      await expect(batch.submit(makeAddress())).rejects.toThrow(TransactionError);
      expect(events.map((e) => `${e.phase}:${e.status}`)).toEqual([
        'submit:pending',
        'submit:success',
        'confirm:pending',
        'confirm:error',
      ]);
      expect(events[3].transactionHash).toBe('tx-hash-123');
      expect(events[3].errorMessage).toContain('contract_trap');
    });

    it('prefers per-call txOptions.onLifecycle over builder callback', async () => {
      const builderEvents: TransactionLifecycleEvent[] = [];
      const callEvents: TransactionLifecycleEvent[] = [];

      const batch = new BatchTransactionBuilder(TEST_SERVER_URL, TEST_PASSPHRASE)
        .onLifecycle((e) => {
          builderEvents.push(e);
        })
        .add({
          label: 'mint',
          contractId: VALID_CONTRACT,
          functionName: 'mint',
          args: [],
        });

      await batch.submit(makeAddress(), {
        onLifecycle: (e: TransactionLifecycleEvent) => {
          callEvents.push(e);
        },
      });

      expect(builderEvents).toHaveLength(0);
      expect(callEvents).toHaveLength(4);
    });

    it('rejects non-function lifecycle callbacks without leaving partial state', async () => {
      expect(
        () => new BatchTransactionBuilder(TEST_SERVER_URL, TEST_PASSPHRASE, 'not-a-fn' as any),
      ).toThrow(InvalidParametersError);

      const events: TransactionLifecycleEvent[] = [];
      const batch = new BatchTransactionBuilder(TEST_SERVER_URL, TEST_PASSPHRASE)
        .onLifecycle((e) => {
          events.push(e);
        })
        .add({
          label: 'mint',
          contractId: VALID_CONTRACT,
          functionName: 'mint',
          args: [],
        });

      expect(() => batch.onLifecycle(123 as any)).toThrow(InvalidParametersError);
      await expect(batch.submit(makeAddress(), { onLifecycle: {} as any })).rejects.toThrow(
        InvalidParametersError,
      );
      expect(mockSendTransaction).not.toHaveBeenCalled();

      // Original valid callback remains intact after failed validation
      await batch.submit(makeAddress());
      expect(events).toHaveLength(4);
    });

    it('isolates exceptions thrown by the lifecycle callback', async () => {
      const batch = new BatchTransactionBuilder(TEST_SERVER_URL, TEST_PASSPHRASE)
        .onLifecycle(() => {
          throw new Error('observer boom');
        })
        .add({
          label: 'mint',
          contractId: VALID_CONTRACT,
          functionName: 'mint',
          args: [],
        });

      const result = await batch.submit(makeAddress());
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('tx-hash-123');
    });
  });

  describe('StellarRWASDK integration', () => {
    it('propagates SDK-level lifecycle callback to createBatch()', async () => {
      const events: TransactionLifecycleEvent[] = [];
      const sdk = new StellarRWASDK(makeSdkConfig()).onTransactionLifecycle((e) => {
        events.push(e);
      });

      const batch = sdk.createBatch().add({
        label: 'mint',
        contractId: VALID_CONTRACT,
        functionName: 'mint',
        args: [],
      });

      await batch.submit(makeAddress());
      expect(events.map((e) => `${e.phase}:${e.status}`)).toEqual([
        'submit:pending',
        'submit:success',
        'confirm:pending',
        'confirm:success',
      ]);
    });

    it('validates lifecycle callback in constructor and onTransactionLifecycle without mutating state', () => {
      expect(
        () => new StellarRWASDK(makeSdkConfig({ onTransactionLifecycle: 'bad' })),
      ).toThrow(InvalidParametersError);

      const sdk = new StellarRWASDK(makeSdkConfig());
      expect(() => sdk.onTransactionLifecycle('bad' as any)).toThrow(InvalidParametersError);
    });

    it('emits submit and confirm phases during deployCompleteRWAToken', async () => {
      const events: TransactionLifecycleEvent[] = [];
      const sdk = new StellarRWASDK(makeSdkConfig({ onTransactionLifecycle: (e: TransactionLifecycleEvent) => events.push(e) }));

      (sdk.assetFactory as any).deployRWAToken = jest.fn().mockResolvedValue({
        tokenAddress: makeAddress(VALID_CONTRACT),
        transactionHash: 'deploy-hash-1',
      });
      jest.spyOn(sdk.marketClient, 'addSupportedToken').mockResolvedValue('market-hash-1');

      const result = await sdk.deployCompleteRWAToken(makeAddress(), {} as any);
      expect(result.assetFactoryHash).toBe('deploy-hash-1');
      expect(events.map((e) => `${e.phase}:${e.status}`)).toEqual([
        'submit:pending',
        'submit:success',
        'confirm:pending',
        'confirm:success',
      ]);
      expect(events[0].operation).toBe('deployCompleteRWAToken');
    });

    it('emits submit:error when deployCompleteRWAToken fails during deployment', async () => {
      const events: TransactionLifecycleEvent[] = [];
      const sdk = new StellarRWASDK(makeSdkConfig()).onTransactionLifecycle((e) => {
        events.push(e);
      });

      (sdk.assetFactory as any).deployRWAToken = jest.fn().mockRejectedValue(new Error('rpc down'));

      await expect(sdk.deployCompleteRWAToken(makeAddress(), {} as any)).rejects.toThrow(
        ContractError,
      );
      expect(events.map((e) => `${e.phase}:${e.status}`)).toEqual([
        'submit:pending',
        'submit:error',
      ]);
      expect(events[1].errorMessage).toContain('rpc down');
    });
  });
});
