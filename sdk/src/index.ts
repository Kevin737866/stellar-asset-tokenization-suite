// Main SDK exports
export { Address } from 'stellar-sdk';
import { AssetFactory } from './assetFactory';
import { TokenClient } from './tokenClient';
import { DividendClient } from './dividendClient';
import { MarketClient } from './marketClient';
import { ComplianceClient } from './complianceClient';
import { CustodyClient } from './custody';
import { CustodyMonitoring } from './custodyMonitoring';
import { InvalidParametersError, RWASDKError, NetworkError, ContractError } from './errors';
import { DEFAULT_DECIMALS, DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, STELLAR_NETWORKS } from './constants';
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
  async getUserPortfolio(user: Address): Promise<{
    totalValue: string;
    totalDividends: string;
    votingPower: string;
    assets: Array<{
      asset: AssetInfo;
      balance: Balance;
      value: string;
      percentage: number;
      dividends: string;
    }>;
  }> {
    try {
      // This would aggregate data from all contracts
      // For now, return a placeholder implementation
      throw new ContractError('getUserPortfolio not implemented');
    } catch (error) {
      throw new ContractError(`Failed to get user portfolio: ${error.message}`);
    }
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
  VerificationLevel
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
  
  // Classes
  StellarRWASDK as default
};
