
import { DividendClient } from '../dividendClient';

jest.mock('stellar-sdk', () => ({
  ...jest.requireActual('stellar-sdk'),
  Server: jest.fn(() => ({})),
  Address: jest.fn((value: string) => ({
    toString: () => value,
    toScVal: () => ({}),
  })),
  Contract: jest.fn(() => ({})),
  TransactionBuilder: jest.fn(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn(() => ({})),
  })),
}));

const VALID_ADDRESS = 'GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG';

describe('DividendClient.claimAllDividends', () => {
  let client: DividendClient;
  let mockContractCall: any;
  let mockServer: any;

  beforeEach(() => {
    mockContractCall = jest.fn().mockReturnValue({ toXDR: () => 'mock-op-xdr' });
    mockServer = {
      getAccount: jest.fn().mockResolvedValue({ accountId: () => 'GABC...' }),
      sendTransaction: jest.fn()
    };
    client = new DividendClient({
      stellar: {
        serverUrl: 'http://localhost:8000',
        passphrase: 'Test SDF Network ; September 2015',
      },
      contracts: {
        dividendDistributor: 'GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG',
      }
    } as any);
    (client as any).contract = { call: mockContractCall };
    (client as any).server = mockServer;
    (client as any).signTransaction = jest.fn().mockResolvedValue('signed-tx');
    (client as any).extractClaimedAmounts = jest.fn();
  });

  it('claims full batch: returns claimed amount for every distribution', async () => {
    (client as any).extractClaimedAmounts.mockReturnValue([100, 200, 300]);
    mockServer.sendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'tx1' });

    const result = await client.claimAllDividends(VALID_ADDRESS as any);

    expect(mockContractCall).toHaveBeenCalledWith('claim_all_dividends', expect.anything());
    expect(result.claimedAmounts).toEqual([100, 200, 300]);
    expect(result.transactionHash).toBe('tx1');
  });

  it('claims partial batch: some distributions already claimed or expired return 0', async () => {
    (client as any).extractClaimedAmounts.mockReturnValue([150, 0, 0, 400]);
    mockServer.sendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'tx2' });

    const result = await client.claimAllDividends(VALID_ADDRESS as any);

    expect(result.claimedAmounts).toEqual([150, 0, 0, 400]);
    expect(result.claimedAmounts.filter((a: number) => a === 0).length).toBe(2);
  });

  it('claims empty batch: no eligible distributions returns empty array', async () => {
    (client as any).extractClaimedAmounts.mockReturnValue([]);
    mockServer.sendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'tx3' });

    const result = await client.claimAllDividends(VALID_ADDRESS as any);

    expect(result.claimedAmounts).toEqual([]);
  });

  it('throws when the transaction fails', async () => {
    mockServer.sendTransaction.mockResolvedValue({ status: 'ERROR', error: 'boom' });

    await expect(client.claimAllDividends(VALID_ADDRESS as any)).rejects.toThrow();
  });
});
