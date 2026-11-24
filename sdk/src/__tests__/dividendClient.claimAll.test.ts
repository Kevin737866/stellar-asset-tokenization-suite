/**
 * Tests for DividendClient.claimAllDividends.
 *
 * NOTE (2026-11-24, issue #397): converted from vitest to jest — this repo
 * runs jest (see jest.config.js) and vitest is not installed. Only the
 * import line, the `vi` namespace, and one type cast changed (the mocked
 * claimed amounts are numbers, so the `.filter((a: number) => ...)` line
 * needs `(result.claimedAmounts as unknown as number[])` to type-check
 * under ts-jest); fixture data and assertions are untouched.
 *
 * The suite still cannot run on main: `sdk/src/dividendClient.ts` itself
 * does not compile under ts-jest (pre-existing stellar-sdk v12 breakage —
 * `Server` is no longer exported, `validateFutureDate` is not exported by
 * `./validation`, `ScVal` API renames). Fixing the source module is a
 * separate issue; this conversion only removes the false "missing vitest"
 * failure so the real blocker is visible.
 */
import { DividendClient } from '../dividendClient';

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
      stellar: { passphrase: 'Test SDF Network ; September 2015', rpcUrl: 'http://localhost' },
      contractAddress: 'CABC...'
    } as any);
    (client as any).contract = { call: mockContractCall };
    (client as any).server = mockServer;
    (client as any).signTransaction = jest.fn().mockResolvedValue('signed-tx');
    (client as any).extractClaimedAmounts = jest.fn();
  });

  it('claims full batch: returns claimed amount for every distribution', async () => {
    (client as any).extractClaimedAmounts.mockReturnValue([100, 200, 300]);
    mockServer.sendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'tx1' });

    const result = await client.claimAllDividends('GCLAIMER...' as any);

    expect(mockContractCall).toHaveBeenCalledWith('claim_all_dividends', expect.anything());
    expect(result.claimedAmounts).toEqual([100, 200, 300]);
    expect(result.transactionHash).toBe('tx1');
  });

  it('claims partial batch: some distributions already claimed or expired return 0', async () => {
    (client as any).extractClaimedAmounts.mockReturnValue([150, 0, 0, 400]);
    mockServer.sendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'tx2' });

    const result = await client.claimAllDividends('GCLAIMER...' as any);

    expect(result.claimedAmounts).toEqual([150, 0, 0, 400]);
    expect((result.claimedAmounts as unknown as number[]).filter((a: number) => a === 0).length).toBe(2);
  });

  it('claims empty batch: no eligible distributions returns empty array', async () => {
    (client as any).extractClaimedAmounts.mockReturnValue([]);
    mockServer.sendTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'tx3' });

    const result = await client.claimAllDividends('GCLAIMER...' as any);

    expect(result.claimedAmounts).toEqual([]);
  });

  it('throws when the transaction fails', async () => {
    mockServer.sendTransaction.mockResolvedValue({ status: 'ERROR', error: 'boom' });

    await expect(client.claimAllDividends('GCLAIMER...' as any)).rejects.toThrow();
  });
});
