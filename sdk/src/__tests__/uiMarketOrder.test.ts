import { validateMarketOrderInput } from '../../../ui/src/components/marketOrder';

describe('Secondary market order input validation', () => {
  it('accepts positive buy and sell values', () => {
    expect(validateMarketOrderInput('buy', '12.5', '3')).toEqual({
      side: 'buy',
      price: '12.5',
      amount: '3',
    });
    expect(validateMarketOrderInput('sell', '0.01', '0.5')?.side).toBe('sell');
  });

  it.each([
    ['zero price', '0', '3'],
    ['negative price', '-1', '3'],
    ['zero amount', '12', '0'],
    ['negative amount', '12', '-3'],
    ['nonnumeric price', 'NaN', '3'],
    ['nonnumeric amount', '12', 'Infinity'],
    ['empty price', '', '3'],
    ['empty amount', '12', '  '],
  ])('rejects %s', (_label, price, amount) => {
    expect(validateMarketOrderInput('buy', price, amount)).toBeNull();
  });
});
