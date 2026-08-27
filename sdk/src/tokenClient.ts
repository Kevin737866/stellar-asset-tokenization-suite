import { 
  TransactionBuilder, 
  Networks, 
  Account, 
  Address,
  Contract,
  xdr,
  ScInt,
  Keypair,
  scValToNative,
  rpc as SorobanRpc
} from 'stellar-sdk';

/** Server is the Soroban RPC server client (stellar-sdk v12+). */
const Server = SorobanRpc.Server;
import { 
  AssetInfo, 
  Balance, 
  TransferOptions, 
  TransactionOptions, 
  RWASDKConfig, 
  RWASDKError,
  AllowanceInfo,
  ApproveOptions,
  ErrorCode
} from './types';
import { RWASDKError as RWASDKErrorClass, contractErrorToCode, TimeoutError, InsufficientBalanceError, UnauthorizedError, TransactionError, ContractError, InvalidParametersError } from './errors';
import { DEFAULT_DECIMALS, DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, DEFAULT_PAGINATION_LIMIT } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateRange } from './validation';

export class TokenClient {
  private server: InstanceType<typeof Server>;
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

  // ─── Allowance Management (Issue #204) ─────────────────────────────────────

  /**
   * Approve a spender to transfer up to `amount` tokens on behalf of `owner`.
   *
   * Calls the Soroban SEP-41 `approve(owner, spender, amount, expiration_ledger)` entry point.
   * Returns the transaction hash of the submitted approval transaction.
   */
  async approve(
    owner: Address,
    spender: Address,
    amount: string,
    options: ApproveOptions = {}
  ): Promise<string> {
    validateAddress(owner, 'owner');
    validateAddress(spender, 'spender');
    // Allow '0' as a valid amount for approve — it revokes the allowance (SEP-41 compliant)
    if (amount !== '0') {
      validateAmount(amount, 'amount');
    } else if (typeof amount !== 'string') {
      throw new RWASDKErrorClass(ErrorCode.INVALID_PARAMETERS, 'amount must be a string');
    }
    this.logger.info('Approving allowance', {
      owner: owner.toString(),
      spender: spender.toString(),
      amount,
    });
    try {
      const account = await this.server.getAccount(owner.toString());

      // expiration_ledger: 0 means no expiry in this contract implementation
      const expirationLedger = options.expirationLedger != null
        ? new ScInt(options.expirationLedger)
        : new ScInt(0);

      const call = this.contract.call(
        'approve',
        new Address(owner),
        new Address(spender),
        new ScInt(amount, xdr.ScValType.ScvI128),
        expirationLedger
      );

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase,
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, owner);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Allowance approved', {
        owner: owner.toString(),
        spender: spender.toString(),
        amount,
        hash: result.hash,
      });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Query how many tokens `spender` is still allowed to transfer on behalf of `owner`.
   *
   * Calls the read-only Soroban `allowance(owner, spender)` entry point and returns
   * the current approved amount as a string.
   */
  async allowance(owner: Address, spender: Address): Promise<string> {
    validateAddress(owner, 'owner');
    validateAddress(spender, 'spender');
    this.logger.info('Querying allowance', {
      owner: owner.toString(),
      spender: spender.toString(),
    });
    try {
      const result = await this.contract.call(
        'allowance',
        new Address(owner),
        new Address(spender)
      );
      const native = scValToNative(result.result);
      return native?.toString() ?? '0';
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Transfer tokens from `from` to `to` using an existing allowance granted to `spender`.
   *
   * Calls the Soroban SEP-41 `transfer_from(spender, from, to, amount)` entry point.
   * Throws an INSUFFICIENT_ALLOWANCE error when the spender's allowance is too low.
   * Returns the transaction hash.
   */
  async transferFrom(
    spender: Address,
    from: Address,
    to: Address,
    amount: string,
    options: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(spender, 'spender');
    validateAddress(from, 'from');
    validateAddress(to, 'to');
    validateAmount(amount, 'amount');
    this.logger.info('Transferring tokens via allowance', {
      spender: spender.toString(),
      from: from.toString(),
      to: to.toString(),
      amount,
    });
    try {
      // Pre-check allowance to give a meaningful SDK-level error before the TX fails
      const currentAllowance = await this.allowance(from, spender);
      if (BigInt(currentAllowance) < BigInt(amount)) {
        throw new RWASDKErrorClass(
          ErrorCode.INSUFFICIENT_ALLOWANCE,
          `Insufficient allowance: spender ${spender.toString()} has allowance of ${currentAllowance} but requested ${amount}`
        );
      }

      const account = await this.server.getAccount(spender.toString());

      const call = this.contract.call(
        'transfer_from',
        new Address(spender),
        new Address(from),
        new Address(to),
        new ScInt(amount, xdr.ScValType.ScvI128)
      );

      const transaction = new TransactionBuilder(account, {
        fee: options.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase,
      })
        .addOperation(call)
        .setTimeout(options.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, spender);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('transferFrom completed', {
        spender: spender.toString(),
        from: from.toString(),
        to: to.toString(),
        amount,
        hash: result.hash,
      });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Increase the spending allowance granted to `spender` by `addedAmount`.
   *
   * Convenience wrapper: reads the current allowance then calls `approve` with
   * `current + addedAmount`, avoiding the two-step approve(0)/approve(new) race condition.
   * Returns the transaction hash.
   */
  async increaseAllowance(
    owner: Address,
    spender: Address,
    addedAmount: string,
    options: ApproveOptions = {}
  ): Promise<string> {
    validateAddress(owner, 'owner');
    validateAddress(spender, 'spender');
    validateAmount(addedAmount, 'addedAmount');
    this.logger.info('Increasing allowance', {
      owner: owner.toString(),
      spender: spender.toString(),
      addedAmount,
    });

    const current = await this.allowance(owner, spender);
    const newAmount = (BigInt(current) + BigInt(addedAmount)).toString();
    return this.approve(owner, spender, newAmount, options);
  }

  /**
   * Decrease the spending allowance granted to `spender` by `subtractedAmount`.
   *
   * Convenience wrapper: reads the current allowance then calls `approve` with
   * `current - subtractedAmount`. Throws `INVALID_ALLOWANCE_AMOUNT` if
   * `subtractedAmount` exceeds the current allowance.
   * Returns the transaction hash.
   */
  async decreaseAllowance(
    owner: Address,
    spender: Address,
    subtractedAmount: string,
    options: ApproveOptions = {}
  ): Promise<string> {
    validateAddress(owner, 'owner');
    validateAddress(spender, 'spender');
    validateAmount(subtractedAmount, 'subtractedAmount');
    this.logger.info('Decreasing allowance', {
      owner: owner.toString(),
      spender: spender.toString(),
      subtractedAmount,
    });

    const current = await this.allowance(owner, spender);
    if (BigInt(subtractedAmount) > BigInt(current)) {
      throw new RWASDKErrorClass(
        ErrorCode.INVALID_ALLOWANCE_AMOUNT,
        `Cannot decrease allowance by ${subtractedAmount}: current allowance is only ${current}`
      );
    }
    const newAmount = (BigInt(current) - BigInt(subtractedAmount)).toString();
    return this.approve(owner, spender, newAmount, options);
  }

  /**
   * Parse a raw Stellar contract event into a structured allowance event object.
   *
   * Recognises events emitted by `approve` and `transfer_from` contract calls.
   * Returns `null` for unrecognised event types.
   */
  parseAllowanceEvent(rawEvent: {
    type: string;
    contractId?: string;
    topics: string[];
    data: any;
  }): {
    eventType: 'approve' | 'transfer_from';
    owner?: string;
    spender?: string;
    from?: string;
    to?: string;
    amount: string;
    txHash?: string;
  } | null {
    try {
      const [topic0, topic1, topic2, topic3] = rawEvent.topics ?? [];

      if (topic0 === 'approve') {
        return {
          eventType: 'approve',
          owner: topic1,
          spender: topic2,
          amount: rawEvent.data?.toString() ?? '0',
        };
      }

      if (topic0 === 'transfer_from') {
        return {
          eventType: 'transfer_from',
          spender: topic1,
          from: topic2,
          to: topic3,
          amount: rawEvent.data?.toString() ?? '0',
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  // ─── End Allowance Management ──────────────────────────────────────────────

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
