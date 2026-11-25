
import { SecondaryMarketClient } from '../secondaryMarket';

jest.mock('stellar-sdk', () => ({
  ...jest.requireActual('stellar-sdk'),
  Server: jest.fn(() => ({})),
  Address: jest.fn((value: string) => ({
    toString: () => value,
    toScVal: () => ({}),
  })),
}));

describe('SecondaryMarketClient VWAP/TWAP', () => {
  let client: SecondaryMarketClient;

  beforeEach(() => {
    client = new SecondaryMarketClient({
      stellar: { serverUrl: 'http://localhost:8000', passphrase: 'Test SDF Network ; September 2015' },
      contracts: {
        secondaryMarket: 'GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG',
      }
    } as any);
    (client as any).server = {
      simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: 'mock' } })
    };
    (client as any).extractScValString = jest.fn().mockReturnValue('123.45');
    (client as any).handleError = (error: unknown) => error;
    (global as any).Contract = jest.fn(() => ({ call: jest.fn(() => ({})) }));
    (global as any).ScInt = jest.fn(() => ({ toU64: jest.fn(() => ({})) }));
  });

  it('getVWAP calls get_vwap and returns a string value', async () => {
    const result = await client.getVWAP('GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG' as any);
    expect(result).toBe('123.45');
  });

  it('getTWAP calls get_twap with default window and returns a string value', async () => {
    const result = await client.getTWAP('GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG' as any);
    expect(result).toBe('123.45');
  });

  it('getTWAP accepts a custom window in seconds', async () => {
    const result = await client.getTWAP('GAVH5LQMWGR3A7ST3A4K7FOHXHLKX4GJJADBSKSEJW5E4MFE5DXG4CJG' as any, 7200);
    expect(result).toBe('123.45');
  });
});
