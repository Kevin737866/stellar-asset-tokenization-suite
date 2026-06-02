# SDK (TypeScript): MarketClient

Source: `sdk/src/marketClient.ts`

## Overview
`MarketClient` wraps calls to the on-chain `SecondaryMarket` contract.

It supports:
- creating buy/sell orders
- cancelling orders
- matching orders (depending on contract functionality)
- reading order book, orders, and recent trades
- admin operations: add supported token, pause status, update config

## Public methods

### `constructor(config: RWASDKConfig)`
Creates the client.

### `createBuyOrder(trader: Address, options: OrderOptions, txOptions?: TransactionOptions) -> Promise<{ transactionHash; orderId }>`
Calls contract `create_buy_order`.

### `createSellOrder(trader: Address, options: OrderOptions, txOptions?: TransactionOptions) -> Promise<{ transactionHash; orderId }>`
Calls contract `create_sell_order`.

### `cancelOrder(trader: Address, orderId: number, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `cancel_order`.

### `matchOrders(caller: Address, tokenAddress: Address, txOptions?: TransactionOptions) -> Promise<string>`
Calls contract `match_orders` (may not exist in the current Rust contract; depends on deployed ABI).

### `getOrderBook(tokenAddress: Address) -> Promise<OrderBook>`
Calls `get_order_book`.

### `getOrder(orderId: number) -> Promise<Order>`
Calls `get_order`.

### `getUserOrders(user: Address) -> Promise<Order[]>`
Calls `get_user_orders`.

### `getRecentTrades(tokenAddress: Address, limit?: number) -> Promise<Trade[]>`
Calls `get_recent_trades`.

### Admin operations
- `addSupportedToken(admin: Address, tokenAddress: Address, txOptions?: TransactionOptions) -> Promise<string>`
- `setPauseStatus(admin: Address, paused: boolean, txOptions?: TransactionOptions) -> Promise<string>`
- `updateConfig(admin: Address, config: MarketConfig, txOptions?: TransactionOptions) -> Promise<string>`

## Notes
The Rust `SecondaryMarket` file we documented exposes `initialize`, `place_order`, `fill_order`, `cancel_order`, plus `get_vwap`/`get_twap`.
The SDK currently calls additional function names like `create_buy_order`, `create_sell_order`, `get_order_book`, etc.; these must match the deployed contract interface or the SDK should be updated.

