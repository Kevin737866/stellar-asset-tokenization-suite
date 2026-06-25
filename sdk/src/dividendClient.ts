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
  DividendDistribution, 
  DividendConfig, 
  DividendOptions, 
  Currency, 
  ClaimInfo, 
  TransactionOptions, 
  RWASDKConfig, 
  RWASDKError
} from './types';
import { RWASDKError as RWASDKErrorClass, contractErrorToCode, TimeoutError, InsufficientBalanceError, UnauthorizedError, ContractError } from './errors';
import { DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, DEFAULT_PAGINATION_LIMIT } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateRange } from './validation';

export class DividendClient {
  private server: Server;
  private contract: Contract;
  private config: RWASDKConfig;
  private logger: Logger;

  constructor(config: RWASDKConfig) {
    validateServerUrl(config.stellar.serverUrl, 'config.stellar.serverUrl');
    validateAddress(config.contracts.dividendDistributor, 'config.contracts.dividendDistributor');
    this.config = config;
    this.server = new Server(config.stellar.serverUrl);
    this.contract = new Contract(config.contracts.dividendDistributor);
    this.logger = createLogger('DividendClient');
  }

  async createDistribution(
    admin: Address,
    options: DividendOptions,
    txOptions: TransactionOptions = {}
  ): Promise<{ transactionHash: string; distributionId: number }> {
    validateAddress(admin, 'admin');
    validateAddress(options.tokenAddress, 'options.tokenAddress');
    validateAmount(options.amount, 'options.amount');
    if (!options.claimDeadline || !(options.claimDeadline instanceof Date) || options.claimDeadline.getTime() <= Date.now()) {
      throw new InvalidParametersError('options.claimDeadline must be a Date in the future');
    }
    this.logger.info('Creating dividend distribution', { token: options.tokenAddress.toString(), amount: options.amount });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const metadataScMap = this.convertMetadataToScMap(options.metadata || {});
      
      const call = this.contract.call(
        'create_distribution',
        new Address(options.tokenAddress),
        xdr.ScVal.scvSymbol(options.currency),
        new ScInt(options.amount, xdr.ScValType.ScvI128),
        new ScInt(Math.floor(options.claimDeadline.getTime() / 1000)),
        metadataScMap
      );

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

      const distributionId = this.extractDistributionId(result.resultMetaXdr);

      this.logger.info('Dividend distribution created', { distributionId, hash: result.hash });
      return {
        transactionHash: result.hash,
        distributionId
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async claimDividend(
    claimer: Address,
    distributionId: number,
    txOptions: TransactionOptions = {}
  ): Promise<{ transactionHash: string; amountClaimed: string }> {
    validateAddress(claimer, 'claimer');
    validatePositiveInteger(distributionId, 'distributionId');
    this.logger.info('Claiming dividend', { claimer: claimer.toString(), distributionId });
    try {
      const account = await this.server.getAccount(claimer.toString());
      
      const call = this.contract.call(
        'claim_dividend',
        new ScInt(distributionId),
        new Address(claimer)
      );

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, claimer);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      const amountClaimed = this.extractClaimedAmount(result.resultMetaXdr);

      this.logger.info('Dividend claimed', { claimer: claimer.toString(), distributionId, amountClaimed, hash: result.hash });
      return {
        transactionHash: result.hash,
        amountClaimed
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async claimAllDividends(
    claimer: Address,
    txOptions: TransactionOptions = {}
  ): Promise<{ transactionHash: string; claimedAmounts: string[] }> {
    this.logger.info('Claiming all dividends', { claimer: claimer.toString() });
    try {
      const account = await this.server.getAccount(claimer.toString());
      
      const call = this.contract.call('claim_all_dividends', new Address(claimer));

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, claimer);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      const claimedAmounts = this.extractClaimedAmounts(result.resultMetaXdr);

      this.logger.info('All dividends claimed', { claimer: claimer.toString(), count: claimedAmounts.length, hash: result.hash });
      return {
        transactionHash: result.hash,
        claimedAmounts
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getDistribution(distributionId: number): Promise<DividendDistribution> {
    try {
      const result = await this.contract.call('get_distribution', new ScInt(distributionId));
      const distribution = this.convertScValToDistribution(result.result);
      return distribution;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getActiveDistributions(tokenAddress: Address): Promise<DividendDistribution[]> {
    try {
      const result = await this.contract.call('get_active_distributions', new Address(tokenAddress));
      const distributions = this.convertScValToDistributionArray(result.result);
      return distributions;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getClaimInfo(distributionId: number, claimer: Address): Promise<ClaimInfo | null> {
    try {
      const result = await this.contract.call(
        'get_claim_info', 
        new ScInt(distributionId), 
        new Address(claimer)
      );
      
      if (result.result == null) {
        return null;
      }
      
      const claimInfo = this.convertScValToClaimInfo(result.result);
      return claimInfo;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async calculateAvailableDividend(
    distributionId: number,
    claimer: Address
  ): Promise<string> {
    try {
      const result = await this.contract.call(
        'calculate_available_dividend',
        new ScInt(distributionId),
        new Address(claimer)
      );
      
      const val = result.result;
      if (typeof val === 'string') return val;
      if (val && typeof val.toString === 'function') return val.toString();
      return '0';
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async updateConfig(
    admin: Address,
    config: DividendConfig,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    if (config.feeRate != null) {
      validateRange(config.feeRate, 0, 10000, 'config.feeRate');
    }
    this.logger.info('Updating dividend config');
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const configScVal = this.convertDividendConfigToScVal(config);
      
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

      this.logger.info('Dividend config updated', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async deactivateDistribution(
    admin: Address,
    distributionId: number,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    this.logger.info('Deactivating distribution', { distributionId });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('deactivate_distribution', new ScInt(distributionId));

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

      this.logger.info('Distribution deactivated', { distributionId, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getDividendStats(tokenAddress?: Address): Promise<{
    totalDistributions: number;
    activeDistributions: number;
    totalDistributed: string;
    totalClaimed: string;
    pendingClaims: string;
  }> {
    try {
      return {
        totalDistributions: 0,
        activeDistributions: 0,
        totalDistributed: '0',
        totalClaimed: '0',
        pendingClaims: '0'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getUserDividendHistory(
    user: Address,
    limit: number = DEFAULT_PAGINATION_LIMIT,
    cursor?: string
  ): Promise<{
    claims: ClaimInfo[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    try {
      throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'getUserDividendHistory not implemented');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async estimateClaimFee(
    distributionId: number,
    claimer: Address
  ): Promise<{
    baseFee: string;
    dividendFee: string;
    totalFee: string;
    feeCurrency: Currency;
  }> {
    try {
      return {
        baseFee: '100',
        dividendFee: '0',
        totalFee: '100',
        feeCurrency: Currency.XLM
      };
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

  private convertDividendConfigToScVal(config: DividendConfig): xdr.ScVal {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertDividendConfigToScVal not implemented');
  }

  private convertScValToDistribution(scVal: xdr.ScVal): DividendDistribution {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertScValToDistribution not implemented');
  }

  private convertScValToDistributionArray(scVal: xdr.ScVal): DividendDistribution[] {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertScValToDistributionArray not implemented');
  }

  private convertScValToClaimInfo(scVal: xdr.ScVal): ClaimInfo {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertScValToClaimInfo not implemented');
  }

  private extractDistributionId(resultMetaXdr: string): number {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'extractDistributionId not implemented');
  }

  private extractClaimedAmount(resultMetaXdr: string): string {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'extractClaimedAmount not implemented');
  }

  private extractClaimedAmounts(resultMetaXdr: string): string[] {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'extractClaimedAmounts not implemented');
  }

  private async signTransaction(transaction: any, signer: Address): Promise<any> {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'signTransaction not implemented');
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
