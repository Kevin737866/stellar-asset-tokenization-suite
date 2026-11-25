import { Address } from 'stellar-sdk';

jest.mock('../errors', () => {
  class BaseError extends Error {
    public details?: any;
    constructor(message: string, details?: any) {
      super(message);
      this.name = new.target.name;
      this.details = details;
    }
  }
  class RWASDKError extends BaseError {}
  class InvalidParametersError extends BaseError {}
  class TransactionError extends BaseError {}
  class NetworkError extends BaseError {}
  class ContractError extends BaseError {}
  class HorizonError extends BaseError {}
  return {
    RWASDKError,
    InvalidParametersError,
    TransactionError,
    NetworkError,
    ContractError,
    HorizonError,
    parseHorizonError: jest.fn(),
    describeHorizonError: jest.fn(),
  };
});

import {
  BatchTransactionBuilder,
  StellarRWASDK,
  InvalidParametersError,
  TransactionError,
} from '../index';

const mockSimulateTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetAccount = jest.fn();
const mockBuild = jest.fn().mockReturnValue({ toXDR: () => 'mock-tx-xdr' });

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  class MockAddress {
    private readonly value: string;
    constructor(value: string) {
      this.value = value;
    }
    toString() {
      return this.value;
    }
  }
  return {
    ...actual,
    Address: actual.Address || MockAddress,
    SorobanRpc: {
      ...(actual.SorobanRpc || {}),
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
        sendTransaction: mockSendTransaction,
      })),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: mockBuild,
    })),
    Operation: {
      ...(actual.Operation || {}),
      invokeContractFunction: jest.fn().mockReturnValue({ type: 'invokeHostFunction' }),
    },
  };
});

const VALID_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const VALID_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const SERVER_URL = 'https://soroban-testnet.stellar.org';
const PASSPHRASE = 'Test SDF Network ; September 2015';

describe('Transaction simulation results in public SDK responses', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue({ accountId: () => VALID_ADDRESS, sequenceNumber: () => '1' });
  });

  describe('BatchTransactionBuilder.submit', () => {
    it('includes normalized simulation results in BatchTransactionResult on success', async () => {
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: 'ok' },
        cost: { cpuInsns: '125000' },
        events: [
          { contractId: VALID_CONTRACT, topic: ['mint'], data: '100' },
        ],
        stateChanges: [
          {
            type: 'contract_data',
            contractId: VALID_CONTRACT,
            key: 'balance',
            oldValue: '0',
            newValue: '100',
          },
          {
            type: 'account',
            contractId: '',
            key: 'ignored',
          },
        ],
      });
      mockSendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx-hash-123',
      });

      const builder = new BatchTransactionBuilder(SERVER_URL, PASSPHRASE);
      builder.add({
        label: 'mint',
        contractId: VALID_CONTRACT,
        functionName: 'mint',
        args: [],
      });

      const result = await builder.submit(new Address(VALID_ADDRESS));

      expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('tx-hash-123');
      expect(result.simulation).toEqual({
        success: true,
        events: [{ contractId: VALID_CONTRACT, topics: ['mint'], data: '100' }],
        returnValue: { retval: 'ok' },
        gasUsed: '125000',
        storageChanges: [
          {
            contractId: VALID_CONTRACT,
            key: 'balance',
            oldValue: '0',
            newValue: '100',
          },
        ],
        errorMessage: undefined,
      });
    });

    it('skips RPC simulation when skipSimulation is true and returns default simulation result', async () => {
      mockSendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx-hash-skip',
      });

      const builder = new BatchTransactionBuilder(SERVER_URL, PASSPHRASE);
      builder.add({
        label: 'mint',
        contractId: VALID_CONTRACT,
        functionName: 'mint',
        args: [],
      });

      const result = await builder.submit(new Address(VALID_ADDRESS), { skipSimulation: true });

      expect(mockSimulateTransaction).not.toHaveBeenCalled();
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
      expect(result.simulation).toEqual({
        success: true,
        events: [],
        gasUsed: '0',
        storageChanges: [],
      });
    });

    it('aborts submission without sending transaction when simulation fails (unauthorized/revert)', async () => {
      mockSimulateTransaction.mockResolvedValue({
        error: 'HostError: Error(Auth, InvalidAction)',
        cost: { cpuInsns: '42000' },
        events: [],
        stateChanges: [],
      });

      const builder = new BatchTransactionBuilder(SERVER_URL, PASSPHRASE);
      builder.add({
        label: 'mint',
        contractId: VALID_CONTRACT,
        functionName: 'mint',
        args: [],
      });

      let caught: any;
      try {
        await builder.submit(new Address(VALID_ADDRESS));
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(TransactionError);
      expect(mockSendTransaction).not.toHaveBeenCalled();
      expect(caught.details?.simulation).toEqual({
        success: false,
        events: [],
        returnValue: null,
        gasUsed: '42000',
        storageChanges: [],
        errorMessage: 'HostError: Error(Auth, InvalidAction)',
      });
      expect(caught.details?.operationResults).toHaveLength(1);
      expect(caught.details?.operationResults[0].success).toBe(false);
    });

    it('rejects non-boolean skipSimulation with InvalidParametersError', async () => {
      const builder = new BatchTransactionBuilder(SERVER_URL, PASSPHRASE);
      builder.add({
        label: 'mint',
        contractId: VALID_CONTRACT,
        functionName: 'mint',
        args: [],
      });

      await expect(
        builder.submit(new Address(VALID_ADDRESS), { skipSimulation: 'yes' as any })
      ).rejects.toThrow(InvalidParametersError);

      expect(mockSimulateTransaction).not.toHaveBeenCalled();
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  describe('StellarRWASDK.simulateTransaction & validateAndSimulate', () => {
    const createSdk = (): StellarRWASDK => {
      const instance = Object.create(StellarRWASDK.prototype);
      instance.config = {
        stellar: {
          network: 'testnet',
          serverUrl: SERVER_URL,
          passphrase: PASSPHRASE,
        },
        contracts: {
          assetFactory: new Address(VALID_CONTRACT),
          complianceRegistry: new Address(VALID_CONTRACT),
          dividendDistributor: new Address(VALID_CONTRACT),
          secondaryMarket: new Address(VALID_CONTRACT),
          custodyValidator: new Address(VALID_CONTRACT),
        },
      };
      instance.logger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };
      return instance;
    };

    it('rejects null transaction with InvalidParametersError', async () => {
      const sdk = createSdk();
      await expect(sdk.simulateTransaction(null)).rejects.toThrow(InvalidParametersError);
    });

    it('returns normalized SimulationResult from simulateTransaction', async () => {
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: 42 },
        cost: { cpuInsns: '9999' },
        events: [],
        stateChanges: [],
      });

      const sdk = createSdk();
      const res = await sdk.simulateTransaction({ fakeTx: true });
      expect(res).toEqual({
        success: true,
        events: [],
        returnValue: { retval: 42 },
        gasUsed: '9999',
        storageChanges: [],
        errorMessage: undefined,
      });
    });

    it('throws TransactionError with simulation details in validateAndSimulate on failure', async () => {
      mockSimulateTransaction.mockResolvedValue({
        error: 'Simulation failed: insufficient balance',
        cost: { cpuInsns: '500' },
      });

      const sdk = createSdk();
      let caught: any;
      try {
        await sdk.validateAndSimulate({ fakeTx: true });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(TransactionError);
      expect(caught.details?.simulation?.success).toBe(false);
      expect(caught.details?.simulation?.errorMessage).toBe(
        'Simulation failed: insufficient balance'
      );
    });
  });
});
