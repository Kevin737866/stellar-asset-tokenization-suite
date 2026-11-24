/**
 * Tests for SecondaryMarketClient VWAP/TWAP.
 *
 * NOTE (2026-11-24, issue #397): converted from vitest to jest — this repo
 * runs jest (see jest.config.js) and vitest is not installed. Only the
 * import line and the `vi` namespace changed; fixture data and assertions
 * are untouched.
 *
 * The suite still cannot run on main: `sdk/src/secondaryMarket.ts` itself
 * does not compile under ts-jest (pre-existing stellar-sdk v12 breakage —
 * `Server` is no longer exported, `Contract` / `InvalidParametersError`
 * are not imported). Fixing the source module is a separate issue; this
 * conversion only removes the false "missing vitest" failure so the real
 * blocker is visible.
 */
import { SecondaryMarketClient } from '../secondaryMarket';

describe('SecondaryMarketClient VWAP/TWAP', () => {
  let client: SecondaryMarketClient;

  beforeEach(() => {
    client = new SecondaryMarketClient({
      stellar: { serverUrl: 'http://localhost', passphrase: 'Test SDF Network ; September 2015' },
      contracts: { secondaryMarket: 'CABC...' }
    } as any);
    (client as any).server = {
      simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: 'mock' } })
    };
    (client as any).extractScValString = jest.fn().mockReturnValue('123.45');
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
