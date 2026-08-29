// Main SDK exports
import { Address } from 'stellar-sdk';
import { AssetFactory } from './assetFactory';
import { TokenClient } from './tokenClient';
import { DividendClient } from './dividendClient';
import { MarketClient } from './marketClient';
import { ComplianceClient } from './complianceClient';
import { CustodyClient } from './custody';
import { CustodyMonitoring } from './custodyMonitoring';
import { InvalidParametersError, RWASDKError, NetworkError, ContractError, TransactionError, HorizonError, parseHorizonError, describeHorizonError } from './errors';
import { DEFAULT_DECIMALS, DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, STELLAR_NETWORKS } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateContractId, validateBoolean, validateEnum, validateRange } from './validation';
import type {
  RWASDKConfig,
  AssetInfo,
  Balance,
  TransactionOptions,
  DeploymentOptions,
  Portfolio,
  AssetHolding,
  SimulationResult,
  SimulationEvent,
  StorageChange,
  SimulationOptions,
  BatchTransactionOperation,
  BatchTransactionResult,
} from './types';

// Type exports
export * from './types';

// Custody-related exports
export {
    CustodyClient,
    type CustodyAttestation,
    type CustodianRegistry,
    type DisputeRecord,
    type VerificationTypeConfig,
    type InsuranceIntegration,
    type CustodianProfile,
    type ProofData
} from './custody';

export {
    CustodyMonitoring,
    type CustodyAlert,
    type CustodianMetrics,
    type AssetDepreciationData,
    type InsuranceStatus,
    type MonitoringConfig
} from './custodyMonitoring';

// Error exports — selective to avoid re-exporting RWASDKError class under the
// same name as the RWASDKError interface that comes from `export * from './types'`.
// Consumers who need the class can use RWASDKErrorClass.
export {
  RWASDKError as RWASDKErrorClass,
  NetworkError,
  TransactionError,
  InsufficientBalanceError,
  ComplianceError,
  UnauthorizedError,
  InvalidParametersError,
  TimeoutError,
  ContractError,
  OracleError,
  AssetNotFoundError,
  OrderNotFoundError,
  DistributionNotFoundError,
  ProofNotFoundError,
  KYCNotVerifiedError,
  AssetFrozenError,
  TransferPausedError,
  CustodyError,
  VerificationFailedError,
  InsufficientBondError,
  HorizonError,
  parseHorizonError,
  describeHorizonError,
  getErrorInfo,
  contractErrorToCode,
  describeContractError,
  fromContractError,
  ERROR_DESCRIPTIONS,
  SUGGESTED_ACTIONS,
  type ErrorInfo,
} from './errors';

// ─── BatchTransactionBuilder ──────────────────────────────────────────────────

/**
 * Maximum number of operations per batch.
 * Stellar protocol allows up to 100 operations per transaction; we cap at 50
 * to leave room for fee-bump and auth operations.
 */
const BATCH_MAX_OPS = 50;

/** Default per-operation fee contribution in stroops when none is specified. */
const BATCH_BASE_OP_FEE = 100;

/** Fixed overhead added on top of summed per-operation fees to cover envelope costs. */
const BATCH_OVERHEAD_FEE = 1000;

/**
 * Builder for creating and submitting multi-operation Stellar transactions.
 *
 * All operations added via {@link add} are collected and then submitted as a
 * single **atomic** Stellar transaction when {@link submit} is called.
 * Stellar's atomicity guarantee means any failure causes the entire batch to
 * revert — no partial state changes are ever committed on-chain.
 *
 * Cross-contract batches are fully supported: each
 * {@link BatchTransactionOperation} may target a different contract.
 *
 * @example
 * ```ts
 * const batch = sdk.createBatch();
 *
 * batch
 *   .add({ label: 'mint',       contractId: tokenAddr,    functionName: 'mint',                args: [toScVal(to), toScVal(amount)] })
 *   .add({ label: 'distribute', contractId: dividendAddr, functionName: 'create_distribution', args: [toScVal(opts)] });
 *
 * console.log('estimated gas:', batch.estimateGas());
 * const result = await batch.submit(sourceAddress);
 * console.log('tx hash:', result.transactionHash);
 * ```
 */
export class BatchTransactionBuilder {
  private readonly operations: BatchTransactionOperation[] = [];
  private readonly serverUrl: string;
  private readonly networkPassphrase: string;
  private readonly logger: Logger;

  constructor(serverUrl: string, networkPassphrase: string) {
    validateServerUrl(serverUrl, 'serverUrl');
    validateNonEmptyString(networkPassphrase, 'networkPassphrase');
    this.serverUrl = serverUrl;
    this.networkPassphrase = networkPassphrase;
    this.logger = createLogger('BatchTransactionBuilder');
  }

  // ─── add ───────────────────────────────────────────────────────────────────

  /**
   * Append a contract-call operation to the batch.
   *
   * @param operation - Descriptor with `label`, `contractId`, `functionName`,
   *   `args`, and an optional per-operation `fee`.
   * @returns `this` — supports method chaining.
   * @throws {InvalidParametersError} if the batch is already full (≥ {@link BATCH_MAX_OPS})
   *   or if required fields are missing/invalid.
   */
  add(operation: BatchTransactionOperation): this {
    if (this.operations.length >= BATCH_MAX_OPS) {
      throw new InvalidParametersError(
        `Batch cannot exceed ${BATCH_MAX_OPS} operations (currently ${this.operations.length}). ` +
        `Split into multiple batches.`
      );
    }
    validateNonEmptyString(operation.label,        'operation.label');
    validateNonEmptyString(operation.contractId,   'operation.contractId');
    validateNonEmptyString(operation.functionName, 'operation.functionName');
    if (!Array.isArray(operation.args)) {
      throw new InvalidParametersError('operation.args must be an array');
    }
    if (operation.fee != null && (typeof operation.fee !== 'number' || operation.fee <= 0)) {
      throw new InvalidParametersError('operation.fee must be a positive number when provided');
    }

    this.operations.push({ ...operation });
    this.logger.info('Operation queued in batch', {
      label: operation.label,
      contractId: operation.contractId,
      functionName: operation.functionName,
      totalOps: this.operations.length,
    });
    return this;
  }

  // ─── build ─────────────────────────────────────────────────────────────────

  /**
   * Return a snapshot of all queued operations without submitting.
   *
   * Useful for previewing or serialising the batch before calling
   * {@link submit}.
   *
   * @throws {InvalidParametersError} if the batch is empty.
   */
  build(): BatchTransactionOperation[] {
    if (this.operations.length === 0) {
      throw new InvalidParametersError(
        'Cannot build an empty batch — add at least one operation first'
      );
    }
    return [...this.operations];
  }

  // ─── estimateGas ───────────────────────────────────────────────────────────

  /**
   * Estimate the total fee for this batch in stroops.
   *
   * Formula: `sum(op.fee ?? BATCH_BASE_OP_FEE) + BATCH_OVERHEAD_FEE`
   *
   * @returns Estimated total fee as a decimal string.
   */
  estimateGas(): string {
    const opsTotal = this.operations.reduce(
      (sum, op) => sum + (op.fee ?? BATCH_BASE_OP_FEE),
      0,
    );
    return String(opsTotal + BATCH_OVERHEAD_FEE);
  }

  // ─── submit ────────────────────────────────────────────────────────────────

  /**
   * Build and submit all queued operations as a single atomic Stellar transaction.
   *
   * **Atomicity**: if any operation is rejected on-chain, Stellar reverts the
   * entire transaction. `operationResults` in the thrown error will mark every
   * operation as failed.
   *
   * @param source    - The Stellar account that signs the transaction.
   * @param txOptions - Optional fee and timeout overrides.
   * @returns {@link BatchTransactionResult} with the hash and per-operation outcomes.
   * @throws {InvalidParametersError} if the batch is empty or `source` is invalid.
   * @throws {TransactionError} wrapping the network failure with full
   *   `operationResults` so callers can diagnose which entry caused the revert.
   */
  async submit(
    source: Address,
    txOptions: TransactionOptions = {},
  ): Promise<BatchTransactionResult> {
    validateAddress(source, 'source');
    if (this.operations.length === 0) {
      throw new InvalidParametersError(
        'Cannot submit an empty batch — call add() with at least one operation first'
      );
    }
    if (txOptions.fee != null && (typeof txOptions.fee !== 'number' || txOptions.fee <= 0)) {
      throw new InvalidParametersError('txOptions.fee must be a positive number');
    }
    if (txOptions.timeout != null && (typeof txOptions.timeout !== 'number' || txOptions.timeout <= 0)) {
      throw new InvalidParametersError('txOptions.timeout must be a positive number');
    }

    const estimatedFee = parseInt(this.estimateGas(), 10);
    const fee = txOptions.fee ?? estimatedFee;

    this.logger.info('Submitting batch transaction', {
      source: source.toString(),
      operationCount: this.operations.length,
      estimatedFee,
    });

    try {
      const { SorobanRpc, TransactionBuilder, Operation } = await import('stellar-sdk');
      const server = new SorobanRpc.Server(this.serverUrl);
      const account = await server.getAccount(source.toString());

      const builder = new TransactionBuilder(account, {
        fee: fee.toString(),
        networkPassphrase: this.networkPassphrase,
      });

      for (const op of this.operations) {
        builder.addOperation(
          Operation.invokeContractFunction({
            contract: op.contractId,
            function: op.functionName,
            args: op.args as any[],
          }),
        );
      }

      const tx = builder
        .setTimeout(txOptions.timeout ?? DEFAULT_TIMEOUT_SECONDS)
        .build();

      const response = await server.sendTransaction(tx);
      if ((response as any).status === 'ERROR') {
        throw new TransactionError(
          `Batch rejected by network: ${JSON.stringify((response as any).errorResult ?? '')}`
        );
      }

      const hash: string = (response as any).hash;
      const operationResults: BatchTransactionResult['operationResults'] =
        this.operations.map(op => ({ label: op.label, success: true }));

      this.logger.info('Batch transaction submitted successfully', {
        hash,
        operationCount: this.operations.length,
      });

      return {
        transactionHash: hash,
        success: true,
        operationResults,
        totalFee: fee.toString(),
        estimatedGas: estimatedFee.toString(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Batch transaction failed — all operations reverted', {
        error: msg,
        operationCount: this.operations.length,
      });

      const operationResults: BatchTransactionResult['operationResults'] =
        this.operations.map(op => ({ label: op.label, success: false, errorMessage: msg }));

      throw new TransactionError(
        `Batch failed — all ${this.operations.length} operations reverted: ${msg}`,
        { operationResults },
      );
    }
  }

  // ─── Utility ───────────────────────────────────────────────────────────────

  /** Number of operations currently queued. */
  get size(): number {
    return this.operations.length;
  }

  /** Remove all queued operations and reset to an empty state. */
  clear(): void {
    this.operations.length = 0;
    this.logger.info('Batch cleared');
  }
}

// Configuration utilities
export class StellarRWASDK {
  private config: RWASDKConfig;
  private logger: Logger;
  
  // Client instances
  public assetFactory: AssetFactory;
  public complianceClient: ComplianceClient;
  public dividendClient: DividendClient;
  public marketClient: MarketClient;
  public custodyClient: CustodyClient;

  private _portfolioCache: Map<string, { data: Portfolio; expiry: number }> = new Map();

  constructor(config: RWASDKConfig) {
    validateServerUrl(config.stellar.serverUrl, 'config.stellar.serverUrl');
    validateNonEmptyString(config.stellar.passphrase, 'config.stellar.passphrase');
    this.config = config;
    this.logger = createLogger('StellarRWASDK');
    this.logger.info('Initializing SDK', { network: config.stellar.network, serverUrl: config.stellar.serverUrl });
    
    // Initialize all clients
    this.assetFactory = new AssetFactory(
      config.stellar.serverUrl,
      config.contracts.assetFactory,
      config.stellar.passphrase
    );
    this.complianceClient = new ComplianceClient(config);
    this.dividendClient = new DividendClient(config);
    this.marketClient = new MarketClient(config);
    this.custodyClient = new CustodyClient(
      config.contracts.custodyValidator,
      config.stellar.serverUrl,
      config.stellar.passphrase
    );
    this.logger.info('SDK initialized successfully');
  }

  /**
   * Create a token client for a specific RWA token
   */
  createTokenClient(tokenAddress: Address): TokenClient {
    if (tokenAddress == null) {
      throw new InvalidParametersError('tokenAddress is required');
    }
    return new TokenClient(this.config, tokenAddress);
  }

  /**
   * Create a new {@link BatchTransactionBuilder} pre-configured with this
   * SDK's network settings.
   *
   * Use the returned builder to queue multiple contract-call operations and
   * then submit them as a single atomic Stellar transaction.
   *
   * @example
   * ```ts
   * const batch = sdk.createBatch();
   * batch.add({ label: 'mint', contractId: token, functionName: 'mint', args });
   * batch.add({ label: 'lock', contractId: token, functionName: 'lock_tokens', args });
   * const result = await batch.submit(signerAddress);
   * ```
   */
  createBatch(): BatchTransactionBuilder {
    return new BatchTransactionBuilder(
      this.config.stellar.serverUrl,
      this.config.stellar.passphrase,
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): RWASDKConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RWASDKConfig>): void {
    if (newConfig.stellar?.serverUrl) {
      validateServerUrl(newConfig.stellar.serverUrl, 'config.stellar.serverUrl');
    }
    if (newConfig.stellar?.passphrase) {
      validateNonEmptyString(newConfig.stellar.passphrase, 'config.stellar.passphrase');
    }
    if (newConfig.contracts?.assetFactory) {
      validateAddress(newConfig.contracts.assetFactory, 'config.contracts.assetFactory');
    }
    if (newConfig.contracts?.complianceRegistry) {
      validateAddress(newConfig.contracts.complianceRegistry, 'config.contracts.complianceRegistry');
    }
    if (newConfig.contracts?.dividendDistributor) {
      validateAddress(newConfig.contracts.dividendDistributor, 'config.contracts.dividendDistributor');
    }
    if (newConfig.contracts?.secondaryMarket) {
      validateAddress(newConfig.contracts.secondaryMarket, 'config.contracts.secondaryMarket');
    }
    if (newConfig.contracts?.custodyValidator) {
      validateAddress(newConfig.contracts.custodyValidator, 'config.contracts.custodyValidator');
    }
    this.logger.info('Updating SDK configuration', { newConfig: Object.keys(newConfig) });
    this.config = { ...this.config, ...newConfig };
    
    // Reinitialize clients with new config
    this.assetFactory = new AssetFactory(
      this.config.stellar.serverUrl,
      this.config.contracts.assetFactory,
      this.config.stellar.passphrase
    );
    this.complianceClient = new ComplianceClient(this.config);
    this.dividendClient = new DividendClient(this.config);
    this.marketClient = new MarketClient(this.config);
    this.custodyClient = new CustodyClient(
      this.config.contracts.custodyValidator,
      this.config.stellar.serverUrl,
      this.config.stellar.passphrase
    );
    this.logger.info('SDK configuration updated');
  }

  /**
   * Get network information
   */
  async getNetworkInfo(): Promise<{
    network: string;
    serverUrl: string;
    horizonUrl?: string;
    latestLedger: number;
    protocolVersion: number;
  }> {
    try {
      const server = new (await import('stellar-sdk')).Server(this.config.stellar.serverUrl);
      const network = await server.network();
      
      return {
        network: this.config.stellar.network,
        serverUrl: this.config.stellar.serverUrl,
        horizonUrl: this.config.stellar.horizonUrl,
        latestLedger: network.latestLedger,
        protocolVersion: network.protocolVersion
      };
    } catch (error) {
      throw new NetworkError(`Failed to get network info: ${error.message}`);
    }
  }

  /**
   * Validate configuration
   */
  validateConfig(): void {
    if (!this.config.stellar) {
      throw new InvalidParametersError('Stellar configuration is required');
    }

    if (!this.config.stellar.network) {
      throw new InvalidParametersError('Stellar network is required');
    }

    if (!this.config.stellar.serverUrl) {
      throw new InvalidParametersError('Stellar server URL is required');
    }

    if (!this.config.stellar.passphrase) {
      throw new InvalidParametersError('Stellar passphrase is required');
    }

    if (!this.config.contracts) {
      throw new InvalidParametersError('Contracts configuration is required');
    }

    const requiredContracts = [
      'assetFactory',
      'complianceRegistry',
      'dividendDistributor',
      'secondaryMarket',
      'custodyValidator'
    ];

    for (const contract of requiredContracts) {
      if (!this.config.contracts[contract]) {
        throw new InvalidParametersError(`${contract} contract address is required`);
      }
    }
  }

  /**
   * Create a complete RWA token deployment workflow
   */
  async deployCompleteRWAToken(
    deployer: Address,
    options: DeploymentOptions,
    txOptions: TransactionOptions = {}
  ): Promise<{
    tokenAddress: Address;
    assetFactoryHash: string;
    complianceHash: string;
    dividendHash: string;
    marketHash: string;
  }> {
    validateAddress(deployer, 'deployer');
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
    try {
      // Step 1: Deploy the RWA token
      const tokenResult = await this.assetFactory.deployRWAToken(
        deployer,
        options,
        txOptions
      );

      // Step 2: Initialize compliance for the token (if needed)
      let complianceHash = '';
      if (options.initializeCompliance) {
        complianceHash = await this.complianceClient.initialize(
          deployer,
          deployer, // Use deployer as admin
          options.kycRequired || true,
          options.transferRestrictions || true,
          txOptions
        );
      }

      // Step 3: Add token to secondary market
      const marketHash = await this.marketClient.addSupportedToken(
        deployer,
        tokenResult.tokenAddress,
        txOptions
      );

      // Step 4: Initialize dividend distributor (if needed)
      let dividendHash = '';
      if (options.initializeDividends) {
        // This would be handled by the asset factory during token deployment
        dividendHash = tokenResult.assetFactoryHash;
      }

      return {
        tokenAddress: tokenResult.tokenAddress,
        assetFactoryHash: tokenResult.transactionHash,
        complianceHash,
        dividendHash,
        marketHash
      };
    } catch (error) {
      throw new ContractError(`Complete deployment failed: ${error.message}`);
    }
  }

  /**
   * Get comprehensive portfolio overview for a user
   */
  async getUserPortfolio(user: Address): Promise<Portfolio> {
    validateAddress(user, 'user');

    const cacheKey = user.toString();
    const cached = this._portfolioCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    try {
      const assets = await this.assetFactory.getAllAssets();
      if (!assets || assets.length === 0) {
        return { assets: [], totalValue: '0', totalDividends: '0', votingPower: '0' };
      }

      const tokenClients = assets.map((asset: any) => {
        const addr = asset.token_address || asset.address;
        return addr ? this.createTokenClient(new Address(addr)) : null;
      }).filter(Boolean) as TokenClient[];

      const balances = await Promise.allSettled(
        tokenClients.map((tc) => tc.getBalance(user))
      );

      const holdings: Portfolio['assets'] = [];
      let totalValue = 0n;
      let totalDividends = 0n;
      let totalVotingPower = 0n;

      for (let i = 0; i < balances.length; i++) {
        const result = balances[i];
        if (result.status !== 'fulfilled') continue;
        const bal = result.value;
        const assetVal = BigInt(bal.amount || '0');
        const locked = BigInt(bal.lockedAmount || '0');
        const value = assetVal + locked;
        totalValue += value;
        totalDividends += BigInt(bal.votingPower || '0');
        totalVotingPower += BigInt(bal.votingPower || '0');

        const info = await tokenClients[i].getTokenInfo().catch(() => null);
        holdings.push({
          asset: info as any,
          balance: bal,
          value: value.toString(),
          percentage: 0,
          dividends: bal.votingPower || '0',
        });
      }

      const totalValueBN = totalValue;
      for (const h of holdings) {
        h.percentage = totalValueBN > 0n
          ? Number((BigInt(h.value) * 10000n) / totalValueBN) / 100
          : 0;
      }

      const portfolio: Portfolio = {
        assets: holdings,
        totalValue: totalValue.toString(),
        totalDividends: totalDividends.toString(),
        votingPower: totalVotingPower.toString(),
      };

      this._portfolioCache.set(cacheKey, { data: portfolio, expiry: Date.now() + 60_000 });
      return portfolio;
    } catch (error) {
      throw new ContractError(`Failed to get user portfolio: ${error.message}`);
    }
  }

  /**
   * Alias for getUserPortfolio
   */
  async getPortfolio(user: Address): Promise<Portfolio> {
    return this.getUserPortfolio(user);
  }

  /**
   * Get platform-wide statistics
   */
  async getPlatformStats(): Promise<{
    totalAssets: number;
    totalVolume24h: string;
    totalMarketCap: string;
    activeOrders: number;
    activeDistributions: number;
    verifiedAssets: number;
    totalUsers: number;
    complianceRate: number;
  }> {
    try {
      // This would aggregate data from all contracts
      // For now, return a placeholder implementation
      throw new ContractError('getPlatformStats not implemented');
    } catch (error) {
      throw new ContractError(`Failed to get platform stats: ${error.message}`);
    }
  }

  /**
   * Simulate a transaction before submission to catch errors without spending gas.
   * (Issue #208)
   *
   * @param tx - The Stellar transaction to simulate
   * @param options - Optional simulation settings (skipSimulation, feeEstimation)
   * @returns SimulationResult with success status, events, gasUsed, and storageChanges
   */
  async simulateTransaction(
    tx: any,
    options: SimulationOptions = {}
  ): Promise<SimulationResult> {
    if (options.skipSimulation) {
      return {
        success: true,
        events: [],
        gasUsed: '0',
        storageChanges: [],
      };
    }

    try {
      const server = new (await import('stellar-sdk')).Server(this.config.stellar.serverUrl);
      const simulation = await server.simulateTransaction(tx);

      // Extract events from simulation
      const events: SimulationEvent[] = (simulation.events || []).map((evt: any) => ({
        contractId: evt.contractId || '',
        topics: evt.topic || [],
        data: evt.data || null,
      }));

      // Extract storage changes
      const storageChanges: StorageChange[] = (simulation.stateChanges || [])
        .filter((change: any) => change.type === 'contract_data')
        .map((change: any) => ({
          contractId: change.contractId || '',
          key: change.key || '',
          oldValue: change.oldValue,
          newValue: change.newValue,
        }));

      // Determine success from simulation result
      const isSuccess = simulation.result !== undefined && !simulation.error;
      const errorMessage = simulation.error || (isSuccess ? undefined : 'Simulation returned no result');

      const result: SimulationResult = {
        success: isSuccess,
        events,
        returnValue: simulation.result || null,
        gasUsed: String(simulation.cost?.cpuInsns || 0),
        storageChanges,
        errorMessage,
      };

      if (!isSuccess) {
        this.logger.warn('Transaction simulation failed', { errorMessage, gasUsed: result.gasUsed });
      } else {
        this.logger.info('Transaction simulation succeeded', { gasUsed: result.gasUsed });
      }

      return result;
    } catch (error) {
      this.logger.error('Transaction simulation error', { error: error.message });
      throw new TransactionError(`Transaction simulation failed: ${error.message}`, error);
    }
  }

  /**
   * Validate a transaction via pre-flight simulation before submission.
   * (Issue #208)
   *
   * This provides a pre-submission validation layer. The actual transaction
   * submission is handled by individual client methods (assetFactory, marketClient,
   * etc.), which should call simulateTransaction internally before submitting.
   *
   * Use skipSimulation: true for trusted/recurring transactions.
   *
   * @param tx - The Stellar transaction to validate
   * @param txOptions - Options including skipSimulation
   * @returns Simulation result if validation passed
   * @throws TransactionError if simulation fails
   */
  async validateAndSimulate(
    tx: any,
    txOptions: TransactionOptions & SimulationOptions = {}
  ): Promise<SimulationResult> {
    const simulation = await this.simulateTransaction(tx, { feeEstimation: true, ...txOptions });
    if (!simulation.success) {
      throw new TransactionError(
        `Transaction validation failed: ${simulation.errorMessage}`,
        { simulation }
      );
    }
    return simulation;
  }
}

// ─── Factory Function ─────────────────────────────────────────────────────────

// Factory function to create SDK instance with common configurations
export function createStellarRWASDK(
  network: 'testnet' | 'mainnet' | 'futurenet' | 'standalone',
  contracts: {
    assetFactory: Address;
    complianceRegistry: Address;
    dividendDistributor: Address;
    secondaryMarket: Address;
    custodyValidator: Address;
  },
  options?: {
    serverUrl?: string;
    horizonUrl?: string;
    defaultFeeRate?: number;
    defaultTimeout?: number;
  }
): StellarRWASDK {
  const config = STELLAR_NETWORKS[network];
  
  const sdkConfig: RWASDKConfig = {
    stellar: {
      network,
      serverUrl: options?.serverUrl || config.serverUrl,
      horizonUrl: options?.horizonUrl || config.horizonUrl,
      passphrase: config.passphrase
    },
    contracts,
    defaultFeeRate: options?.defaultFeeRate || DEFAULT_FEE_RATE,
    defaultTimeout: options?.defaultTimeout || DEFAULT_TIMEOUT_SECONDS
  };

  return new StellarRWASDK(sdkConfig);
}

// Utility functions
export function isValidAddress(address: string): boolean {
  try {
    const { Address: StellarAddress } = require('stellar-sdk');
    new StellarAddress(address);
    return true;
  } catch {
    return false;
  }
}

function safeBigInt(value: string | number): bigint {
  try {
    const str = typeof value === 'number' ? Math.floor(value).toString() : value;
    return BigInt(str);
  } catch {
    return 0n;
  }
}

export function formatAmount(amount: string | number, decimals: number = DEFAULT_DECIMALS): string {
  validateAmount(amount, 'amount');
  const num = safeBigInt(amount);
  const divisor = safeBigInt(10) ** safeBigInt(decimals);
  const whole = num / divisor;
  const fractional = num % divisor;
  
  if (fractional === 0n) {
    return whole.toString();
  }
  
  const fractionalStr = fractional.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');
  
  return `${whole}.${trimmedFractional}`;
}

export function parseAmount(amount: string, decimals: number = DEFAULT_DECIMALS): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new InvalidParametersError('Invalid amount format');
  }
  const [whole, fractional = ''] = amount.split('.');
  const wholeBigInt = safeBigInt(whole.replace(/[^0-9-]/g, '') || '0');
  const fractionalBigInt = fractional ? safeBigInt(fractional.padEnd(decimals, '0').slice(0, decimals)) : 0n;
  const divisor = safeBigInt(10) ** safeBigInt(decimals);
  
  return (wholeBigInt * divisor + fractionalBigInt).toString();
}

// ─── Default export ───────────────────────────────────────────────────────────
export default StellarRWASDK;
