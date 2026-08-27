/**
 * Unit tests for TokenClient allowance management methods.
 * Issue #204: Add token allowance management methods to SDK.
 *
 * Covers:
 *  - approve(owner, spender, amount)
 *  - allowance(owner, spender) query
 *  - transferFrom(spender, from, to, amount)
 *  - increaseAllowance / decreaseAllowance convenience helpers
 *  - parseAllowanceEvent
 *  - Insufficient allowance error path
 */

// ─── Module mocks (must be before imports) ───────────────────────────────────

// stellar-sdk v12 exports Server under rpc.Server; Contract and TransactionBuilder
// need real Stellar objects to construct — mock them all for unit tests.
jest.mock('stellar-sdk', () => {
  const original = jest.requireActual('stellar-sdk');

  /** A stub Account returned by getAccount mocks */
  class MockAccount {
    constructor(public id: string, public sequence: string) {}
    sequenceNumber() { return this.sequence; }
    incrementSequenceNumber() {}
    accountId() { return this.id; }
  }

  /** A no-op TransactionBuilder that produces a stub transaction object */
  class MockTransactionBuilder {
    constructor(_account: any, _opts: any) {}
    addOperation(_op: any) { return this; }
    setTimeout(_t: any) { return this; }
    build() { return { sign: jest.fn(), toEnvelope: jest.fn(() => ({ toXDR: jest.fn() })) }; }
  }

  /** A no-op Server stub — tests replace via (client as any).server */
  class MockServer {
    constructor(_url: string) {}
    getAccount = jest.fn().mockResolvedValue(new MockAccount('MOCK', '1'));
    sendTransaction = jest.fn().mockResolvedValue({ hash: 'mock-tx-hash', status: 'PENDING' });
  }

  /** A no-op Contract that accepts any string as a contractId */
  class MockContract {
    constructor(_id: string) {}
    call = jest.fn().mockResolvedValue({ result: '0' });
    address() { return { toString: () => 'MOCK_CONTRACT' }; }
  }

  /** Stub Operation for contract calls */
  const MockOperation = { invokeHostFunction: jest.fn().mockReturnValue({}) };

  return {
    ...original,
    rpc: { ...original.rpc, Server: MockServer },
    Contract: MockContract,
    TransactionBuilder: MockTransactionBuilder,
    // scValToNative is called on contract results; since our mocks return plain values,
    // we make scValToNative an identity function so it just returns whatever the mock gave.
    scValToNative: (val: any) => val,
  };
});

import { TokenClient } from '../tokenClient';
import { Address } from 'stellar-sdk';
import { ErrorCode } from '../types';
import { RWASDKConfig } from '../types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Valid Stellar G-addresses for test actors. */
const OWNER_ADDRESS = 'GCP4HKHRT6KE7U32FCUBDIFHEFGFZ4QINKWPO6ZPK6KTX7BDEYFNZAXL';
const SPENDER_ADDRESS = 'GA6VH5DJME6FPKNDMRFYHQHCYVFUFOTFWGMMRFKRYTNOG573AHOGLTCV';
const RECIPIENT_ADDRESS = 'GD752SDAXMNRK7JXT6B7LGUQJGPXE5XBUZWD3ADNELTU6OXL2WKZWUDW';
const TOKEN_ADDRESS = 'GDQVEC4B2CQKM2FPZBDKHEWBMJC5FW3ULFIYSPYMQIUQXCGPEXJUNHTJ';

const CONTRACT_ADDRESS = 'GD752SDAXMNRK7JXT6B7LGUQJGPXE5XBUZWD3ADNELTU6OXL2WKZWUDW';

const mockConfig: RWASDKConfig = {
  stellar: {
    network: 'testnet',
    serverUrl: 'https://horizon-testnet.stellar.org',
    passphrase: 'Test SDF Network ; September 2015',
    // secretKey injected so signTransaction succeeds without external wallet
    secretKey: 'SAVBY3HZ4ZVNYMZWGRWVDR5ODLZIBAGKINVN2XPBJRPM45TUBJQAWTRC',
  } as any,
  contracts: {
    assetFactory: CONTRACT_ADDRESS as unknown as Address,
    complianceRegistry: CONTRACT_ADDRESS as unknown as Address,
    dividendDistributor: CONTRACT_ADDRESS as unknown as Address,
    secondaryMarket: CONTRACT_ADDRESS as unknown as Address,
    custodyValidator: CONTRACT_ADDRESS as unknown as Address,
  },
  defaultFeeRate: 100,
};

/**
 * Build a TokenClient with mocked Stellar-SDK internals.
 * The module mock (above) replaces Server, Contract, and TransactionBuilder.
 * We then grab references to those mocks to set per-test return values.
 */
function buildClient() {
  const client = new TokenClient(mockConfig, TOKEN_ADDRESS as unknown as Address);

  // The mocked Server and Contract instances are already installed by the module mock.
  // We re-assign them here to easy-to-control jest.fn() versions so each test can
  // configure return values without cross-test pollution.
  const mockContractCall = jest.fn().mockResolvedValue({ result: '0' });
  const mockContract = { call: mockContractCall };

  const mockSendTransaction = jest.fn().mockResolvedValue({
    hash: 'mock-tx-hash',
    status: 'PENDING',
  });
  const mockServer = {
    getAccount: jest.fn().mockResolvedValue({ id: OWNER_ADDRESS, sequence: '1', sequenceNumber: () => '1', incrementSequenceNumber: () => {} }),
    sendTransaction: mockSendTransaction,
  };

  (client as any).server = mockServer;
  (client as any).contract = mockContract;

  return { client, mockServer, mockContract, mockContractCall };
}

// ─── approve ─────────────────────────────────────────────────────────────────

describe('TokenClient.approve', () => {
  it('submits an approve transaction and returns the tx hash', async () => {
    const { client, mockServer, mockContractCall } = buildClient();

    const hash = await client.approve(
      OWNER_ADDRESS as unknown as Address,
      SPENDER_ADDRESS as unknown as Address,
      '1000'
    );

    expect(hash).toBe('mock-tx-hash');
    expect(mockContractCall).toHaveBeenCalledWith(
      'approve',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('forwards the expirationLedger option to the contract call', async () => {
    const { client, mockContractCall } = buildClient();

    await client.approve(
      OWNER_ADDRESS as unknown as Address,
      SPENDER_ADDRESS as unknown as Address,
      '500',
      { expirationLedger: 9999 }
    );

    expect(mockContractCall).toHaveBeenCalledTimes(1);
    expect(mockContractCall.mock.calls[0][0]).toBe('approve');
  });

  it('throws on invalid owner address', async () => {
    const { client } = buildClient();

    await expect(
      client.approve(
        'INVALID' as unknown as Address,
        SPENDER_ADDRESS as unknown as Address,
        '100'
      )
    ).rejects.toThrow();
  });

  it('throws on invalid spender address', async () => {
    const { client } = buildClient();

    await expect(
      client.approve(
        OWNER_ADDRESS as unknown as Address,
        'BAD_SPENDER' as unknown as Address,
        '100'
      )
    ).rejects.toThrow();
  });

  it('throws on invalid (negative) amount', async () => {
    const { client } = buildClient();

    await expect(
      client.approve(
        OWNER_ADDRESS as unknown as Address,
        SPENDER_ADDRESS as unknown as Address,
        '-50'
      )
    ).rejects.toThrow();
  });

  it('wraps network ERROR status into a TransactionError', async () => {
    const { client, mockServer } = buildClient();
    mockServer.sendTransaction.mockResolvedValueOnce({
      hash: 'err-hash',
      status: 'ERROR',
      error: 'bad_op',
    });

    await expect(
      client.approve(
        OWNER_ADDRESS as unknown as Address,
        SPENDER_ADDRESS as unknown as Address,
        '100'
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('Transaction failed') });
  });
});

// ─── allowance ───────────────────────────────────────────────────────────────

describe('TokenClient.allowance', () => {
  it('queries the contract and returns the allowance as a string', async () => {
    const { client, mockContractCall } = buildClient();
    // Simulate contract returning a plain string result (post-scValToNative)
    mockContractCall.mockResolvedValueOnce({ result: '5000' });

    const amount = await client.allowance(
      OWNER_ADDRESS as unknown as Address,
      SPENDER_ADDRESS as unknown as Address
    );

    expect(mockContractCall).toHaveBeenCalledWith(
      'allowance',
      expect.anything(),
      expect.anything()
    );
    expect(typeof amount).toBe('string');
  });

  it('returns "0" when the contract result is null', async () => {
    const { client, mockContractCall } = buildClient();
    mockContractCall.mockResolvedValueOnce({ result: null });

    const amount = await client.allowance(
      OWNER_ADDRESS as unknown as Address,
      SPENDER_ADDRESS as unknown as Address
    );

    expect(amount).toBe('0');
  });

  it('throws on invalid owner address', async () => {
    const { client } = buildClient();

    await expect(
      client.allowance('BAD' as unknown as Address, SPENDER_ADDRESS as unknown as Address)
    ).rejects.toThrow();
  });

  it('throws on invalid spender address', async () => {
    const { client } = buildClient();

    await expect(
      client.allowance(OWNER_ADDRESS as unknown as Address, 'BAD' as unknown as Address)
    ).rejects.toThrow();
  });
});

// ─── transferFrom ─────────────────────────────────────────────────────────────

describe('TokenClient.transferFrom', () => {
  it('executes a delegated transfer when allowance is sufficient', async () => {
    const { client, mockServer, mockContractCall } = buildClient();

    // allowance query returns 2000 (> 1000 requested)
    mockContractCall.mockResolvedValueOnce({ result: '2000' });
    // transfer_from contract call returns an op object
    mockContractCall.mockResolvedValueOnce({});

    const hash = await client.transferFrom(
      SPENDER_ADDRESS as unknown as Address,
      OWNER_ADDRESS as unknown as Address,
      RECIPIENT_ADDRESS as unknown as Address,
      '1000'
    );

    expect(hash).toBe('mock-tx-hash');
    // First call: allowance check; Second call: transfer_from
    expect(mockContractCall.mock.calls[0][0]).toBe('allowance');
    expect(mockContractCall.mock.calls[1][0]).toBe('transfer_from');
    expect(mockServer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('throws INSUFFICIENT_ALLOWANCE when allowance is too low', async () => {
    const { client, mockContractCall } = buildClient();

    // Return allowance of 50, requesting 1000
    mockContractCall.mockResolvedValueOnce({ result: '50' });

    await expect(
      client.transferFrom(
        SPENDER_ADDRESS as unknown as Address,
        OWNER_ADDRESS as unknown as Address,
        RECIPIENT_ADDRESS as unknown as Address,
        '1000'
      )
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ALLOWANCE });
  });

  it('throws when spender address is invalid', async () => {
    const { client } = buildClient();

    await expect(
      client.transferFrom(
        'BAD' as unknown as Address,
        OWNER_ADDRESS as unknown as Address,
        RECIPIENT_ADDRESS as unknown as Address,
        '100'
      )
    ).rejects.toThrow();
  });

  it('throws when amount is invalid', async () => {
    const { client } = buildClient();

    await expect(
      client.transferFrom(
        SPENDER_ADDRESS as unknown as Address,
        OWNER_ADDRESS as unknown as Address,
        RECIPIENT_ADDRESS as unknown as Address,
        'not-a-number'
      )
    ).rejects.toThrow();
  });

  it('wraps network ERROR into TransactionError after successful allowance check', async () => {
    const { client, mockServer, mockContractCall } = buildClient();

    // Sufficient allowance
    mockContractCall.mockResolvedValueOnce({ result: '9999' });
    mockServer.sendTransaction.mockResolvedValueOnce({
      hash: 'h',
      status: 'ERROR',
      error: 'fee_too_low',
    });

    await expect(
      client.transferFrom(
        SPENDER_ADDRESS as unknown as Address,
        OWNER_ADDRESS as unknown as Address,
        RECIPIENT_ADDRESS as unknown as Address,
        '100'
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('Transaction failed') });
  });
});

// ─── increaseAllowance ────────────────────────────────────────────────────────

describe('TokenClient.increaseAllowance', () => {
  it('queries current allowance and calls approve with current + addedAmount', async () => {
    const { client, mockContractCall } = buildClient();

    // allowance query returns 1000
    mockContractCall.mockResolvedValueOnce({ result: '1000' });
    // approve contract call
    mockContractCall.mockResolvedValueOnce({});

    await client.increaseAllowance(
      OWNER_ADDRESS as unknown as Address,
      SPENDER_ADDRESS as unknown as Address,
      '500'
    );

    expect(mockContractCall).toHaveBeenNthCalledWith(
      1,
      'allowance',
      expect.anything(),
      expect.anything()
    );
    expect(mockContractCall).toHaveBeenNthCalledWith(
      2,
      'approve',
      expect.anything(),
      expect.anything(),
      expect.anything(), // ScInt('1500')
      expect.anything()
    );
  });

  it('works correctly from a zero allowance baseline', async () => {
    const { client, mockContractCall } = buildClient();

    // Current allowance is 0
    mockContractCall.mockResolvedValueOnce({ result: '0' });
    mockContractCall.mockResolvedValueOnce({});

    await client.increaseAllowance(
      OWNER_ADDRESS as unknown as Address,
      SPENDER_ADDRESS as unknown as Address,
      '300'
    );

    expect(mockContractCall).toHaveBeenNthCalledWith(
      2,
      'approve',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('throws on invalid addedAmount', async () => {
    const { client } = buildClient();

    await expect(
      client.increaseAllowance(
        OWNER_ADDRESS as unknown as Address,
        SPENDER_ADDRESS as unknown as Address,
        '0'
      )
    ).rejects.toThrow();
  });
});

// ─── decreaseAllowance ────────────────────────────────────────────────────────

describe('TokenClient.decreaseAllowance', () => {
  it('subtracts subtractedAmount from current allowance and calls approve', async () => {
    const { client, mockContractCall } = buildClient();

    // Current allowance: 2000
    mockContractCall.mockResolvedValueOnce({ result: '2000' });
    mockContractCall.mockResolvedValueOnce({});

    await client.decreaseAllowance(
      OWNER_ADDRESS as unknown as Address,
      SPENDER_ADDRESS as unknown as Address,
      '800'
    );

    expect(mockContractCall).toHaveBeenNthCalledWith(
      1,
      'allowance',
      expect.anything(),
      expect.anything()
    );
    expect(mockContractCall).toHaveBeenNthCalledWith(
      2,
      'approve',
      expect.anything(),
      expect.anything(),
      expect.anything(), // ScInt('1200')
      expect.anything()
    );
  });

  it('throws INVALID_ALLOWANCE_AMOUNT when subtracting more than current allowance', async () => {
    const { client, mockContractCall } = buildClient();

    // Current allowance: 100; requesting to subtract 500
    mockContractCall.mockResolvedValueOnce({ result: '100' });

    await expect(
      client.decreaseAllowance(
        OWNER_ADDRESS as unknown as Address,
        SPENDER_ADDRESS as unknown as Address,
        '500'
      )
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ALLOWANCE_AMOUNT });
  });

  it('allows decreasing the allowance to exactly zero', async () => {
    const { client, mockContractCall } = buildClient();

    // Exact cancellation
    mockContractCall.mockResolvedValueOnce({ result: '1000' });
    mockContractCall.mockResolvedValueOnce({});

    await expect(
      client.decreaseAllowance(
        OWNER_ADDRESS as unknown as Address,
        SPENDER_ADDRESS as unknown as Address,
        '1000'
      )
    ).resolves.toBe('mock-tx-hash');
  });
});

// ─── parseAllowanceEvent ──────────────────────────────────────────────────────

describe('TokenClient.parseAllowanceEvent', () => {
  let client: TokenClient;

  beforeEach(() => {
    ({ client } = buildClient());
  });

  it('parses an approve event', () => {
    const raw = {
      type: 'contract',
      contractId: TOKEN_ADDRESS,
      topics: ['approve', OWNER_ADDRESS, SPENDER_ADDRESS],
      data: '5000',
    };

    const parsed = client.parseAllowanceEvent(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.eventType).toBe('approve');
    expect(parsed!.owner).toBe(OWNER_ADDRESS);
    expect(parsed!.spender).toBe(SPENDER_ADDRESS);
    expect(parsed!.amount).toBe('5000');
  });

  it('parses a transfer_from event', () => {
    const raw = {
      type: 'contract',
      contractId: TOKEN_ADDRESS,
      topics: ['transfer_from', SPENDER_ADDRESS, OWNER_ADDRESS, RECIPIENT_ADDRESS],
      data: '250',
    };

    const parsed = client.parseAllowanceEvent(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.eventType).toBe('transfer_from');
    expect(parsed!.spender).toBe(SPENDER_ADDRESS);
    expect(parsed!.from).toBe(OWNER_ADDRESS);
    expect(parsed!.to).toBe(RECIPIENT_ADDRESS);
    expect(parsed!.amount).toBe('250');
  });

  it('returns null for an unrecognised event type', () => {
    const raw = {
      type: 'contract',
      contractId: TOKEN_ADDRESS,
      topics: ['mint', OWNER_ADDRESS],
      data: '100',
    };

    expect(client.parseAllowanceEvent(raw)).toBeNull();
  });

  it('returns null for an empty topics array', () => {
    const raw = { type: 'contract', topics: [], data: null };
    expect(client.parseAllowanceEvent(raw)).toBeNull();
  });

  it('defaults amount to "0" when event data is null', () => {
    const raw = {
      type: 'contract',
      topics: ['approve', OWNER_ADDRESS, SPENDER_ADDRESS],
      data: null,
    };

    const parsed = client.parseAllowanceEvent(raw);
    expect(parsed!.amount).toBe('0');
  });
});
