# Soroban Contract: Secondary Market

Source: `src/secondary_market.rs`

## Overview

The **SecondaryMarket** contract implements an order-book-based trading engine for RWA tokens. It provides:

- **Order Placement** — Buy and sell limit orders with escrow of funds
- **Order Filling** — Partial or complete fills with automatic settlement
- **Order Cancellation** — Cancel and refund unfilled orders
- **Price Discovery** — VWAP (Volume-Weighted Average Price) and TWAP (Time-Weighted) tracking
- **Compliance Integration** — All trades validated against ComplianceRegistry
- **Trading Halts** — Circuit breaker and dividend record-date protections
- **Fee Collection** — Configurable trading fees in basis points

## Architecture

```
┌──────────────────────┐
│   SecondaryMarket     │
└──────────┬───────────┘
           │
    ┌──────┼──────┐
    │      │      │
    ▼      ▼      ▼
┌──────┐ ┌────┐ ┌──────────────┐
│Place │ │Fill│ │Cancel        │
│Order │ │    │ │              │
└──┬───┘ └─┬──┘ └──────────────┘
   │       │
   ▼       ▼
┌──────────────────────┐
│ Escrow Management     │
│ (Base currency & RWA) │
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│ ComplianceRegistry    │
│ (KYC/Blacklist check) │
└──────────────────────┘
```

## Data Types

### `MarketError`
| Variant | Code | Description |
|---------|------|-------------|
| `AlreadyInitialized` | 501 | Market already initialized |
| `InvalidOrder` | 502 | Invalid order parameters |
| `OrderNotFound` | 503 | Order ID not found |
| `OrderExpired` | 504 | Order has expired |
| `InsufficientLiquidity` | 505 | Not enough liquidity |
| `TradingPaused` | 506 | Trading is paused |
| `CircuitBreakerTripped` | 507 | Circuit breaker triggered |
| `DividendHalt` | 508 | Trading halted for dividend record date |
| `MinOrderSizeNotMet` | 509 | Order below minimum size |
| `PriceDeviationTooHigh` | 510 | Price exceeds max deviation |
| `Unauthorized` | 511 | Caller not authorized |
| `NotInitialized` | 512 | Market not initialized |

### `Order`
| Field | Type | Description |
|-------|------|-------------|
| `order_id` | `u64` | Unique order ID |
| `maker` | `Address` | Order creator |
| `token_address` | `Address` | RWA token being traded |
| `side` | `Symbol` | "buy" or "sell" |
| `price` | `i128` | Limit price per token |
| `amount` | `i128` | Total order amount |
| `filled_amount` | `i128` | Amount already filled |
| `expiry` | `u64` | Order expiry timestamp |
| `min_fill` | `i128` | Minimum fill amount |
| `is_active` | `bool` | Whether order is active |
| `created_at` | `u64` | Creation timestamp |

### `MarketConfig`
| Field | Type | Description |
|-------|------|-------------|
| `fee_rate_bps` | `i64` | Trading fee in basis points |
| `min_order_size` | `i128` | Minimum order amount |
| `max_price_deviation_bps` | `i64` | Max price deviation from VWAP |
| `base_currency` | `Address` | Base currency token address |
| `compliance_registry` | `Address` | Compliance contract |
| `dividend_distributor` | `Address` | Dividend contract |

### `Trade`
| Field | Type | Description |
|-------|------|-------------|
| `trade_id` | `u64` | Unique trade ID |
| `order_id` | `u64` | Matching order ID |
| `maker` | `Address` | Order maker |
| `taker` | `Address` | Order filler |
| `price` | `i128` | Execution price |
| `amount` | `i128` | Trade amount |
| `fee` | `i128` | Fee collected |
| `timestamp` | `u64` | Trade timestamp |

---

## Public Entry Points

### `initialize(env, admin, base_currency, compliance_registry, dividend_distributor, fee_rate_bps, min_order_size, max_price_deviation_bps)`

Initializes the market contract with trading parameters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `admin` | `Address` | Market admin |
| `base_currency` | `Address` | Base currency token (e.g., USDC) |
| `compliance_registry` | `Address` | Compliance contract address |
| `dividend_distributor` | `Address` | Dividend contract address |
| `fee_rate_bps` | `i64` | Trading fee (e.g., 50 = 0.5%) |
| `min_order_size` | `i128` | Minimum order amount |
| `max_price_deviation_bps` | `i64` | Max VWAP deviation (e.g., 2000 = 20%) |

**Returns:** Nothing

**Errors:**
- `AlreadyInitialized`

**Example:**
```rust
let market_id = env.register_contract(None, SecondaryMarket);
let market = SecondaryMarketClient::new(&env, &market_id);
market.initialize(
    &admin,
    &usdc_address,
    &compliance_id,
    &dividend_id,
    &50i64,    // 0.5% fee
    &10i128,   // min 10 tokens
    &2000i64,  // max 20% deviation
);
```

---

### `migrate(env, auth)`

Admin storage migration.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |

---

### `update_config(env, auth, config)`

Updates market configuration parameters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `auth` | `Address` | Admin address |
| `config` | `MarketConfig` | New configuration |

**Auth:** Admin check

---

### `place_order(env, maker, token_address, side, price, amount, expiry, min_fill) -> u64`

Places a buy or sell order and escrows the appropriate funds.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `maker` | `Address` | Order creator |
| `token_address` | `Address` | RWA token address |
| `side` | `Symbol` | `"buy"` or `"sell"` |
| `price` | `i128` | Limit price per token (> 0) |
| `amount` | `i128` | Order amount (>= min_order_size) |
| `expiry` | `u64` | Expiry timestamp (must be in future) |
| `min_fill` | `i128` | Minimum fill amount (0 for no minimum) |

**Auth:** `maker.require_auth()`

**Returns:** `u64` — New order ID

**Escrow Behavior:**
- **Buy:** Transfers `price × amount` base currency from maker to market escrow
- **Sell:** Transfers `amount` RWA tokens from maker to market escrow

**Errors:**
- `InvalidOrder` — Price/amount/expiry validation failed
- `MinOrderSizeNotMet` — Amount below minimum
- `PriceDeviationTooHigh` — Price deviates too far from VWAP
- `TradingPaused` — Trading halted
- `CircuitBreakerTripped` — Circuit breaker active
- `DividendHalt` — Record date halt

**Events:**
- `order_placed` with topics `(order_id, maker, side, price, amount)`

**Example:**
```rust
let order_id = market.place_order(
    &buyer,
    &token_address,
    &Symbol::new(&env, "buy"),
    &100i128,  // price per token
    &50i128,   // amount
    &(env.ledger().timestamp() + 3600), // 1 hour expiry
    &0i128,    // no min fill
);
```

---

### `fill_order(env, taker, order_id, fill_amount)`

Fills (or partially fills) an existing order with automatic settlement.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `taker` | `Address` | Order filler |
| `order_id` | `u64` | Order to fill |
| `fill_amount` | `i128` | Amount to fill |

**Auth:** `taker.require_auth()`

**Settlement Logic:**

*Buy order fill:*
- Taker (seller) transfers RWA tokens to maker
- Market releases `fill_amount × price` base currency from escrow to taker (minus fee)
- Fee sent to protocol

*Sell order fill:*
- Taker (buyer) transfers base currency to maker
- Market releases `fill_amount` RWA tokens from escrow to taker
- Fee deducted from base currency

**Errors:**
- `OrderNotFound` — Invalid order ID
- `OrderExpired` — Past expiry
- `InvalidOrder` — Fill exceeds remaining amount or below min_fill
- `TradingPaused` — Trading halted

**Events:**
- `order_filled` with topics `(order_id, taker, fill_amount, price)`

**Example:**
```rust
// Seller fills a buy order
market.fill_order(&seller, &order_id, &50i128);
```

---

### `cancel_order(env, maker, order_id)`

Cancels an unfilled or partially filled order and refunds escrowed funds.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `maker` | `Address` | Must match order's maker |
| `order_id` | `u64` | Order to cancel |

**Auth:** `maker.require_auth()` and maker must match order.maker

**Errors:**
- `OrderNotFound`
- `Unauthorized` — Caller is not the maker

**Events:**
- `order_cancelled` with topics `(order_id, maker)`

**Example:**
```rust
market.cancel_order(&buyer, &order_id);
// Escrowed funds returned to buyer
```

---

### `get_vwap(env, token) -> i128`

Returns the Volume-Weighted Average Price for a token. Simplified implementation: `total_value / total_volume`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `token` | `Address` | Token address |

**Returns:** `i128` — VWAP (0 if no trades)

**Example:**
```rust
let vwap = market.get_vwap(&token_address);
```

---

### `get_twap(env, token, start_time) -> i128`

Returns a simplified Time-Weighted Average Price derived from cumulative price × time.

| Parameter | Type | Description |
|-----------|------|-------------|
| `env` | `Env` | Soroban environment |
| `token` | `Address` | Token address |
| `start_time` | `u64` | Start timestamp |

**Returns:** `i128` — TWAP (0 if no data)

---

### `update_admin(env, auth, new_admin)`

Transfers market admin role.

| Parameter | Type | Description |
|-----------|------|-------------|
| `auth` | `Address` | Current admin |
| `new_admin` | `Address` | New admin |

**Auth:** Admin check

---

## Event Catalog

| Event | Topics | Emitted By |
|-------|--------|------------|
| `initialized` | `admin, base_currency, fee_rate_bps` | `initialize()` |
| `migrated` | `old_version, new_version` | `migrate()` |
| `order_placed` | `order_id, maker, side, price, amount` | `place_order()` |
| `order_filled` | `order_id, taker, fill_amount, price` | `fill_order()` |
| `order_cancelled` | `order_id, maker` | `cancel_order()` |
| `config_updated` | `fee_rate_bps, min_order_size` | `update_config()` |

## Trading Fee Calculation

```
fee = fill_amount × price × (fee_rate_bps / 10000)
net_payment = (fill_amount × price) - fee
```

## Order Lifecycle

```
Place Order ──▶ Active ──▶ Filled (partially or fully)
                  │
                  ├──▶ Cancelled (refund escrow)
                  │
                  └──▶ Expired (auto-cleanup)
```
