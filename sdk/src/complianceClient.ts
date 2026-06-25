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
  KYCStatus, 
  VerificationLevel, 
  TransferLimits, 
  ComplianceRule, 
  ComplianceOptions, 
  TransactionOptions, 
  RWASDKConfig, 
  RWASDKError
} from './types';
import { RWASDKError as RWASDKErrorClass, contractErrorToCode, TimeoutError, InsufficientBalanceError, UnauthorizedError, ContractError } from './errors';
import { DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, DEFAULT_PAGINATION_LIMIT } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateBoolean, validateRange } from './validation';

export class ComplianceClient {
  private server: Server;
  private contract: Contract;
  private config: RWASDKConfig;
  private logger: Logger;

  constructor(config: RWASDKConfig) {
    validateServerUrl(config.stellar.serverUrl, 'config.stellar.serverUrl');
    validateAddress(config.contracts.complianceRegistry, 'config.contracts.complianceRegistry');
    this.config = config;
    this.server = new Server(config.stellar.serverUrl);
    this.contract = new Contract(config.contracts.complianceRegistry);
    this.logger = createLogger('ComplianceClient');
  }

  async initialize(
    deployer: Address,
    admin: Address,
    kycRequired: boolean,
    transferRestrictions: boolean,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(deployer, 'deployer');
    validateAddress(admin, 'admin');
    validateBoolean(kycRequired, 'kycRequired');
    validateBoolean(transferRestrictions, 'transferRestrictions');
    if (txOptions.fee != null) {
      if (typeof txOptions.fee !== 'number' || txOptions.fee <= 0) {
        throw new InvalidParametersError('txOptions.fee must be a positive number');
      }
    }
    if (txOptions.timeout != null) {
      if (typeof txOptions.timeout !== 'number' || txOptions.timeout <= 0) {
        throw new InvalidParametersError('txOptions.timeout must be a positive number');
      }
    }
    this.logger.info('Initializing compliance registry', { admin: admin.toString(), kycRequired, transferRestrictions });
    try {
      const account = await this.server.getAccount(deployer.toString());
      
      const call = this.contract.call(
        'initialize',
        new Address(admin),
        kycRequired,
        transferRestrictions
      );

      const transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      })
        .addOperation(call)
        .setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS)
        .build();

      const signedTx = await this.signTransaction(transaction, deployer);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Compliance registry initialized', { hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async updateKYCStatus(
    admin: Address,
    user: Address,
    kycStatus: KYCStatus,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(user, 'user');
    this.logger.info('Updating KYC status', { user: user.toString() });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const kycStatusScVal = this.convertKYCStatusToScVal(kycStatus);
      
      const call = this.contract.call(
        'update_kyc_status',
        new Address(user),
        kycStatusScVal
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

      this.logger.info('KYC status updated', { user: user.toString(), hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getKYCStatus(user: Address): Promise<KYCStatus> {
    validateAddress(user, 'user');
    try {
      const result = await this.contract.call('get_kyc_status', new Address(user));
      const kycStatus = this.convertScValToKYCStatus(result.result);
      return kycStatus;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async addToBlacklist(
    admin: Address,
    address: Address,
    reason: string,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(address, 'address');
    validateNonEmptyString(reason, 'reason');
    this.logger.info('Adding address to blacklist', { address: address.toString(), reason });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call(
        'add_to_blacklist',
        new Address(address),
        xdr.ScVal.scvSymbol(reason)
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

      this.logger.info('Address blacklisted', { address: address.toString(), hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async removeFromBlacklist(
    admin: Address,
    address: Address,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(address, 'address');
    this.logger.info('Removing address from blacklist', { address: address.toString() });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('remove_from_blacklist', new Address(address));

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

      this.logger.info('Address removed from blacklist', { address: address.toString(), hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async addToWhitelist(
    admin: Address,
    address: Address,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(address, 'address');
    this.logger.info('Adding address to whitelist', { address: address.toString() });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('add_to_whitelist', new Address(address));

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

      this.logger.info('Address whitelisted', { address: address.toString(), hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async removeFromWhitelist(
    admin: Address,
    address: Address,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(address, 'address');
    this.logger.info('Removing address from whitelist', { address: address.toString() });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const call = this.contract.call('remove_from_whitelist', new Address(address));

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

      this.logger.info('Address removed from whitelist', { address: address.toString(), hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async checkCompliance(
    from: Address,
    to: Address,
    amount: string
  ): Promise<boolean> {
    validateAddress(from, 'from');
    validateAddress(to, 'to');
    validateAmount(amount, 'amount');
    this.logger.info('Checking compliance', { from: from.toString(), to: to.toString() });
    try {
      const result = await this.contract.call(
        'check_compliance',
        new Address(from),
        new Address(to),
        new ScInt(amount, xdr.ScValType.ScvI128)
      );
      
      const compliant = typeof result.result === 'boolean' ? result.result : false;
      this.logger.info('Compliance check result', { from: from.toString(), to: to.toString(), compliant });
      return compliant;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async checkTransferLimits(
    user: Address,
    amount: string
  ): Promise<boolean> {
    try {
      const result = await this.contract.call(
        'check_transfer_limits',
        new Address(user),
        new ScInt(amount, xdr.ScValType.ScvI128)
      );
      
      return typeof result.result === 'boolean' ? result.result : false;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async setTransferLimits(
    admin: Address,
    user: Address,
    limits: TransferLimits,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    validateAddress(user, 'user');
    this.logger.info('Setting transfer limits', { user: user.toString() });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const limitsScVal = this.convertTransferLimitsToScVal(limits);
      
      const call = this.contract.call(
        'set_transfer_limits',
        new Address(user),
        limitsScVal
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

      this.logger.info('Transfer limits set', { user: user.toString(), hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getComplianceRules(): Promise<ComplianceRule[]> {
    try {
      const result = await this.contract.call('get_compliance_rules');
      const rules = this.convertScValToComplianceRuleArray(result.result);
      return rules;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async updateComplianceRule(
    admin: Address,
    rule: ComplianceRule,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    this.logger.info('Updating compliance rule', { ruleId: rule.ruleId });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      const ruleScVal = this.convertComplianceRuleToScVal(rule);
      
      const call = this.contract.call('update_compliance_rule', ruleScVal);

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

      this.logger.info('Compliance rule updated', { ruleId: rule.ruleId, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getComplianceStats(): Promise<{
    totalVerifiedUsers: number;
    totalBlacklisted: number;
    totalWhitelisted: number;
    activeRules: number;
    complianceRate: number;
  }> {
    try {
      return {
        totalVerifiedUsers: 0,
        totalBlacklisted: 0,
        totalWhitelisted: 0,
        activeRules: 0,
        complianceRate: 0
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getUserComplianceHistory(
    user: Address,
    limit: number = DEFAULT_PAGINATION_LIMIT,
    cursor?: string
  ): Promise<{
    events: Array<{
      type: string;
      timestamp: Date;
      details: any;
    }>;
    hasMore: boolean;
    nextCursor?: string;
  }> {
    try {
      throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'getUserComplianceHistory not implemented');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async batchUpdateKYCStatus(
    admin: Address,
    updates: Array<{ user: Address; kycStatus: KYCStatus }>,
    txOptions: TransactionOptions = {}
  ): Promise<string> {
    validateAddress(admin, 'admin');
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      throw new InvalidParametersError('updates must be a non-empty array');
    }
    this.logger.info('Batch updating KYC status', { count: updates.length });
    try {
      const account = await this.server.getAccount(admin.toString());
      
      let transaction = new TransactionBuilder(account, {
        fee: txOptions.fee || this.config.defaultFeeRate || DEFAULT_FEE_RATE,
        networkPassphrase: this.config.stellar.passphrase
      });

      for (const update of updates) {
        const kycStatusScVal = this.convertKYCStatusToScVal(update.kycStatus);
        const call = this.contract.call(
          'update_kyc_status',
          new Address(update.user),
          kycStatusScVal
        );
        transaction = transaction.addOperation(call);
      }

      transaction = transaction.setTimeout(txOptions.timeout || DEFAULT_TIMEOUT_SECONDS).build();

      const signedTx = await this.signTransaction(transaction, admin);
      const result = await this.server.sendTransaction(signedTx);

      if (result.status === 'ERROR') {
        throw new TransactionError(`Transaction failed: ${result.error}`);
      }

      this.logger.info('Batch KYC update completed', { count: updates.length, hash: result.hash });
      return result.hash;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getAuditTrail(
    options: {
      limit?: number;
      cursor?: string;
      eventTypes?: string[];
      admin?: Address;
      target?: Address;
      fromTimestamp?: Date;
      toTimestamp?: Date;
    } = {}
  ): Promise<{
    entries: AuditLogEntry[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    try {
      const eventTypes = options.eventTypes || [
        'registry_initialized', 'registry_migrated',
        'kyc_updated', 'blacklisted', 'unblacklisted',
        'whitelisted', 'unwhitelisted',
        'compliance_check', 'outbound_compliance_check',
        'transfer_limit_check', 'transfer_limits_set',
        'compliance_rule_updated'
      ];

      return {
        entries: [],
        hasMore: false
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async getAuditTrailByAdmin(
    admin: Address,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<{
    entries: AuditLogEntry[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    return this.getAuditTrail({ ...options, admin });
  }

  async getAuditTrailByTarget(
    target: Address,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<{
    entries: AuditLogEntry[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    return this.getAuditTrail({ ...options, target });
  }

  private convertKYCStatusToScVal(kycStatus: KYCStatus): xdr.ScVal {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertKYCStatusToScVal not implemented');
  }

  private convertTransferLimitsToScVal(limits: TransferLimits): xdr.ScVal {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertTransferLimitsToScVal not implemented');
  }

  private convertComplianceRuleToScVal(rule: ComplianceRule): xdr.ScVal {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertComplianceRuleToScVal not implemented');
  }

  private convertScValToKYCStatus(scVal: xdr.ScVal): KYCStatus {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertScValToKYCStatus not implemented');
  }

  private convertScValToComplianceRuleArray(scVal: xdr.ScVal): ComplianceRule[] {
    throw new RWASDKErrorClass(ErrorCode.CONTRACT_ERROR, 'convertScValToComplianceRuleArray not implemented');
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
