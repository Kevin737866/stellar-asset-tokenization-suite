jest.mock('../errors', () => {
  class RWASDKError extends Error {
    public code: string;
    public details?: any;
    constructor(code: string, message: string, details?: any) {
      super(message);
      this.name = 'RWASDKError';
      this.code = code;
      this.details = details;
    }
  }
  class InvalidParametersError extends RWASDKError {
    constructor(message?: string, details?: any) {
      super('INVALID_PARAMETERS', message ?? 'Invalid parameters', details);
      this.name = 'InvalidParametersError';
    }
  }
  class TransactionError extends RWASDKError {
    constructor(message?: string, details?: any) {
      super('TRANSACTION_FAILED', message ?? 'Transaction failed', details);
      this.name = 'TransactionError';
    }
  }
  class NetworkError extends RWASDKError {
    constructor(message?: string, details?: any) {
      super('NETWORK_ERROR', message ?? 'Network error', details);
    }
  }
  class ContractError extends RWASDKError {
    constructor(message?: string, details?: any) {
      super('CONTRACT_ERROR', message ?? 'Contract error', details);
    }
  }
  class HorizonError extends RWASDKError {
    constructor(message?: string, details?: any) {
      super('HORIZON_ERROR', message ?? 'Horizon error', details);
    }
  }
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
  verifyNetworkPassphrase,
  signTransactionWithPassphraseVerification,
  InvalidParametersError,
  TransactionError,
} from '../index';
import { STELLAR_NETWORKS } from '../constants';

describe('Network passphrase verification before signing', () => {
  const TESTNET_PASSPHRASE = STELLAR_NETWORKS.testnet.passphrase;
  const MAINNET_PASSPHRASE = STELLAR_NETWORKS.mainnet.passphrase;
  const FUTURENET_PASSPHRASE = STELLAR_NETWORKS.futurenet.passphrase;
  const STANDALONE_PASSPHRASE = STELLAR_NETWORKS.standalone.passphrase;

  describe('verifyNetworkPassphrase', () => {
    it('verifies a matching raw passphrase string for known networks', () => {
      const result = verifyNetworkPassphrase(TESTNET_PASSPHRASE, TESTNET_PASSPHRASE);
      expect(result).toEqual({
        verified: true,
        networkPassphrase: TESTNET_PASSPHRASE,
        matchedNetwork: 'testnet',
      });

      const mainnetResult = verifyNetworkPassphrase(MAINNET_PASSPHRASE, MAINNET_PASSPHRASE, {
        expectedNetwork: 'mainnet',
      });
      expect(mainnetResult).toEqual({
        verified: true,
        networkPassphrase: MAINNET_PASSPHRASE,
        matchedNetwork: 'mainnet',
      });
    });

    it('verifies a matching transaction object', () => {
      const tx = { networkPassphrase: FUTURENET_PASSPHRASE };
      const result = verifyNetworkPassphrase(tx, FUTURENET_PASSPHRASE, {
        expectedNetwork: 'futurenet',
      });
      expect(result).toEqual({
        verified: true,
        networkPassphrase: FUTURENET_PASSPHRASE,
        matchedNetwork: 'futurenet',
      });
    });

    it('verifies a custom passphrase without a known network match', () => {
      const custom = 'Custom Private Stellar Network ; 2026';
      const result = verifyNetworkPassphrase({ networkPassphrase: custom }, custom);
      expect(result).toEqual({
        verified: true,
        networkPassphrase: custom,
        matchedNetwork: undefined,
      });
    });

    it('throws TransactionError on passphrase mismatch (cross-network protection)', () => {
      const mainnetTx = { networkPassphrase: MAINNET_PASSPHRASE };
      expect(() => verifyNetworkPassphrase(mainnetTx, TESTNET_PASSPHRASE)).toThrow(TransactionError);
      expect(() => verifyNetworkPassphrase(mainnetTx, TESTNET_PASSPHRASE)).toThrow(
        /Network passphrase mismatch before signing/
      );
    });

    it('enforces exact byte-for-byte match (rejects case or whitespace differences)', () => {
      expect(() =>
        verifyNetworkPassphrase(`${TESTNET_PASSPHRASE} `, TESTNET_PASSPHRASE)
      ).toThrow(TransactionError);

      expect(() =>
        verifyNetworkPassphrase(TESTNET_PASSPHRASE.toLowerCase(), TESTNET_PASSPHRASE)
      ).toThrow(TransactionError);
    });

    it('throws InvalidParametersError for empty or invalid expectedPassphrase', () => {
      expect(() => verifyNetworkPassphrase(TESTNET_PASSPHRASE, '')).toThrow(InvalidParametersError);
      expect(() => verifyNetworkPassphrase(TESTNET_PASSPHRASE, '   ')).toThrow(InvalidParametersError);
      expect(() => verifyNetworkPassphrase(TESTNET_PASSPHRASE, null as any)).toThrow(InvalidParametersError);
    });

    it('throws InvalidParametersError for missing or empty transaction passphrase', () => {
      expect(() => verifyNetworkPassphrase(null as any, TESTNET_PASSPHRASE)).toThrow(InvalidParametersError);
      expect(() => verifyNetworkPassphrase(undefined as any, TESTNET_PASSPHRASE)).toThrow(InvalidParametersError);
      expect(() => verifyNetworkPassphrase({}, TESTNET_PASSPHRASE)).toThrow(InvalidParametersError);
      expect(() => verifyNetworkPassphrase({ networkPassphrase: '' }, TESTNET_PASSPHRASE)).toThrow(
        InvalidParametersError
      );
      expect(() => verifyNetworkPassphrase({ networkPassphrase: '   ' }, TESTNET_PASSPHRASE)).toThrow(
        InvalidParametersError
      );
    });

    it('throws InvalidParametersError when expectedNetwork is unknown or disagrees with expectedPassphrase', () => {
      expect(() =>
        verifyNetworkPassphrase(TESTNET_PASSPHRASE, TESTNET_PASSPHRASE, {
          expectedNetwork: 'unknown-net' as any,
        })
      ).toThrow(InvalidParametersError);

      expect(() =>
        verifyNetworkPassphrase(TESTNET_PASSPHRASE, TESTNET_PASSPHRASE, {
          expectedNetwork: 'mainnet',
        })
      ).toThrow(InvalidParametersError);
    });
  });

  describe('signTransactionWithPassphraseVerification', () => {
    it('signs the transaction when the network passphrase matches', () => {
      const sign = jest.fn();
      const tx = { networkPassphrase: STANDALONE_PASSPHRASE, sign };
      const signer = { publicKey: () => 'GEXAMPLE' };

      const returned = signTransactionWithPassphraseVerification(
        tx,
        signer,
        STANDALONE_PASSPHRASE,
        { expectedNetwork: 'standalone' }
      );

      expect(returned).toBe(tx);
      expect(sign).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledWith(signer);
    });

    it('supports multiple signers in an array', () => {
      const sign = jest.fn();
      const tx = { networkPassphrase: TESTNET_PASSPHRASE, sign };
      const signerA = { id: 'a' };
      const signerB = { id: 'b' };

      signTransactionWithPassphraseVerification(tx, [signerA, signerB], TESTNET_PASSPHRASE);

      expect(sign).toHaveBeenCalledTimes(1);
      expect(sign).toHaveBeenCalledWith(signerA, signerB);
    });

    it('does NOT call sign() when passphrase verification fails (no partial state changes)', () => {
      const sign = jest.fn();
      const tx = { networkPassphrase: MAINNET_PASSPHRASE, sign };
      const signer = { publicKey: () => 'GEXAMPLE' };

      expect(() =>
        signTransactionWithPassphraseVerification(tx, signer, TESTNET_PASSPHRASE)
      ).toThrow(TransactionError);

      expect(sign).not.toHaveBeenCalled();
    });

    it('throws InvalidParametersError for invalid transaction or signers without calling sign()', () => {
      const sign = jest.fn();
      const tx = { networkPassphrase: TESTNET_PASSPHRASE, sign };

      expect(() =>
        signTransactionWithPassphraseVerification(null as any, { id: 1 }, TESTNET_PASSPHRASE)
      ).toThrow(InvalidParametersError);

      expect(() =>
        signTransactionWithPassphraseVerification({ networkPassphrase: TESTNET_PASSPHRASE } as any, { id: 1 }, TESTNET_PASSPHRASE)
      ).toThrow(InvalidParametersError);

      expect(() =>
        signTransactionWithPassphraseVerification(tx, null, TESTNET_PASSPHRASE)
      ).toThrow(InvalidParametersError);

      expect(() =>
        signTransactionWithPassphraseVerification(tx, [], TESTNET_PASSPHRASE)
      ).toThrow(InvalidParametersError);

      expect(() =>
        signTransactionWithPassphraseVerification(tx, [{ id: 1 }, null], TESTNET_PASSPHRASE)
      ).toThrow(InvalidParametersError);

      expect(sign).not.toHaveBeenCalled();
    });
  });
});
