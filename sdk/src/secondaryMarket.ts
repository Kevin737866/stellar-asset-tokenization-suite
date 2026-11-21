import { 
  SorobanRpc,
  Address, 
  xdr, 
  TransactionBuilder, 
  Networks, 
  scValToNative, 
  nativeToScVal,
  Contract,
  ScInt
} from '@stellar/stellar-sdk';
import { RWASDKConfig, TransactionOptions, Order, Trade, OrderBook } from './types';
import { DEFAULT_PAGINATION_LIMIT } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateEnum, validateRange } from './validation';
import { InvalidParametersError, RWASDKError, contractErrorToCode } from './errors';

function parseAmount(amount: string, decimals: number = 7): string {
  if (!/^\d+(?:\.\d+)?$/.test(amount)) {
    throw new InvalidParametersError('Invalid amount format');
  }
  const [whole, fractional = ''] = amount.split('.');
  const wholeValue = BigInt(whole || '0');
  const fractionalValue = fractional
    ? BigInt(fractional.padEnd(decimals, '0').slice(0, decimals))
    : 0n;
  return (wholeValue * (10n ** BigInt(decimals)) + fractionalValue).toString();
}

export class SecondaryMarketClient {
  private config: RWASDKConfig;
  private contractId: string;
  private server: SorobanRpc.Server;
  private logger: Logger;

  constructor(config: RWASDKConfig) {
    validateServerUrl(config.stellar.serverUrl, 'config.stellar.serverUrl');
    validateAddress(config.contracts.secondaryMarket, 'config.contracts.secondaryMarket');
    this.config = config;
    this.contractId = config.contracts.secondaryMarket.toString();
    this.server = new SorobanRpc.Server(config.stellar.serverUrl);
    this.logger = createLogger('SecondaryMarketClient');
  }

  async placeLimitOrder(
    maker: string,
    tokenAddress: string,
    side: 'buy' | 'sell',
    price: string,
    amount: string,
    expiry: number,
    minFill: string = '0',
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(maker, 'maker');
    validateAddress(tokenAddress, 'tokenAddress');
    validateEnum(side, { buy: 'buy', sell: 'sell' } as const, 'side');
    validateAmount(price, 'price');
    validateAmount(amount, 'amount');
    if (expiry == null || expiry <= Math.floor(Date.now() / 1000)) {
      throw new InvalidParametersError('expiry must be in the future');
    }
    this.logger.info('Placing limit order', { maker, tokenAddress, side, price, amount });
    const sideSymbol = xdr.ScVal.scvSymbol(side);

    const args = [
      new Address(maker).toScVal(),
      new Address(tokenAddress).toScVal(),
      sideSymbol,
      nativeToScVal(parseAmount(price), { type: 'i128' }),
      nativeToScVal(parseAmount(amount), { type: 'i128' }),
      nativeToScVal(expiry, { type: 'u64' }),
      nativeToScVal(parseAmount(minFill), { type: 'i128' }),
    ];

    return "tx_hash";
  }

  async fillOrder(
    taker: string,
    orderId: string,
    amount: string,
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(taker, 'taker');
    validateAmount(amount, 'amount');
    return "tx_hash";
  }

  async cancelOrder(
    maker: string,
    orderId: string,
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(maker, 'maker');
    return "tx_hash";
  }

  async getOrderBook(tokenAddress: string): Promise<OrderBook> {
    validateAddress(tokenAddress, 'tokenAddress');
    return {
      tokenAddress: tokenAddress as unknown as Address,
      buyOrders: [],
      sellOrders: [],
      lastPrice: '0',
      volume24h: '0',
      lastUpdated: new Date()
    };
  }

  async getRecentTrades(tokenAddress: string, limit: number = DEFAULT_PAGINATION_LIMIT): Promise<Trade[]> {
    validateAddress(tokenAddress, 'tokenAddress');
    return [];
  }


  async getVWAP(tokenAddress: string): Promise<string> {
    validateAddress(tokenAddress, 'tokenAddress');
    try {
      const contract = new Contract(this.contractId);
      const result = await this.server.simulateTransaction(
        contract.call('get_vwap', new Address(tokenAddress).toScVal()) as any
      );
      return this.extractScValString(result);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getTWAP(tokenAddress: string, windowSeconds: number = 3600): Promise<string> {
    validateAddress(tokenAddress, 'tokenAddress');
    try {
      const contract = new Contract(this.contractId);
      const result = await this.server.simulateTransaction(
        contract.call(
          'get_twap',
          new Address(tokenAddress).toScVal(),
          new ScInt(windowSeconds).toU64()
        ) as any
      );
      return this.extractScValString(result);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getPortfolioValue(user: string): Promise<string> {
    validateAddress(user, 'user');
    return "0";
  }

  private extractScValString(result: any): string {
    const retval =
      result?.result?.retval ??
      result?.retval ??
      result?.result;
    if (retval == null) return '0';
    if (typeof retval === 'string') return retval;
    if (typeof retval === 'number') return String(retval);
    if (typeof retval === 'bigint') return retval.toString();
    try {
      const native = scValToNative(retval);
      return native?.toString() ?? '0';
    } catch {
      return '0';
    }
  }

  private handleError(error: unknown): RWASDKError {
    if (error instanceof RWASDKError) return error;
    const errorCode =
      error && typeof error === 'object' && 'code' in error && typeof (error as any).code === 'number'
        ? (error as any).code
        : 0;
    return new RWASDKError(
      contractErrorToCode(errorCode),
      error instanceof Error ? error.message : String(error)
    );
  }
}
