jest.mock('../assetFactory', () => ({ AssetFactory: jest.fn() }));
jest.mock('../tokenClient', () => ({ TokenClient: jest.fn() }));
jest.mock('../dividendClient', () => ({ DividendClient: jest.fn() }));
jest.mock('../marketClient', () => ({ MarketClient: jest.fn() }));
jest.mock('../complianceClient', () => ({ ComplianceClient: jest.fn() }));
jest.mock('../custody', () => ({ CustodyClient: jest.fn() }));
jest.mock('../custodyMonitoring', () => ({ CustodyMonitoring: jest.fn() }));
jest.mock('../gasEstimator', () => ({
  GasEstimator: jest.fn(),
  estimateGas: jest.fn(),
  isWithinAccuracy: jest.fn(),
  gasCostToString: jest.fn(),
}));
jest.mock('../errors', () => {
  class RWASDKError extends Error {
    public details?: any;
    constructor(message: string, details?: any) {
      super(message);
      this.name = new.target.name;
      this.details = details;
    }
  }
  return {
    RWASDKError,
    InvalidParametersError: class InvalidParametersError extends RWASDKError {},
    UnauthorizedError: class UnauthorizedError extends RWASDKError {},
    TransactionError: class TransactionError extends RWASDKError {},
    NetworkError: class NetworkError extends RWASDKError {},
    ContractError: class ContractError extends RWASDKError {},
    HorizonError: class HorizonError extends RWASDKError {},
    parseHorizonError: jest.fn(),
    describeHorizonError: jest.fn(),
  };
});

import { TransactionBuilder } from 'stellar-sdk';
import {
  submitFeeBumpTransaction,
  InvalidParametersError,
  UnauthorizedError,
  TransactionError,
} from '../index';

const VALID_FEE_SOURCE = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const OTHER_ADDRESS = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const TEST_PASSPHRASE = 'Test SDF Network ; September 2015';

describe('submitFeeBumpTransaction (opt-in fee-bump helper)', () => {
  const mockBuildFeeBump = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (TransactionBuilder as any).buildFeeBumpTransaction = mockBuildFeeBump;
  });

  it('submits inner transaction directly when opt-in is not enabled', async () => {
    const innerTx = { id: 'inner-tx', fee: '100' };
    const sendTransaction = jest.fn().mockResolvedValue({ hash: 'direct-hash-1', status: 'PENDING' });

    const result = await submitFeeBumpTransaction(
      innerTx,
      { enabled: false, server: { sendTransaction } },
    );

    expect(result).toEqual({
      transactionHash: 'direct-hash-1',
      success: true,
      feeBumped: false,
      rawResponse: { hash: 'direct-hash-1', status: 'PENDING' },
    });
    expect(mockBuildFeeBump).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(sendTransaction).toHaveBeenCalledWith(innerTx);
  });

  it('wraps, signs with keypair-like signer, and submits when opt-in is enabled', async () => {
    const innerTx = { id: 'inner-tx', fee: '100' };
    const feeBumpTx = { id: 'fee-bump-tx', sign: jest.fn() };
    mockBuildFeeBump.mockReturnValue(feeBumpTx);

    const signer = {
      publicKey: () => VALID_FEE_SOURCE,
      sign: jest.fn(),
    };
    const sendTransaction = jest.fn().mockResolvedValue({ hash: 'bump-hash-1', status: 'PENDING' });

    const result = await submitFeeBumpTransaction(
      innerTx,
      {
        enabled: true,
        feeSource: VALID_FEE_SOURCE,
        maxFee: 500,
        signer,
        server: { sendTransaction },
        networkPassphrase: TEST_PASSPHRASE,
      },
    );

    expect(mockBuildFeeBump).toHaveBeenCalledWith(
      VALID_FEE_SOURCE,
      '500',
      innerTx,
      TEST_PASSPHRASE,
    );
    expect(feeBumpTx.sign).toHaveBeenCalledWith(signer);
    expect(sendTransaction).toHaveBeenCalledWith(feeBumpTx);
    expect(result).toEqual({
      transactionHash: 'bump-hash-1',
      success: true,
      feeBumped: true,
      feeSource: VALID_FEE_SOURCE,
      maxFee: '500',
      rawResponse: { hash: 'bump-hash-1', status: 'PENDING' },
    });
  });

  it('supports async callback signer and authorizedFeeSources allowlist', async () => {
    const innerTx = { id: 'inner-tx', fee: '200' };
    const feeBumpTx = { id: 'fee-bump-tx', signed: false };
    mockBuildFeeBump.mockReturnValue(feeBumpTx);

    const callbackSigner = jest.fn(async (tx: any) => {
      tx.signed = true;
    });
    const submitTransaction = jest.fn().mockResolvedValue({ hash: 'bump-hash-2' });

    const result = await submitFeeBumpTransaction(
      innerTx,
      {
        enabled: true,
        feeSource: VALID_FEE_SOURCE,
        maxFee: '200',
        signer: callbackSigner,
        authorizedFeeSources: [VALID_FEE_SOURCE],
        server: { submitTransaction },
      },
      { networkPassphrase: TEST_PASSPHRASE },
    );

    expect(callbackSigner).toHaveBeenCalledWith(feeBumpTx);
    expect(feeBumpTx.signed).toBe(true);
    expect(submitTransaction).toHaveBeenCalledWith(feeBumpTx);
    expect(result.feeBumped).toBe(true);
    expect(result.transactionHash).toBe('bump-hash-2');
  });

  describe('invalid input and boundary validation', () => {
    it('throws InvalidParametersError when innerTransaction is missing', async () => {
      await expect(
        submitFeeBumpTransaction(null, { enabled: false, server: { sendTransaction: jest.fn() } }),
      ).rejects.toThrow(InvalidParametersError);
    });

    it('throws InvalidParametersError for invalid feeSource address', async () => {
      await expect(
        submitFeeBumpTransaction(
          { id: 'tx' },
          {
            enabled: true,
            feeSource: 'not-a-stellar-address',
            maxFee: 500,
            signer: jest.fn(),
            server: { sendTransaction: jest.fn() },
            networkPassphrase: TEST_PASSPHRASE,
          },
        ),
      ).rejects.toThrow(InvalidParametersError);
    });

    it('throws InvalidParametersError for non-positive or non-integer maxFee', async () => {
      for (const badFee of [0, -100, 12.5, '0', 'abc', undefined]) {
        await expect(
          submitFeeBumpTransaction(
            { id: 'tx' },
            {
              enabled: true,
              feeSource: VALID_FEE_SOURCE,
              maxFee: badFee as any,
              signer: jest.fn(),
              server: { sendTransaction: jest.fn() },
              networkPassphrase: TEST_PASSPHRASE,
            },
          ),
        ).rejects.toThrow(InvalidParametersError);
      }
    });

    it('throws InvalidParametersError when maxFee is lower than inner transaction fee', async () => {
      const sendTransaction = jest.fn();
      await expect(
        submitFeeBumpTransaction(
          { id: 'tx', fee: '1000' },
          {
            enabled: true,
            feeSource: VALID_FEE_SOURCE,
            maxFee: 999,
            signer: jest.fn(),
            server: { sendTransaction },
            networkPassphrase: TEST_PASSPHRASE,
          },
        ),
      ).rejects.toThrow(InvalidParametersError);
      expect(sendTransaction).not.toHaveBeenCalled();
    });

    it('throws InvalidParametersError when networkPassphrase is missing', async () => {
      await expect(
        submitFeeBumpTransaction(
          { id: 'tx' },
          {
            enabled: true,
            feeSource: VALID_FEE_SOURCE,
            maxFee: 500,
            signer: jest.fn(),
            server: { sendTransaction: jest.fn() },
          },
        ),
      ).rejects.toThrow(InvalidParametersError);
    });
  });

  describe('authorization checks', () => {
    it('throws UnauthorizedError when signer is missing', async () => {
      await expect(
        submitFeeBumpTransaction(
          { id: 'tx' },
          {
            enabled: true,
            feeSource: VALID_FEE_SOURCE,
            maxFee: 500,
            server: { sendTransaction: jest.fn() },
            networkPassphrase: TEST_PASSPHRASE,
          },
        ),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError when signer publicKey does not match feeSource', async () => {
      const sendTransaction = jest.fn();
      await expect(
        submitFeeBumpTransaction(
          { id: 'tx' },
          {
            enabled: true,
            feeSource: VALID_FEE_SOURCE,
            maxFee: 500,
            signer: {
              publicKey: () => OTHER_ADDRESS,
              sign: jest.fn(),
            },
            server: { sendTransaction },
            networkPassphrase: TEST_PASSPHRASE,
          },
        ),
      ).rejects.toThrow(UnauthorizedError);
      expect(sendTransaction).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedError when feeSource is not in authorizedFeeSources', async () => {
      const sendTransaction = jest.fn();
      await expect(
        submitFeeBumpTransaction(
          { id: 'tx' },
          {
            enabled: true,
            feeSource: VALID_FEE_SOURCE,
            maxFee: 500,
            signer: jest.fn(),
            authorizedFeeSources: [OTHER_ADDRESS],
            server: { sendTransaction },
            networkPassphrase: TEST_PASSPHRASE,
          },
        ),
      ).rejects.toThrow(UnauthorizedError);
      expect(sendTransaction).not.toHaveBeenCalled();
    });
  });

  describe('failure semantics and no partial state changes', () => {
    it('throws TransactionError on network ERROR response without mutating innerTransaction', async () => {
      const innerTx = Object.freeze({ id: 'immutable-tx', fee: '100' });
      const feeBumpTx = { id: 'fee-bump-tx', sign: jest.fn() };
      mockBuildFeeBump.mockReturnValue(feeBumpTx);

      const sendTransaction = jest.fn().mockResolvedValue({
        status: 'ERROR',
        errorResult: 'tx_insufficient_fee',
      });

      await expect(
        submitFeeBumpTransaction(innerTx, {
          enabled: true,
          feeSource: VALID_FEE_SOURCE,
          maxFee: 500,
          signer: { publicKey: () => VALID_FEE_SOURCE, sign: jest.fn() },
          server: { sendTransaction },
          networkPassphrase: TEST_PASSPHRASE,
        }),
      ).rejects.toThrow(TransactionError);
    });

    it('does not submit if signer throws an error', async () => {
      const innerTx = { id: 'inner-tx', fee: '100' };
      const feeBumpTx = { id: 'fee-bump-tx' };
      mockBuildFeeBump.mockReturnValue(feeBumpTx);

      const sendTransaction = jest.fn();
      const failingSigner = jest.fn().mockRejectedValue(new Error('Hardware wallet rejected'));

      await expect(
        submitFeeBumpTransaction(innerTx, {
          enabled: true,
          feeSource: VALID_FEE_SOURCE,
          maxFee: 500,
          signer: failingSigner,
          server: { sendTransaction },
          networkPassphrase: TEST_PASSPHRASE,
        }),
      ).rejects.toThrow(TransactionError);
      expect(sendTransaction).not.toHaveBeenCalled();
    });
  });
});
