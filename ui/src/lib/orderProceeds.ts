import BigNumber from 'bignumber.js';

export type OrderSide = 'buy' | 'sell';

/**
 * Fee estimate returned by `marketClient.estimateTradingFee`.
 *
 * `tradingFee` is charged by the market in the order's quote currency, while
 * `baseFee` is the Stellar network fee denominated in `feeCurrency`.
 */
export interface OrderFeeEstimate {
  baseFee?: string;
  tradingFee?: string;
  feeCurrency?: string;
}

export interface OrderProceeds {
  side: OrderSide;
  /** price * amount, denominated in the quote currency. */
  grossValue: string;
  /** Trading fee charged by the market, in the quote currency. */
  tradingFee: string;
  /** Sell: grossValue - tradingFee, clamped at zero. Buy: grossValue - tradingFee. */
  netProceeds: string;
  /** Buy: grossValue + tradingFee. Sell: grossValue + tradingFee. */
  totalCost: string;
  /** Network fee reported by the SDK, denominated in `feeCurrency`. */
  networkFee: string;
  /** Currency of the network fee (e.g. XLM). */
  feeCurrency: string;
  /** False when no usable trading fee was available and zero was assumed. */
  feeEstimateAvailable: boolean;
}

const DEFAULT_FEE_CURRENCY = 'XLM';
// Only plain non-negative decimals: rejects "", "-1", "1e9", "NaN" and "1,5".
const DECIMAL_PATTERN = /^\d*(\.\d*)?$/;

function parseDecimal(value?: string | null): BigNumber | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || !DECIMAL_PATTERN.test(trimmed)) return null;

  const parsed = new BigNumber(trimmed);
  if (!parsed.isFinite() || parsed.isNegative()) return null;
  return parsed;
}

/**
 * Builds the amounts shown in the order preview before an order is submitted.
 *
 * Returns `null` when the price or amount is not a positive decimal, so callers
 * can hide the preview instead of rendering misleading numbers. A missing or
 * malformed trading fee is treated as zero and flagged via
 * `feeEstimateAvailable` rather than blocking the preview.
 */
export function calculateOrderProceeds(
  side: OrderSide,
  price: string,
  amount: string,
  fee: OrderFeeEstimate | null
): OrderProceeds | null {
  const priceValue = parseDecimal(price);
  const amountValue = parseDecimal(amount);

  if (!priceValue || !amountValue || priceValue.isZero() || amountValue.isZero()) {
    return null;
  }

  const grossValue = priceValue.multipliedBy(amountValue);
  const parsedTradingFee = parseDecimal(fee?.tradingFee);
  const feeEstimateAvailable = parsedTradingFee !== null;
  const tradingFee = parsedTradingFee ?? new BigNumber(0);
  const networkFee = parseDecimal(fee?.baseFee) ?? new BigNumber(0);
  const feeCurrency = fee?.feeCurrency?.trim() || DEFAULT_FEE_CURRENCY;

  return {
    side,
    grossValue: grossValue.toFixed(),
    tradingFee: tradingFee.toFixed(),
    netProceeds: BigNumber.max(grossValue.minus(tradingFee), 0).toFixed(),
    totalCost: grossValue.plus(tradingFee).toFixed(),
    networkFee: networkFee.toFixed(),
    feeCurrency,
    feeEstimateAvailable,
  };
}

/**
 * Formats an amount for display: two decimals with thousands separators, while
 * keeping up to seven decimals for small values so sub-cent amounts do not
 * collapse to "0.00".
 */
export function formatQuoteAmount(value: string, decimals: number = 2): string {
  const parsed = new BigNumber(value);
  if (!parsed.isFinite()) return value;
  if (parsed.isZero()) return parsed.toFixed(decimals);
  if (parsed.abs().lt(0.01)) return parsed.toFormat(Math.max(decimals, 7));
  return parsed.toFormat(decimals);
}
