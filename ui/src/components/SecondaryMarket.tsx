import React, { useState, useEffect } from 'react';
import { StellarRWASDK } from '../../sdk/src';
import { AssetInfo, OrderBook, Trade, Order } from '../../sdk/src/types';

interface SecondaryMarketProps {
  sdk: StellarRWASDK;
  asset: AssetInfo;
  userAddress: string;
}

const SecondaryMarket: React.FC<SecondaryMarketProps> = ({ sdk, asset, userAddress }) => {
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [vwap, setVwap] = useState<string>('0');
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [kycStatus, setKycStatus] = useState<boolean>(false);
  const [dividendHalt, setDividendHalt] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Form State
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState<string>('');
  const [amount, setAmount] = useState<string>('');

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 5000);
    return () => clearInterval(interval);
  }, [asset]);

  const fetchMarketData = async () => {
    const ob = await sdk.marketClient.getOrderBook(asset.token_address);
    const tr = await sdk.marketClient.getRecentTrades(asset.token_address);
    const v = await sdk.marketClient.getVWAP(asset.token_address);
    const kyc = await sdk.complianceClient.getKYCStatus(userAddress);

    setOrderBook(ob);
    setTrades(tr);
    setVwap(v);
    setKycStatus(kyc.is_verified);
    // setDividendHalt(await sdk.dividendClient.isHalted(asset.token_address));
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kycStatus) {
      setStatusMessage('KYC verification required to trade.');
      return;
    }
    if (dividendHalt) {
      setStatusMessage('Trading is halted during dividend record dates.');
      return;
    }

    try {
      await sdk.marketClient.placeLimitOrder(
        userAddress,
        asset.token_address,
        side,
        price,
        amount,
        Math.floor(Date.now() / 1000) + 86400 * 7 // 7 days expiry
      );
      setStatusMessage(`${side === 'buy' ? 'Buy' : 'Sell'} order placed successfully`);
      fetchMarketData();
      setPrice('');
      setAmount('');
    } catch (err: any) {
      setStatusMessage('Failed to place order: ' + err.message);
    }
  };

  const handleSideKeyDown = (newSide: 'buy' | 'sell') => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSide(newSide);
    }
  };

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
            <div className="asks" role="list" aria-label="Ask orders">
              {orderBook?.asks.map((ask, i) => (
                <div
                  key={i}
                  className="book-row ask"
                  style={{ width: `${(ask.amount / 1000) * 100}%` }}
                  role="listitem"
                  aria-label={`Ask order: ${ask.amount} at ${ask.price}`}
                >
                  <span>{ask.price}</span>
                  <span>{ask.amount}</span>
                </div>
              )) || (
                <div className="book-row" role="listitem" aria-label="No ask orders">
                  <span>--</span>
                  <span>--</span>
                </div>
              )}
            </div>
            <div className="bids" role="list" aria-label="Bid orders">
              {orderBook?.bids.map((bid, i) => (
                <div
                  key={i}
                  className="book-row bid"
                  style={{ width: `${(bid.amount / 1000) * 100}%` }}
                  role="listitem"
                  aria-label={`Bid order: ${bid.amount} at ${bid.price}`}
                >
                  <span>{bid.price}</span>
                  <span>{bid.amount}</span>
                </div>
              )) || (
                <div className="book-row" role="listitem" aria-label="No bid orders">
                  <span>--</span>
                  <span>--</span>
                </div>
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
            <label htmlFor="order-price" className="sr-only">Price</label>
            <input
              id="order-price"
              type="number"
              step="any"
              placeholder="Price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-required="true"
              aria-label="Order price"
            />
            <label htmlFor="order-amount" className="sr-only">Amount</label>
            <input
              id="order-amount"
              type="number"
              step="any"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-required="true"
              aria-label="Order amount"
            />
            <button type="submit" className="submit-order" aria-label={`Place ${side} limit order`}>
              Place {side} Limit Order
            </button>
          </form>
        </section>

        {/* Trade History */}
        <section className="trade-history" aria-label="Recent trades">
          <h2>Recent Trades</h2>
          <div className="overflow-x-auto" role="region" aria-label="Trade history table" tabIndex={0}>
            <table role="table" aria-label="Recent trade history">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Price</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-gray-500 py-4">
                      No recent trades
                    </td>
                  </tr>
                ) : (
                  trades.map((trade, i) => (
                    <tr key={i} className={trade.side}>
                      <td>{new Date(trade.timestamp * 1000).toLocaleTimeString()}</td>
                      <td>{trade.fill_price}</td>
                      <td>{trade.fill_amount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
        .token-stats span { margin-left:15px; font-size: 14px; }
        .market-grid { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: 400px 300px; gap: 20px; }
        .price-chart { border: 1px solid #333; border-radius: 8px; overflow: hidden; position: relative; }
        .chart-placeholder { height: 100%; background: #1a1a1a; display: flex; align-items: center; justify-content: center; }
        .order-book { border: 1px solid #333; padding: 10px; }
        .book-row { display: flex; justify-content: space-between; padding: 4px; font-size: 12px; margin-bottom: 2px; }
        .book-row.ask { background: rgba(255, 0, 0, 0.1); border-right: 2px solid #ff4444; }
        .book-row.bid { background: rgba(0, 255, 0, 0.1); border-right: 2px solid #00c853; }
        .order-entry form { display: flex; flex-direction: column; gap: 10px; }
        .side-toggle { display: flex; gap: 10px; }
        .side-toggle button { flex: 1; padding: 10px; border: none; background: #333; color: #fff; cursor: pointer; border-radius: 4px; }
        .side-toggle button:focus-visible { outline: 2px solid #2962ff; outline-offset: 2px; }
        .side-toggle button.active.buy { background: #00c853; }
        .side-toggle button.active.sell { background: #ff4444; }
        input { background: #222; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 4px; }
        input:focus { outline: 2px solid #2962ff; outline-offset: 1px; }
        .submit-order { background: #2962ff; color: #fff; padding: 12px; border: none; cursor: pointer; border-radius: 4px; font-weight: bold; }
        .submit-order:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        .halt-badge { background: #ffea00; color: #000; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }
        .pnl.positive { color: #00c853; font-weight: bold; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 8px; border-bottom: 1px solid #333; }
        td { padding: 8px; border-bottom: 1px solid #222; }
        h2 { font-size: 16px; font-weight: 600; margin-bottom: 10px; color: #ccc; }
        button:focus-visible, a:focus-visible { outline: 2px solid #2962ff; outline-offset: 2px; }
      `}</style>
    </div>
  );
};

export default SecondaryMarket;
