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

export const SorobanRpc = {
  Server: jest.fn().mockImplementation(() => ({
    simulateTransaction: jest.fn(),
  })),
};

export class Address {
  constructor(private readonly value: string) {}
  toString(): string {
    return this.value;
  }
  toScVal(): unknown {
    return { address: this.value };
  }
}

export class Contract {
  constructor(public readonly contractId: string) {}
  call(method: string, ...args: unknown[]): unknown {
    return { method, args };
  }
}

export class ScInt {
  constructor(public readonly value: number | string) {}
  toU64(): unknown {
    return { u64: String(this.value) };
  }
}

export class TransactionBuilder {
  constructor(_account: unknown, _options: unknown) {}
  addOperation(_operation: unknown): this {
    return this;
  }
  setTimeout(_timeout: number): this {
    return this;
  }
  build(): unknown {
    return { sign: jest.fn() };
  }
}

export const scValToNative = jest.fn().mockImplementation((value: unknown) => value);
export const nativeToScVal = jest.fn().mockImplementation((value: unknown) => value);
export const xdr = {
  ScVal: {
    scvSymbol: (value: string) => ({ symbol: value }),
  },
};
