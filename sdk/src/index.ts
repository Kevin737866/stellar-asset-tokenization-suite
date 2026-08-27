// Main SDK exports
export { Address } from 'stellar-sdk';
import { AssetFactory } from './assetFactory';
import { TokenClient } from './tokenClient';
import { DividendClient } from './dividendClient';
import { MarketClient } from './marketClient';
import { ComplianceClient } from './complianceClient';
import { CustodyClient } from './custody';
import { CustodyMonitoring } from './custodyMonitoring';
import { InvalidParametersError, RWASDKError, NetworkError, ContractError, TransactionError, HorizonError, parseHorizonError, describeHorizonError } from './errors';
import { DEFAULT_DECIMALS, DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, STELLAR_NETWORKS } from './constants';
import { withRetry, defaultRetryConfig } from './errors';
import type { RetryConfig, WithRetryOptions, RetryEventListener } from './errors';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateContractId, validateBoolean, validateEnum, validateRange } from './validation';

// Type exports
export * from './types';

// Custody-related exports
export {
    CustodyClient,
    CustodyMonitoring,
    type CustodyAttestation,
    type CustodianRegistry,
    type DisputeRecord,
    type VerificationTypeConfig,
    type InsuranceIntegration,
    type CustodianProfile,
    type ProofData
} from './custody';

export {
    type CustodyAlert,
    type CustodianMetrics,
    type AssetDepreciationData,
    type InsuranceStatus,
    type MonitoringConfig
} from './custodyMonitoring';

// Error exports - avoid re-exporting RWASDKError since it's already exported from types
export * from './errors';

// Retry / backoff exports (Issue #191)
export {
  withRetry,
  classifyError,
  isRetryableError,
  computeRetryDelay,
  defaultRetryConfig,
  RateLimitError,
  MempoolFullError
} from './errors';
export type {
  RetryConfig,
  WithRetryOptions,
  RetryEvent,
  RetryEventType,
  RetryEventListener,
  RetryClassification
} from './errors';
export {
  DEFAULT_RETRY_CONFIG,
  RETRYABLE_HTTP_STATUS_CODES,
  RETRYABLE_NETWORK_ERROR_CODES,
  RETRYABLE_STELLAR_RESULT_CODES
} from './constants';
export {
  HorizonError,
  parseHorizonError,
  describeHorizonError,
  type ParsedHorizonError
} from './errors';

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

  /** Active retry policy for transient network failures (Issue #191). */
  public retryConfig: RetryConfig;
  private _retryListener?: RetryEventListener;

  constructor(config: RWASDKConfig & { retry?: Partial<RetryConfig> }) {
    validateServerUrl(config.stellar.serverUrl, 'config.stellar.serverUrl');
    validateNonEmptyString(config.stellar.passphrase, 'config.stellar.passphrase');
    this.config = config;
    this.retryConfig = { ...defaultRetryConfig, ...(config.retry ?? {}) };
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
   * Register a listener for retry lifecycle events (retry / exhausted /
   * succeeded) so a UI can surface backoff progress. (Issue #191)
   */
  onRetry(listener: RetryEventListener): void {
    this._retryListener = listener;
  }

  /**
   * Run an operation with the SDK's retry policy. Transient failures
   * (network timeout, HTTP 429, Horizon 504, mempool full) are retried with
   * exponential backoff; deterministic failures (invalid signature,
   * insufficient funds, contract errors) are re-thrown immediately.
   * (Issue #191)
   */
  async withRetry<T>(
    fn: (attempt: number) => Promise<T>,
    options: WithRetryOptions = {}
  ): Promise<T> {
    return withRetry(fn, {
      config: this.retryConfig,
      onRetryEvent: this._retryListener,
      ...options,
    });
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

// Re-export types for convenience
import type { 
  RWASDKConfig, 
  Address, 
  AssetInfo, 
  Balance, 
  KYCStatus, 
  DividendDistribution, 
  Order, 
  Trade, 
  TransactionOptions, 
  DeploymentOptions,
  AssetType,
  Currency,
  OrderType,
  VerificationLevel,
  SimulationResult,
  SimulationEvent,
  StorageChange,
  SimulationOptions,
  Portfolio,
  AssetHolding
} from './types';

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

// Export all types and classes
export {
  // Types
  type RWASDKConfig,
  type Address,
  type AssetInfo,
  type Balance,
  type KYCStatus,
  type DividendDistribution,
  type Order,
  type Trade,
  type TransactionOptions,
  type DeploymentOptions,
  type AssetType,
  type Currency,
  type OrderType,
  type VerificationLevel,
  type Portfolio,
  type AssetHolding,
  
  // Classes
  StellarRWASDK as default
};
