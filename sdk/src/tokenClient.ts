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
  AssetInfo, 
  Balance, 
  TransferOptions, 
  TransactionOptions, 
  RWASDKConfig, 
  RWASDKError
} from './types';
import { RWASDKError as RWASDKErrorClass, contractErrorToCode, TimeoutError, InsufficientBalanceError, UnauthorizedError, TransactionError, ContractError } from './errors';
import { DEFAULT_DECIMALS, DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, DEFAULT_PAGINATION_LIMIT } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateRange } from './validation';

export class TokenClient {
  private server: Server;
  private contract: Contract;
  private config: RWASDKConfig;
  private tokenAddress: Address;
  private logger: Logger;

  constructor(config: RWASDKConfig, tokenAddress: Address) {
    validateAddress(tokenAddress, 'tokenAddress');
    this.config = config;
    this.server = new Server(config.stellar.serverUrl);
    this.tokenAddress = tokenAddress;
    this.contract = new Contract(tokenAddress);
    this.logger = createLogger('TokenClient');
  }

  async getTokenInfo(): Promise<AssetInfo> {
    try {
      const result = await this.contract.call('get_token_info');
      const tokenInfo = this.convertScValToAssetInfo(result.result);
      return tokenInfo;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getBalance(address: Address): Promise<Balance> {
    try {
      const result = await this.contract.call('get_balance', new Address(address));
      const balance = this.convertScValToBalance(result.result);
      return balance;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async transfer(
    from: Address,
    to: Address,
    amount: string,
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(from, 'from');
    validateAddress(to, 'to');
    validateAmount(amount, 'amount');
    if (options.fee != null) {
      if (typeof options.fee !== 'number' || options.fee <= 0) {
        throw new InvalidParametersError('options.fee must be a positive number');
      }
    }
    if (options.timeout != null) {
      if (typeof options.timeout !== 'number' || options.timeout <= 0) {
        throw new InvalidParametersError('options.timeout must be a positive number');
      }
    }
    this.logger.info('Transferring tokens', { from: from.toString(), to: to.toString(), amount });
    try {
      const account = await this.server.getAccount(from.toString());
      
      const call = this.contract.call(
        'transfer',
        new Address(from),
        new Address(to),
        new ScInt(amount, xdr.ScValType.ScvI128)
      );

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, from);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Tokens transferred', { from: from.toString(), to: to.toString(), amount, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async mint(
    admin: Address,
    to: Address,
    amount: string,
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(to, 'to');
    validateAmount(amount, 'amount');
    this.logger.info('Minting tokens', { to: to.toString(), amount });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call(
        'mint',
        new Address(to),
        new ScInt(amount, xdr.ScValType.ScvI128)
      );

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Tokens minted', { to: to.toString(), amount, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async burn(
    owner: Address,
    amount: string,
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(owner, 'owner');
    validateAmount(amount, 'amount');
    this.logger.info('Burning tokens', { owner: owner.toString(), amount });
    try {
      const account = await this.server.getAccount(owner.toString());
      
      const call = this.contract.call(
        'burn',
        new Address(owner),
        new ScInt(amount, xdr.ScValType.ScvI128)
      );

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, owner);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Tokens burned', { owner: owner.toString(), amount, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async lockTokens(
    owner: Address,
    amount: string,
    lockPeriod: number,
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(owner, 'owner');
    validateAmount(amount, 'amount');
    validatePositiveInteger(lockPeriod, 'lockPeriod');
    this.logger.info('Locking tokens', { owner: owner.toString(), amount, lockPeriod });
    try {
      const account = await this.server.getAccount(owner.toString());
      
      const call = this.contract.call(
        'lock_tokens',
        new Address(owner),
        new ScInt(amount, xdr.ScValType.ScvI128),
        new ScInt(lockPeriod)
      );

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, owner);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Tokens locked', { owner: owner.toString(), amount, lockPeriod, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async unlockTokens(
    owner: Address,
    amount: string,
    options: TransactionOptions = {}
  ): Promise<string> {
    this.logger.info('Unlocking tokens', { owner: owner.toString(), amount });
    try {
      const account = await this.server.getAccount(owner.toString());
      
      const call = this.contract.call(
        'unlock_tokens',
        new Address(owner),
        new ScInt(amount, xdr.ScValType.ScvI128)
      );

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, owner);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Tokens unlocked', { owner: owner.toString(), amount, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async pause(admin: Address, options: TransactionOptions = {}): Promise<string> {
    validateAddress(admin, 'admin');
    this.logger.info('Pausing token transfers');
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('pause');

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Token transfers paused', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async unpause(admin: Address, options: TransactionOptions = {}): Promise<string> {
    validateAddress(admin, 'admin');
    this.logger.info('Unpausing token transfers');
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('unpause');

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Token transfers unpaused', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async freeze(admin: Address, options: TransactionOptions = {}): Promise<string> {
    validateAddress(admin, 'admin');
    this.logger.info('Freezing token');
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('freeze');

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Token frozen', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async unfreeze(admin: Address, options: TransactionOptions = {}): Promise<string> {
    validateAddress(admin, 'admin');
    this.logger.info('Unfreezing token');
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('unfreeze');

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Token unfrozen', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getTokenStats(): Promise<{
    totalSupply: string;
    circulatingSupply: string;
    totalHolders: number;
    totalLocked: string;
    transferCount: number;
  }> {
    try {
      const tokenInfo = await this.getTokenInfo();
      
      return {
        totalSupply: tokenInfo.totalSupply,
        circulatingSupply: tokenInfo.totalSupply,
        totalHolders: 0,
        totalLocked: '0',
        transferCount: 0
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getTransferHistory(
    address: Address,
    limit: number = DEFAULT_PAGINATION_LIMIT,
    cursor?: string
  ): Promise<{
    transfers: Array<{
      from: Address;
      to: Address;
      amount: string;
      timestamp: Date;
      txHash: string;
    }>;
    hasMore: boolean;
    nextCursor?: string;
  }> {
    try {
      const payments = await this.server.payments()
        .forAccount(address.toString())
        .limit(limit)
        .cursor(cursor || '')
        .call();

      const transfers = payments.records.map((record: any) => ({
        from: new Address(record.from || record.source_account),
        to: new Address(record.to || record.funder || record.account),
        amount: record.amount || '0',
        timestamp: new Date(record.created_at),
        txHash: record.transaction_hash
      }));

      return {
        transfers,
        hasMore: payments.records.length > 0,
        nextCursor: payments.records.length > 0 ? payments.records[payments.records.length - 1].paging_token : undefined
      };
      throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'getTransferHistory not implemented');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async estimateTransferFee(
    from: Address,
    to: Address,
    amount: string
  ): Promise<{
    baseFee: string;
    complianceFee: string;
    totalFee: string;
    feeCurrency: string;
  }> {
    try {
      const baseFee = (this.config.defaultFeeRate || DEFAULT_FEE_RATE).toString();
      return {
        baseFee,
        complianceFee: '0',
        totalFee: baseFee,
        feeCurrency: 'XLM'
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async checkTransferAllowed(
    from: Address,
    to: Address,
    amount: string
  ): Promise<{
    allowed: boolean;
    reason?: string;
    restrictions?: string[];
  }> {
    try {
      const result = await this.contract.call(
        'check_transfer_compliance', 
        new Address(from), 
        new Address(to), 
        new ScInt(amount, xdr.ScValType.ScvI128)
      );
      const isAllowed = scValToNative(result.result);
      return {
        allowed: !!isAllowed,
        reason: isAllowed ? undefined : 'Compliance check failed by registry contract'
      };
    } catch (error) {
      return { allowed: true };
    }
  }

  private convertScValToAssetInfo(scVal: xdr.ScVal): AssetInfo {
    const native = scValToNative(scVal);
    return {
      name: native.name?.toString() || '',
      symbol: native.symbol?.toString() || '',
      decimals: Number(native.decimals) || DEFAULT_DECIMALS,
      totalSupply: native.total_supply?.toString() || '0',
      assetClass: native.asset_class?.toString() || '',
      metadata: native.metadata || {},
      complianceRegistry: native.compliance_registry?.toString() || '',
      dividendDistributor: native.dividend_distributor?.toString() || '',
    } as AssetInfo;
  }

  private convertScValToBalance(scVal: xdr.ScVal): Balance {
    const native = scValToNative(scVal);
    return {
      amount: native.amount?.toString() || '0',
      lockedAmount: native.locked_amount?.toString() || '0',
      votingPower: native.voting_power?.toString() || '0',
      lastDividendClaim: Number(native.last_dividend_claim) || 0,
    } as Balance;
  }

  private async signTransaction(transaction: any, signer: Address): Promise<any> {
    if ((this.config.stellar as any)?.secretKey) {
      const keypair = Keypair.fromSecret((this.config.stellar as any).secretKey);
      transaction.sign(keypair);
      return transaction;
    }
    throw new UnauthorizedError('signTransaction requires a configured secretKey in the SDK config');
  }

  private handleError(error: unknown): RWASDKErrorClass {
    if (error instanceof RWASDKErrorClass) {
      return error;
    }

    const message = (error && typeof error === 'object' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string')
      ? (error as Record<string, string>).message
      : String(error);

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
