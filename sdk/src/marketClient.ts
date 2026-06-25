import { 
  Server, 
  TransactionBuilder, 
  Networks, 
  Account, 
  Address,
  Contract,
  xdr,
  ScInt
} from 'stellar-sdk';
import { 
  Order, 
  OrderType, 
  Trade, 
  OrderBook, 
  MarketConfig, 
  OrderOptions, 
  TransactionOptions, 
  RWASDKConfig, 
  RWASDKError
} from './types';
import { RWASDKError as RWASDKErrorClass, contractErrorToCode, TimeoutError, InsufficientBalanceError, UnauthorizedError, ContractError, TransactionError } from './errors';
import { DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, DEFAULT_PAGINATION_LIMIT, DEFAULT_ORDER_EXPIRY_HOURS, DEFAULT_PRICE_HISTORY_LIMIT, DEFAULT_MARKET_DEPTH } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateRange } from './validation';

export class MarketClient {
  private server: Server;
  private contract: Contract;
  private config: RWASDKConfig;
  private logger: Logger;

  constructor(config: RWASDKConfig) {
    validateServerUrl(config.stellar.serverUrl, 'config.stellar.serverUrl');
    validateAddress(config.contracts.secondaryMarket, 'config.contracts.secondaryMarket');
    this.config = config;
    this.server = new Server(config.stellar.serverUrl);
    this.contract = new Contract(config.contracts.secondaryMarket);
    this.logger = createLogger('MarketClient');
  }

  async createBuyOrder(
    trader: Address,
    options: OrderOptions,
    txOptions: TransactionOptions = {}
  ): Promise<{ transactionHash: string; orderId: number }> {
    validateAddress(trader, 'trader');
    validateAddress(options.tokenAddress, 'options.tokenAddress');
    validateAmount(options.amount, 'options.amount');
    validateAmount(options.price, 'options.price');
    this.logger.info('Creating buy order', { trader: trader.toString(), token: options.tokenAddress.toString(), amount: options.amount, price: options.price });
    try {
      const account = await this.server.getAccount(trader.toString());
      
      const expiresAt = options.expiresAt || new Date(Date.now() + DEFAULT_ORDER_EXPIRY_HOURS * 60 * 60 * 1000);
      const metadataScMap = this.convertMetadataToScMap(options.metadata || {});
      
      const call = this.contract.call(
        'create_buy_order',
        new Address(options.tokenAddress),
        new ScInt(options.amount, xdr.ScValType.ScvI128),
        new ScInt(options.price, xdr.ScValType.ScvI128),
        new ScInt(Math.floor(expiresAt.getTime() / 1000))
      );

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, trader);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      const orderId = this.extractOrderId(result.resultMetaXdr);

      this.logger.info('Buy order created', { orderId, hash: result.hash });
      return {
        transactionHash: result.hash,
        orderId
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async createSellOrder(
    trader: Address,
    options: OrderOptions,
    txOptions: TransactionOptions = {}
  ): Promise<{ transactionHash: string; orderId: number }> {
    validateAddress(trader, 'trader');
    validateAddress(options.tokenAddress, 'options.tokenAddress');
    validateAmount(options.amount, 'options.amount');
    validateAmount(options.price, 'options.price');
    this.logger.info('Creating sell order', { trader: trader.toString(), token: options.tokenAddress.toString(), amount: options.amount, price: options.price });
    try {
      const account = await this.server.getAccount(trader.toString());
      
      const expiresAt = options.expiresAt || new Date(Date.now() + DEFAULT_ORDER_EXPIRY_HOURS * 60 * 60 * 1000);
      const metadataScMap = this.convertMetadataToScMap(options.metadata || {});
      
      const call = this.contract.call(
        'create_sell_order',
        new Address(options.tokenAddress),
        new ScInt(options.amount, xdr.ScValType.ScvI128),
        new ScInt(options.price, xdr.ScValType.ScvI128),
        new ScInt(Math.floor(expiresAt.getTime() / 1000))
      );

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, trader);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      const orderId = this.extractOrderId(result.resultMetaXdr);

      this.logger.info('Sell order created', { orderId, hash: result.hash });
      return {
        transactionHash: result.hash,
        orderId
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async cancelOrder(
    trader: Address,
    orderId: number,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(trader, 'trader');
    validatePositiveInteger(orderId, 'orderId');
    this.logger.info('Cancelling order', { trader: trader.toString(), orderId });
    try {
      const account = await this.server.getAccount(trader.toString());
      
      const call = this.contract.call('cancel_order', new ScInt(orderId));

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, trader);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Order cancelled', { orderId, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async matchOrders(
    caller: Address,
    tokenAddress: Address,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(caller, 'caller');
    validateAddress(tokenAddress, 'tokenAddress');
    this.logger.info('Matching orders', { caller: caller.toString(), token: tokenAddress.toString() });
    try {
      const account = await this.server.getAccount(caller.toString());
      
      const call = this.contract.call('match_orders', new Address(tokenAddress));

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, caller);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Orders matched', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getOrderBook(tokenAddress: Address): Promise<OrderBook> {
    validateAddress(tokenAddress, 'tokenAddress');
    try {
      const result = await this.contract.call('get_order_book', new Address(tokenAddress));
      const orderBook = this.convertScValToOrderBook(result.result);
      return orderBook;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getOrder(orderId: number): Promise<Order> {
    validatePositiveInteger(orderId, 'orderId');
    try {
      const result = await this.contract.call('get_order', new ScInt(orderId));
      const order = this.convertScValToOrder(result.result);
      return order;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getUserOrders(user: Address): Promise<Order[]> {
    validateAddress(user, 'user');
    try {
      const result = await this.contract.call('get_user_orders', new Address(user));
      const orders = this.convertScValToOrderArray(result.result);
      return orders;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getRecentTrades(
    tokenAddress: Address,
    limit: number = DEFAULT_PAGINATION_LIMIT
  ): Promise<Trade[]> {
    try {
      const result = await this.contract.call(
        'get_recent_trades', 
        new Address(tokenAddress), 
        new ScInt(limit)
      );
      const trades = this.convertScValToTradeArray(result.result);
      return trades;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async addSupportedToken(
    admin: Address,
    tokenAddress: Address,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(tokenAddress, 'tokenAddress');
    this.logger.info('Adding supported token', { token: tokenAddress.toString() });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('add_supported_token', new Address(tokenAddress));

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Supported token added', { token: tokenAddress.toString(), hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async setPauseStatus(
    admin: Address,
    paused: boolean,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    this.logger.info('Setting pause status', { paused });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('set_pause_status', paused);

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Pause status set', { paused, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async updateConfig(
    admin: Address,
    config: MarketConfig,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    this.logger.info('Updating market config');
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const configScVal = this.convertMarketConfigToScVal(config);
      
      const call = this.contract.call('update_config', configScVal);

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Market config updated', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getMarketStats(tokenAddress?: Address): Promise<{
    totalOrders: number;
    activeOrders: number;
    totalTrades: number;
    volume24h: string;
    avgPrice: string;
    spread: string;
  }> {
    try {
      return {
        totalOrders: 0,
        activeOrders: 0,
        totalTrades: 0,
        volume24h: '0',
        avgPrice: '0',
        spread: '0'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getPriceHistory(
    tokenAddress: Address,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1h',
    limit: number = DEFAULT_PRICE_HISTORY_LIMIT
  ): Promise<Array<{
    timestamp: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>> {
    try {
      throw new ContractError('getPriceHistory not implemented');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async estimateTradingFee(
    orderType: OrderType,
    amount: string,
    price: string
  ): Promise<{
    baseFee: string;
    tradingFee: string;
    totalFee: string;
    feeCurrency: string;
  }> {
    try {
      return {
        baseFee: '100',
        tradingFee: '0',
        totalFee: '100',
        feeCurrency: 'XLM'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getMarketDepth(
    tokenAddress: Address,
    depth: number = DEFAULT_MARKET_DEPTH
  ): Promise<{
    bids: Array<{ price: string; amount: string; total: string }>;
    asks: Array<{ price: string; amount: string; total: string }>;
  }> {
    try {
      const orderBook = await this.getOrderBook(tokenAddress);
      
      const toBigInt = (val: string): bigint => {
        try { return BigInt(val); } catch { return 0n; }
      };

      const bids = orderBook.buyOrders.slice(0, depth).map(order => ({
        price: order.price,
        amount: order.remainingAmount,
        total: (toBigInt(order.price) * toBigInt(order.remainingAmount)).toString()
      }));

      const asks = orderBook.sellOrders.slice(0, depth).map(order => ({
        price: order.price,
        amount: order.remainingAmount,
        total: (toBigInt(order.price) * toBigInt(order.remainingAmount)).toString()
      }));

      return { bids, asks };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private convertMetadataToScMap(metadata: Record<string, string>): xdr.ScMap {
    if (!metadata || typeof metadata !== 'object') {
      return new xdr.ScMap({ map: [] });
    }
    const map = new xdr.ScMap({
      map: Object.entries(metadata).map(([key, value]) => ({
        key: xdr.ScVal.scvSymbol(key),
        val: xdr.ScVal.scvSymbol(value)
      }))
    });
    return map;
  }

  private convertMarketConfigToScVal(config: MarketConfig): xdr.ScVal {
    throw new ContractError('convertMarketConfigToScVal not implemented');
  }

  private convertScValToOrderBook(scVal: xdr.ScVal): OrderBook {
    throw new ContractError('convertScValToOrderBook not implemented');
  }

  private convertScValToOrder(scVal: xdr.ScVal): Order {
    throw new ContractError('convertScValToOrder not implemented');
  }

  private convertScValToOrderArray(scVal: xdr.ScVal): Order[] {
    throw new ContractError('convertScValToOrderArray not implemented');
  }

  private convertScValToTradeArray(scVal: xdr.ScVal): Trade[] {
    throw new ContractError('convertScValToTradeArray not implemented');
  }

  private extractOrderId(resultMetaXdr: string): number {
    throw new ContractError('extractOrderId not implemented');
  }

  private async signTransaction(transaction: any, signer: Address): Promise<any> {
    throw new ContractError('signTransaction not implemented');
  }

  private handleError(error: unknown): RWASDKErrorClass {
    if (error instanceof RWASDKErrorClass) {
      return error;
    }

    const message = error.message || String(error);

    if (message.includes('timeout')) {
      return new TimeoutError(message);
    }

    if (message.includes('insufficient')) {
      return new InsufficientBalanceError(message);
    }

    if (message.includes('unauthorized')) {
      return new UnauthorizedError(message);
    }

    const match = message.match(/ContractError\((\d+)\)/);
    if (match) {
      const code = contractErrorToCode(parseInt(match[1]));
      return new RWASDKErrorClass(code, message);
    }

    return new ContractError(message);
  }
}
