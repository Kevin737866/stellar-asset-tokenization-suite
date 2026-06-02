# Soroban Contract: Secondary Market

Source: `src/secondary_market.rs`

## Overview
SecondaryMarket implements an order book for peer-to-peer trading of RWA tokens.

It supports:
- initializing market config
- creating buy/sell orders with escrow
- filling orders
- canceling orders
- tracking VWAP/TWAP-like aggregates
- enforcing compliance checks and trading halts (placeholder)

## Data types
- `MarketError`
- `Order` (side buy/sell, price, amount, filled amount, expiry, etc.)
- `Trade`
- `MarketConfig`
- `DataKey` (storage key variants)

## Public entry points

### `initialize(env: Env, admin: Address, base_currency: Address, compliance_registry: Address, dividend_distributor: Address, fee_rate_bps: i64, min_order_size: i128, max_price_deviation_bps: i64)`
Initializes market storage.

### `migrate(env: Env, auth: Address)`
Admin migration.

### `update_config(env: Env, auth: Address, config: MarketConfig)`
Updates market config.

### `update_admin(env: Env, auth: Address, new_admin: Address)`
Updates admin.

### `place_order(env: Env, maker: Address, token_address: Address, side: Symbol, price: i128, amount: i128, expiry: u64, min_fill: i128) -> u64`
Places an order and escrows funds.

**Auth:** `maker.require_auth()`

**Side:** expects `"buy"` or `"sell"`.

**Behavior:**
- buy: transfers base currency from maker to escrow (market contract)
- sell: transfers RWA from maker to escrow (market contract)

**Returns:** `order_id`.

### `fill_order(env: Env, taker: Address, order_id: u64, fill_amount: i128)`
Fills an existing order.

**Auth:** `taker.require_auth()`

**Settlement:**
- buy side: seller is taker, transfer RWA from taker to maker and net payment from escrow to taker
- sell side: buyer is taker, transfer RWA from escrow to taker and net payment to maker

### `cancel_order(env: Env, maker: Address, order_id: u64)`
Cancels an order and refunds escrow.

**Auth:** `maker.require_auth()` and maker must match stored order maker.

### `get_vwap(env: Env, token: Address) -> i128`
Returns VWAP-like aggregate (simplified; based on stored total volume and total value).

### `get_twap(env: Env, token: Address, start_time: u64) -> i128`
Returns simplified TWAP derived from stored cumulative price*time.

## Notes / placeholder logic
- `check_trading_halt` is present but currently a placeholder and depends on a method like `is_record_date_active` that is not implemented in the Rust code.

