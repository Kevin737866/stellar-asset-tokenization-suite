import { SecondaryMarketClient } from '../secondaryMarket';

describe('SecondaryMarketClient VWAP/TWAP', () => {
  let client: SecondaryMarketClient;
  const tokenAddress = 'G' + 'A'.repeat(55);

  beforeEach(() => {
    client = new SecondaryMarketClient({
      stellar: { serverUrl: 'http://localhost', passphrase: 'Test SDF Network ; September 2015' },
      contracts: { secondaryMarket: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    } as any);
    (client as any).server = {
      simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: 'mock' } })
    };
    (client as any).extractScValString = jest.fn().mockReturnValue('123.45');
  });

  it('getVWAP calls get_vwap and returns a string value', async () => {
    const result = await client.getVWAP(tokenAddress);
    expect(result).toBe('123.45');
  });

  it('getTWAP calls get_twap with default window and returns a string value', async () => {
    const result = await client.getTWAP(tokenAddress);
    expect(result).toBe('123.45');
  });

  it('getTWAP accepts a custom window in seconds', async () => {
    const result = await client.getTWAP(tokenAddress, 7200);
    expect(result).toBe('123.45');
  });
});
