import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { StellarRWASDK } from '../../sdk/src';
import { AssetInfo, OrderBook, Trade, Order, OrderType } from '../../sdk/src/types';
import { useToast, useErrorTranslator } from './Toast';

interface SecondaryMarketProps {
  sdk: StellarRWASDK;
  asset: AssetInfo;
  userAddress: string;
}

const SecondaryMarket: React.FC<SecondaryMarketProps> = ({ sdk, asset, userAddress }) => {
  const toast = useToast();
  const translateError = useErrorTranslator();

  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [vwap, setVwap] = useState<string>('0');
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [kycStatus, setKycStatus] = useState<boolean>(false);
  const [dividendHalt, setDividendHalt] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  const [feePreview, setFeePreview] = useState<{
    baseFee: string;
    tradingFee: string;
    totalFee: string;
    feeCurrency: string;
  } | null>(null);

  const [portfolioPnl, setPortfolioPnl] = useState<string | null>(null);

  const [lastOrderParams, setLastOrderParams] = useState<{
    side: 'buy' | 'sell';
    price: string;
    amount: string;
  } | null>(null);

  const chartData = useMemo(() => {
    if (!trades || trades.length === 0) return [];
    return trades.slice(-20).map((t) => ({
      price: parseFloat(t.fill_price || '0'),
      amount: parseFloat(t.fill_amount || '0'),
      isBuy: t.side === 'buy',
    }));
  }, [trades]);

  const chartStats = useMemo(() => {
    if (chartData.length === 0) return { min: 0, max: 0, range: 0 };
    const prices = chartData.map((d) => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return { min, max, range: max - min || 1 };
  }, [chartData]);

  const fetchMarketData = useCallback(async (showToasts: boolean = true) => {
    setFetchError(null);

    try {
      const ob = await sdk.marketClient.getOrderBook(asset.token_address);
      const tr = await sdk.marketClient.getRecentTrades(asset.token_address);
      const v = await sdk.marketClient.getVWAP(asset.token_address);
      const kyc = await sdk.complianceClient.getKYCStatus(userAddress);

      setOrderBook(ob);
      setTrades(tr);
      setVwap(v);
      setKycStatus(kyc.is_verified);
      setFetchError(null);
      setIsNetworkError(false);

      const portfolioValue = await sdk.marketClient.getMarketStats(asset.token_address).catch(() => null);
      if (portfolioValue && parseFloat(portfolioValue.avgPrice) > 0) {
        const avgPrice = parseFloat(portfolioValue.avgPrice);
        const lastPrice = tr.length > 0 ? parseFloat(tr[tr.length - 1].fill_price || '0') : avgPrice;
        const pnl = avgPrice > 0 ? ((lastPrice - avgPrice) / avgPrice) * 100 : 0;
        setPortfolioPnl(`${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`);
      } else {
        setPortfolioPnl(null);
      }
    } catch (err: any) {
      const { title, message } = translateError(err);

      if (err?.code === 'NETWORK_ERROR' || err?.message?.includes('fetch') || err?.message?.includes('Network')) {
        setIsNetworkError(true);
      }

      setFetchError(message);
      if (showToasts) {
        toast.error(title, message, () => fetchMarketData(true));
      }
    } finally {
      setIsLoadingData(false);
    }
  }, [sdk, asset, userAddress, toast, translateError]);

  const fetchFeePreview = useCallback(async () => {
    if (!price || !amount || parseFloat(price) <= 0 || parseFloat(amount) <= 0) {
      setFeePreview(null);
      return;
    }
    try {
      const fee = await sdk.marketClient.estimateTradingFee(side as OrderType, amount, price);
      setFeePreview(fee);
    } catch {
      setFeePreview(null);
    }
  }, [sdk, side, price, amount]);

  useEffect(() => {
    const timer = setTimeout(fetchFeePreview, 300);
    return () => clearTimeout(timer);
  }, [fetchFeePreview]);

  useEffect(() => {
    fetchMarketData(true);
    const interval = setInterval(() => fetchMarketData(false), 5000);
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!kycStatus) {
      toast.warning(
        'KYC Verification Required',
        'Please complete KYC verification before trading. Visit the compliance page to verify your identity.'
      );
      return;
    }
    if (dividendHalt) {
      toast.warning(
        'Trading Halted',
        'Trading is temporarily halted during the dividend record date. Trading will resume automatically.'
      );
      return;
    }

    if (!price || parseFloat(price) <= 0) {
      toast.warning('Invalid Price', 'Please enter a valid price greater than zero.');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast.warning('Invalid Amount', 'Please enter a valid amount greater than zero.');
      return;
    }

    const orderParams = { side, price, amount };
    setLastOrderParams(orderParams);
    setIsPlacingOrder(true);

    try {
      await sdk.marketClient.placeLimitOrder(
        userAddress,
        asset.token_address,
        side,
        price,
        amount,
        Math.floor(Date.now() / 1000) + 86400 * 7
      );

      toast.success(
        'Order Placed',
        `${side.toUpperCase()} order for ${amount} @ ${price} placed successfully.`
      );
      fetchMarketData();
      setPrice('');
      setAmount('');
      setLastOrderParams(null);
    } catch (err: any) {
      const { title, message } = translateError(err);
      toast.error(title, message, () => {
        if (lastOrderParams) {
          setSide(lastOrderParams.side);
          setPrice(lastOrderParams.price);
          setAmount(lastOrderParams.amount);
          handlePlaceOrder(new Event('submit') as any);
        }
      });
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const handleRetryFetch = () => {
    setIsLoadingData(true);
    fetchMarketData();
  };

  const handleSideKeyDown = (targetSide: 'buy' | 'sell') => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSide(targetSide);
    }
  };

  if (isNetworkError && !isLoadingData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-2xl">🔌</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">Network Connection Error</h3>
        <p className="text-gray-500 dark:text-gray-400 mb-4 max-w-md">
          Unable to connect to the Stellar network. Please check your internet connection and try again.
        </p>
        <button
          onClick={handleRetryFetch}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
        >
          <span className="inline-block animate-spin-slow">⟳</span>
          Retry Connection
        </button>
      </div>
    );
  }

  if (isLoadingData) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 animate-pulse rounded w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
        </div>
        <div className="h-48 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div
      className="p-5 text-gray-900 dark:text-gray-100"
      role="region"
      aria-label={`Secondary market for ${asset.symbol}`}
    >
      {statusMessage && (
        <div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>
      )}

      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-200 dark:border-gray-700 pb-4 mb-5">
        <h1 className="text-xl font-semibold">{asset.symbol} - Secondary Market</h1>
        <div className="flex items-center gap-3 mt-2 sm:mt-0 text-sm">
          <span className="text-gray-500 dark:text-gray-400" aria-label={`Volume-weighted average price: ${vwap}`}>
            VWAP: {vwap}
          </span>
          <span
            className={`font-medium ${kycStatus ? 'text-green-600' : 'text-red-500'}`}
            aria-label={`KYC status: ${kycStatus ? 'Verified' : 'Required'}`}
            role="status"
          >
            KYC: {kycStatus ? 'Verified' : 'Required'}
          </span>
          {dividendHalt && (
            <span className="bg-yellow-400 text-black px-2 py-0.5 rounded text-xs font-bold" role="alert">
              DIVIDEND HALT
            </span>
          )}
        </div>
      </header>

      {fetchError && !isNetworkError && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-700 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-red-700 dark:text-red-300 text-sm">{fetchError}</span>
          <button onClick={handleRetryFetch} className="text-red-600 hover:text-red-800 dark:text-red-300 dark:hover:text-white text-sm underline">
            Retry
          </button>
        </div>
      )}

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden" aria-label="Price chart">
          <h2 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-800">Price Chart</h2>
          <div className="relative h-72 bg-gray-50 dark:bg-gray-800 flex items-end px-2 pb-2 gap-px" role="img" aria-label={`Price chart for ${asset.symbol}`}>
            {chartData.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                No trade data available
              </div>
            ) : (
              <>
                <div className="absolute left-0 top-2 bottom-8 w-10 flex flex-col justify-between text-[10px] text-gray-400 pr-1 text-right">
                  <span>{chartStats.max.toFixed(2)}</span>
                  <span>{((chartStats.max + chartStats.min) / 2).toFixed(2)}</span>
                  <span>{chartStats.min.toFixed(2)}</span>
                </div>
                <div className="flex-1 ml-12 flex items-end gap-px h-[calc(100%-2rem)]">
                  {chartData.map((bar, i) => {
                    const heightPct = chartStats.range > 0
                      ? ((bar.price - chartStats.min) / chartStats.range) * 100
                      : 50;
                    const clampedH = Math.max(4, Math.min(100, heightPct));
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${bar.price} - ${bar.amount}`}>
                        <div
                          className={`w-full max-w-3 rounded-t-sm ${bar.isBuy ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ height: `${clampedH}%`, opacity: 0.7 + (i / chartData.length) * 0.3 }}
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div className="absolute inset-x-12 top-1/2 border-t border-dashed border-blue-400/50 pointer-events-none">
              <span className="absolute -top-3 right-0 text-[10px] text-blue-500 font-medium bg-gray-50 dark:bg-gray-800 px-1">
                VWAP {vwap}
              </span>
            </div>
          </div>
        </section>

        <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-3" aria-label="Order book depth">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Order Book</h2>
          <div className="space-y-1">
            {orderBook?.asks?.length ? orderBook.asks.map((ask, i) => (
              <div key={`ask-${i}`} className="flex justify-between px-2 py-1 text-xs rounded bg-red-50 dark:bg-red-950 border-r-2 border-red-400"
                style={{ width: `${Math.min((ask.amount / 1000) * 100, 100)}%` }}>
                <span className="text-red-600 dark:text-red-400">{ask.price}</span>
                <span className="text-gray-600 dark:text-gray-400">{ask.amount}</span>
              </div>
            )) : (
              <p className="text-xs text-gray-400 text-center py-3">No asks</p>
            )}
          </div>
          <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
          <div className="space-y-1">
            {orderBook?.bids?.length ? orderBook.bids.map((bid, i) => (
              <div key={`bid-${i}`} className="flex justify-between px-2 py-1 text-xs rounded bg-green-50 dark:bg-green-950 border-r-2 border-green-500"
                style={{ width: `${Math.min((bid.amount / 1000) * 100, 100)}%` }}>
                <span className="text-green-600 dark:text-green-400">{bid.price}</span>
                <span className="text-gray-600 dark:text-gray-400">{bid.amount}</span>
              </div>
            )) : (
              <p className="text-xs text-gray-400 text-center py-3">No bids</p>
            )}
          </div>
        </section>

        <section className="lg:col-span-2 border border-gray-200 dark:border-gray-700 rounded-lg p-4" aria-label="Place a new order">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Place Order</h2>
          <form onSubmit={handlePlaceOrder} aria-label={`Place a ${side} limit order`} noValidate>
            <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Order side">
              <button
                type="button"
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  side === 'buy'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                onClick={() => setSide('buy')}
                onKeyDown={handleSideKeyDown('buy')}
                role="radio"
                aria-checked={side === 'buy'}
              >
                BUY
              </button>
              <button
                type="button"
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  side === 'sell'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                onClick={() => setSide('sell')}
                onKeyDown={handleSideKeyDown('sell')}
                role="radio"
                aria-checked={side === 'sell'}
              >
                SELL
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <input
                type="number"
                step="any"
                placeholder="Price"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              <input
                type="number"
                step="any"
                placeholder="Amount"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            {feePreview && (
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-3 text-sm">
                <div className="font-medium text-blue-800 dark:text-blue-300 mb-1">Fee Preview</div>
                <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <div>
                    <span className="block text-gray-400">Base Fee</span>
                    <span className="font-medium">{feePreview.baseFee} {feePreview.feeCurrency}</span>
                  </div>
                  <div>
                    <span className="block text-gray-400">Trading Fee</span>
                    <span className="font-medium">{feePreview.tradingFee} {feePreview.feeCurrency}</span>
                  </div>
                  <div>
                    <span className="block text-gray-400">Total</span>
                    <span className="font-medium text-blue-700 dark:text-blue-300">{feePreview.totalFee} {feePreview.feeCurrency}</span>
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isPlacingOrder}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-lg font-bold text-sm transition-colors"
            >
              {isPlacingOrder ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block animate-spin">⟳</span>
                  Placing...
                </span>
              ) : (
                `Place ${side.toUpperCase()} Limit Order`
              )}
            </button>
          </form>
        </section>

        <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-4" aria-label="Recent trades">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Recent Trades</h2>
          {trades.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="pb-1 font-medium">Time</th>
                    <th className="pb-1 font-medium">Price</th>
                    <th className="pb-1 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => (
                    <tr key={i} className={`border-b border-gray-100 dark:border-gray-800 ${
                      trade.side === 'buy' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                    }`}>
                      <td className="py-1.5">{new Date(trade.timestamp * 1000).toLocaleTimeString()}</td>
                      <td className="py-1.5 font-medium">{trade.fill_price}</td>
                      <td className="py-1.5">{trade.fill_amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No recent trades</p>
          )}
        </section>

        <section className="lg:col-span-3 border border-gray-200 dark:border-gray-700 rounded-lg p-4" aria-label="Your portfolio">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Your Portfolio</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Holdings</label>
              <span className="text-base font-semibold" aria-label={`Holdings: ${vwap} ${asset.symbol}`}>
                {vwap} {asset.symbol}
              </span>
            </div>
            <div className="text-center">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Unrealized P&L</label>
              <span className={`text-base font-bold ${
                portfolioPnl && !portfolioPnl.startsWith('-') ? 'text-green-600' : 'text-red-500'
              }`} aria-label={`Unrealized profit and loss: ${portfolioPnl || 'N/A'}`}>
                {portfolioPnl || 'N/A'}
              </span>
            </div>
            <div className="text-center">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Active Orders</label>
              <span className="text-base font-semibold">{userOrders.length}</span>
            </div>
            <div className="text-center">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Last Trade</label>
              <span className="text-base font-semibold">
                {trades.length > 0 ? trades[trades.length - 1].fill_price : '—'}
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default SecondaryMarket;
