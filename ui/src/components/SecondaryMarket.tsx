import React, { useState, useEffect, useCallback } from 'react';
import { StellarRWASDK } from '../../sdk/src';
import { AssetInfo, OrderBook, Trade, Order } from '../../sdk/src/types';
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

  // Loading states
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  // Form State
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  // Retry state
  const [lastOrderParams, setLastOrderParams] = useState<{
    side: 'buy' | 'sell';
    price: string;
    amount: string;
  } | null>(null);

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
    } catch (err: any) {
      const { title, message } = translateError(err);

      if (err?.code === 'NETWORK_ERROR' || err?.message?.includes('fetch') || err?.message?.includes('Network')) {
        setIsNetworkError(true);
      }

      setFetchError(message);
      // Only show toast on manual fetches (not interval polls) to avoid spam
      if (showToasts) {
        toast.error(title, message, () => fetchMarketData(true));
      }
    } finally {
      setIsLoadingData(false);
    }
  }, [sdk, asset, userAddress, toast, translateError]);

  useEffect(() => {
    fetchMarketData(true);
    // Use polling that doesn't show toasts on error to avoid spam
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

    // Validate form inputs before submission
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
        Math.floor(Date.now() / 1000) + 86400 * 7 // 7 days expiry
      );

      toast.success(
        'Order Placed',
        `${side.toUpperCase()} order for ${amount} @ ${price} placed successfully.`
      );
      fetchMarketData();
      // Reset form
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

  // Network error banner
  if (isNetworkError && isLoadingData === false) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-2xl">🔌</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Network Connection Error</h3>
        <p className="text-gray-500 mb-4 max-w-md">
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

  // Loading skeleton
  if (isLoadingData) {
    return (
      <div className="secondary-market-container">
        <div className="space-y-4 p-4">
          <div className="h-8 bg-gray-700 animate-pulse rounded w-1/3" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-64 bg-gray-700 animate-pulse rounded" />
            <div className="h-64 bg-gray-700 animate-pulse rounded" />
          </div>
          <div className="h-48 bg-gray-700 animate-pulse rounded" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="secondary-market-container"
      role="region"
      aria-label={`Secondary market for ${asset.symbol}`}
    >
      {/* Screen reader status announcements */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {statusMessage}
        </div>
      )}

      <header className="market-header">
        <h1>{asset.symbol} - Secondary Market</h1>
        <div className="token-stats" aria-label="Market statistics">
          <span aria-label={`Volume-weighted average price: ${vwap}`}>VWAP: {vwap}</span>
          <span
            className={`status ${kycStatus ? 'verified' : 'unverified'}`}
            aria-label={`KYC status: ${kycStatus ? 'Verified' : 'Required'}`}
            role="status"
          >
            KYC: {kycStatus ? 'Verified' : 'Required'}
          </span>
          {dividendHalt && (
            <span className="halt-badge" role="alert" aria-label="Trading halted for dividend record date">
              DIVIDEND HALT
            </span>
          )}
        </div>
      </header>

      {/* Error banner for fetch errors */}
      {fetchError && !isNetworkError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-4 flex items-center justify-between">
          <span className="text-red-200 text-sm">{fetchError}</span>
          <button
            onClick={handleRetryFetch}
            className="text-red-200 hover:text-white text-sm underline"
          >
            Retry
          </button>
        </div>
      )}

      <main className="market-grid">
        {/* Price Chart */}
        <section className="price-chart" aria-label="Price chart">
          <h2>Price Chart</h2>
          <div className="chart-placeholder" role="img" aria-label={`Price chart visualization for ${asset.symbol}. VWAP is at ${vwap}`}>
            <div className="vwap-line" style={{ top: '50%' }}>VWAP: {vwap}</div>
          </div>
        </section>

        {/* Order Book */}
        <section className="order-book" aria-label="Order book depth">
          <h2>Order Book</h2>
          <div className="depth-visualization">
            <div className="asks">
              {orderBook?.asks?.length ? orderBook.asks.map((ask, i) => (
                <div key={i} className="book-row ask" style={{ width: `${(ask.amount / 1000) * 100}%` }}>
                  <span>{ask.price}</span>
                  <span>{ask.amount}</span>
                </div>
              )) : (
                <p className="text-sm text-gray-500 text-center py-4">No asks</p>
              )}
            </div>
            <div className="bids">
              {orderBook?.bids?.length ? orderBook.bids.map((bid, i) => (
                <div key={i} className="book-row bid" style={{ width: `${(bid.amount / 1000) * 100}%` }}>
                  <span>{bid.price}</span>
                  <span>{bid.amount}</span>
                </div>
              )) : (
                <p className="text-sm text-gray-500 text-center py-4">No bids</p>
              )}
            </div>
          </div>
        </section>

        {/* Order Entry */}
        <section className="order-entry" aria-label="Place a new order">
          <h2>Place Order</h2>
          <form onSubmit={handlePlaceOrder} aria-label={`Place a ${side} limit order`} noValidate>
            <div className="side-toggle" role="radiogroup" aria-label="Order side">
              <button
                type="button"
                className={side === 'buy' ? 'active buy' : ''}
                onClick={() => setSide('buy')}
                onKeyDown={handleSideKeyDown('buy')}
                role="radio"
                aria-checked={side === 'buy'}
                aria-label="Buy order"
                tabIndex={0}
              >
                BUY
              </button>
              <button
                type="button"
                className={side === 'sell' ? 'active sell' : ''}
                onClick={() => setSide('sell')}
                onKeyDown={handleSideKeyDown('sell')}
                role="radio"
                aria-checked={side === 'sell'}
                aria-label="Sell order"
                tabIndex={0}
              >
                SELL
              </button>
            </div>
            <input
              type="number"
              step="any"
              placeholder="Price"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
            <input
              type="number"
              step="any"
              placeholder="Amount"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
            <button
              type="submit"
              className="submit-order"
              disabled={isPlacingOrder}
            >
              {isPlacingOrder ? (
                <>
                  <span className="inline-block animate-spin mr-2">⟳</span>
                  Placing...
                </>
              ) : (
                `Place ${side} Limit Order`
              )}
            </button>
          </form>
        </section>

        {/* Trade History */}
        <section className="trade-history" aria-label="Recent trades">
          <h2>Recent Trades</h2>
          {trades.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade, i) => (
                  <tr key={i} className={trade.side}>
                    <td>{new Date(trade.timestamp * 1000).toLocaleTimeString()}</td>
                    <td>{trade.fill_price}</td>
                    <td>{trade.fill_amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No recent trades</p>
          )}
        </section>

        {/* Portfolio Overview */}
        <section className="portfolio-overview" aria-label="Your portfolio">
          <h2>Your Portfolio</h2>
          <div className="portfolio-stats">
            <div className="stat">
              <label>Holdings</label>
              <span aria-label={`Holdings: ${vwap} ${asset.symbol}`}>{vwap} {asset.symbol}</span>
            </div>
            <div className="stat">
              <label>Unrealized P&L</label>
              <span className="pnl positive" aria-label="Unrealized profit and loss: +12.4%">+12.4%</span>
            </div>
          </div>
        </section>
      </main>

      <style jsx>{`
        .secondary-market-container { color: #f0f0f0; background: #121212; padding: 20px; font-family: 'Inter', sans-serif; }
        .market-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
        .market-header h1 { font-size: 1.5rem; font-weight: 600; }
        .token-stats span { margin-left: 15px; font-size: 14px; }
        .market-grid { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: 400px 300px; gap: 20px; }
        .price-chart { border: 1px solid #333; border-radius: 8px; overflow: hidden; position: relative; }
        .price-chart h2 { padding: 10px; font-size: 14px; background: #1a1a1a; color: #999; }
        .chart-placeholder { height: calc(100% - 40px); background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
        .order-book { border: 1px solid #333; padding: 10px; border-radius: 8px; }
        .order-book h2 { font-size: 14px; color: #999; margin-bottom: 10px; }
        .book-row { display: flex; justify-content: space-between; padding: 4px; font-size: 12px; margin-bottom: 2px; border-radius: 2px; }
        .book-row.ask { background: rgba(255, 0, 0, 0.1); border-right: 2px solid #ff4444; }
        .book-row.bid { background: rgba(0, 255, 0, 0.1); border-right: 2px solid #00c853; }
        .order-entry { border: 1px solid #333; padding: 15px; border-radius: 8px; }
        .order-entry h2 { font-size: 14px; color: #999; margin-bottom: 10px; }
        .order-entry form { display: flex; flex-direction: column; gap: 10px; }
        .side-toggle { display: flex; gap: 10px; }
        .side-toggle button { flex: 1; padding: 10px; border: none; background: #333; color: #fff; cursor: pointer; border-radius: 4px; transition: background 0.2s; }
        .side-toggle button:hover:not(.active) { background: #444; }
        .side-toggle button.active.buy { background: #00c853; }
        .side-toggle button.active.sell { background: #ff4444; }
        input { background: #222; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 4px; }
        input:focus { outline: none; border-color: #2962ff; }
        .submit-order { background: #2962ff; color: #fff; padding: 12px; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; transition: background 0.2s; }
        .submit-order:hover:not(:disabled) { background: #1a4fd6; }
        .submit-order:disabled { opacity: 0.6; cursor: not-allowed; }
        .trade-history { border: 1px solid #333; padding: 15px; border-radius: 8px; }
        .trade-history h2 { font-size: 14px; color: #999; margin-bottom: 10px; }
        .trade-history table { width: 100%; font-size: 12px; }
        .trade-history th { color: #999; text-align: left; padding: 4px 0; }
        .trade-history td { padding: 4px 0; border-bottom: 1px solid #222; }
        .halt-badge { background: #ffea00; color: #000; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
        .portfolio-overview { border: 1px solid #333; padding: 15px; border-radius: 8px; }
        .portfolio-overview h2 { font-size: 14px; color: #999; margin-bottom: 10px; }
        .portfolio-stats { display: flex; justify-content: space-between; }
        .stat { text-align: center; }
        .stat label { display: block; color: #999; font-size: 12px; margin-bottom: 4px; }
        .stat span { font-size: 16px; font-weight: 600; }
        .pnl.positive { color: #00c853; font-weight: bold; }
        .status.verified { color: #00c853; }
        .status.unverified { color: #ff4444; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
        .animate-spin-slow { animation: spin 1.5s linear infinite; }
      `}</style>
    </div>
  );
};

export default SecondaryMarket;
