import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecondaryMarketClient } from '../secondaryMarket';

describe('SecondaryMarketClient VWAP/TWAP', () => {
  let client: SecondaryMarketClient;

  beforeEach(() => {
    client = new SecondaryMarketClient({
      stellar: { serverUrl: 'http://localhost', passphrase: 'Test SDF Network ; September 2015' },
      contracts: { secondaryMarket: 'CABC...' }
    } as any);
    (client as any).server = {
      simulateTransaction: vi.fn().mockResolvedValue({ result: { retval: 'mock' } })
    };
    (client as any).extractScValString = vi.fn().mockReturnValue('123.45');
  });

  it('getVWAP calls get_vwap and returns a string value', async () => {
    const result = await client.getVWAP('GTOKEN...' as any);
    expect(result).toBe('123.45');
  });

  it('getTWAP calls get_twap with default window and returns a string value', async () => {
    const result = await client.getTWAP('GTOKEN...' as any);
    expect(result).toBe('123.45');
  });

  it('getTWAP accepts a custom window in seconds', async () => {
    const result = await client.getTWAP('GTOKEN...' as any, 7200);
    expect(result).toBe('123.45');
  });
});
