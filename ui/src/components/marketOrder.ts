export interface MarketOrderParams {
  side: 'buy' | 'sell';
  price: string;
  amount: string;
}

export function validateMarketOrderInput(
  side: 'buy' | 'sell',
  price: string,
  amount: string
): MarketOrderParams | null {
  const parsedPrice = Number(price);
  const parsedAmount = Number(amount);
  if (
    price.trim() === '' ||
    amount.trim() === '' ||
    !Number.isFinite(parsedPrice) ||
    !Number.isFinite(parsedAmount) ||
    parsedPrice <= 0 ||
    parsedAmount <= 0
  ) {
    return null;
  }
  return { side, price, amount };
}
