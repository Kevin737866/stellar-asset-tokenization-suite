/**
 * Minimal mock of @stellar/stellar-base for Jest tests.
 */

export const TransactionBuilder = jest.fn().mockImplementation(() => ({
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue({ sign: jest.fn() }),
}));

export const Operation = {
  invokeContractFunction: jest.fn(),
  changeTrust: jest.fn(),
};

export const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC: 'Public Global Stellar Network ; September 2015',
  FUTURENET: 'Test SDF Future Network ; October 2022',
};

export const Keypair = {
  fromSecret: (secret: string) => {
    if (typeof secret !== 'string' || secret.length !== 56 || !secret.startsWith('S')) {
      throw new Error('Invalid secret key');
    }
    return {
      publicKey: () => 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
      sign: jest.fn(),
    };
  },
};

export const Asset = {
  native: () => ({ isNative: () => true }),
};

export const Account = jest.fn().mockImplementation(() => ({
  accountId: () => 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  incrementSequenceNumber: jest.fn(),
}));

export const xdr = {
  ScVal: { scvString: jest.fn() },
};

export class Server {
  loadAccount = jest.fn().mockResolvedValue({ balances: [] });
  submitTransaction = jest.fn().mockResolvedValue({ hash: 'testhash', ledger: 123 });
}
