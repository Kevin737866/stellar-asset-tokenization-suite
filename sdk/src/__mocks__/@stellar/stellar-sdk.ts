/**
 * Mock for @stellar/stellar-sdk (not an actual installed package, but imported
 * by custody.ts). Maps to the same mock as stellar-sdk.
 */
export const Horizon = {
  Server: jest.fn().mockImplementation(() => ({
    loadAccount: jest.fn().mockResolvedValue({ balances: [] }),
    submitTransaction: jest.fn().mockResolvedValue({ hash: 'testhash', ledger: 123 }),
  })),
};

export const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC: 'Public Global Stellar Network ; September 2015',
};
