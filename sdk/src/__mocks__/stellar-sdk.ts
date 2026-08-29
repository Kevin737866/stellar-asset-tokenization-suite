/**
 * Minimal mock of stellar-sdk for Jest tests.
 * Used via moduleNameMapper to avoid ts-jest compiling the full stellar-sdk
 * type graph (which causes OOM in constrained CI environments).
 */

// Asset supports both Asset.native() and new Asset(code, issuer)
export class Asset {
  private _code: string;
  private _issuer: string;
  private _native: boolean;

  constructor(code: string, issuer: string) {
    this._code = code;
    this._issuer = issuer;
    this._native = false;
  }

  static native() {
    const a = new Asset('XLM', '');
    a._native = true;
    return a;
  }

  isNative() { return this._native; }
  getCode() { return this._code; }
  getIssuer() { return this._issuer; }
}

export class LiquidityPoolAsset {
  constructor(public assetA: any, public assetB: any, public fee: number) {}
}

export const Operation = {
  changeTrust: jest.fn(),
  liquidityPoolDeposit: jest.fn(),
};

export const TransactionBuilder = jest.fn().mockImplementation(() => ({
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue({ sign: jest.fn() }),
}));

export const Keypair = {
  fromSecret: (secret: string) => {
    // Stellar secret keys start with 'S' and are 56 chars
    if (typeof secret !== 'string' || secret.length !== 56 || !secret.startsWith('S')) {
      throw new Error('Invalid secret key');
    }
    return {
      publicKey: () => 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      sign: jest.fn(),
    };
  },
};

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

export const getLiquidityPoolId = jest.fn().mockReturnValue({
  toString: () => 'mock-pool-id',
});
