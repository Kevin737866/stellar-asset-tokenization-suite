import {
  Server,
  TransactionBuilder,
  Asset,
  Keypair,
  Contract,
  SorobanRpc,
  xdr,
  ScInt,
  Address,
  nativeToScVal,
  scValToNative
} from '@stellar/stellar-sdk';

import { RWASDKError, InvalidParametersError, TransactionError, NetworkError } from './errors';
import { ErrorCode } from './types';
import { DEFAULT_DECIMALS, DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, HOLDING_PERIOD_RULE_144, HOLDING_PERIOD_DEFAULT, HOLDING_PERIOD_INVOICE, HOLDING_PERIOD_ART, HOLDING_PERIOD_SECURITY, TRANSFER_LIMIT_REAL_ESTATE, TRANSFER_LIMIT_COMMODITY, TRANSFER_LIMIT_INVOICE, TRANSFER_LIMIT_SECURITY, TRANSFER_LIMIT_ART, TRANSFER_LIMIT_CARBON_CREDIT, RENTAL_YIELD_MAX_BASIS_POINTS, VALID_PURITY_GRADES, VALID_CREDIT_RATINGS, VALID_REGULATION_FRAMEWORKS, DAY_IN_SECONDS } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateContractId, validateNonNegativeInteger } from './validation';

export enum AssetClass {
  RealEstate = 0,
  Commodity = 1,
  Invoice = 2,
  Security = 3,
  Art = 4,
  CarbonCredit = 5
}

export interface ComplianceRules {
  kycRequired: boolean;
  accreditedInvestorOnly: boolean;
  geographicRestrictions: string[];
  holdingPeriodDays: number;
  transferLimits: bigint;
}

export interface DividendSchedule {
  frequencyDays: number;
  nextDistributionDate: number;
  totalDistributed: bigint;
  isActive: boolean;
}

export interface AssetConfig {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  assetClass: AssetClass;
  complianceRules: ComplianceRules;
  dividendSchedule?: DividendSchedule;
  metadata: Record<string, string>;
}

export interface RealEstateConfig {
  propertyAddress: string;
  locationOracle: string;
  rentalYieldRate: number;
  propertyManagementVoting: boolean;
  insuranceStatus: boolean;
  appraisalValue: bigint;
}

export interface CommodityConfig {
  commodityType: string;
  vaultLocation: string;
  custodyVault: string;
  purityGrade: string;
  physicalRedemptionWindow: number;
  qualityAttestation: string;
}

export interface InvoiceConfig {
  invoiceNumber: string;
  debtorAddress: string;
  dueDate: number;
  creditRating: string;
  automaticSettlement: boolean;
  invoiceAmount: bigint;
}

export interface SecurityConfig {
  equityType: string;
  regulationFramework: string;
  accreditationRequired: boolean;
  holdingPeriodDays: number;
  regulatoryReporting: boolean;
  isin: string;
}

export interface ArtConfig {
  artistName: string;
  provenanceHash: string;
  insuranceStatus: boolean;
  exhibitionVoting: boolean;
  appraisalValue: bigint;
  authenticityCertificate: string;
}

export interface CarbonCreditConfig {
  projectId: string;
  vintageYear: number;
  retirementFunctionality: boolean;
  projectMetadata: Record<string, string>;
  verificationStandard: string;
  carbonOffsetAmount: bigint;
}

export interface DeploymentCost {
  gasCostXlm: number;
  storageCostBytes: number;
  estimatedTimeSeconds: number;
}

/**
 * Client for interacting with the on-chain AssetFactory contract.
 *
 * Provides helpers for deploying asset-class-specific RWA tokens, estimating
 * deployment costs, and querying the on-chain asset registry.
 *
 * @example
 * ```ts
 * const factory = new AssetFactory(
 *   'https://horizon-testnet.stellar.org',
 *   'CONTRACT_ID'
 * );
 * const result = await factory.deployRealEstateToken(signer, propertyDetails, config);
 * ```
 */
export class AssetFactory {
  private server: Server;
  private contract: Contract;
  private networkPassphrase: string;
  private logger: Logger;

  /**
   * Create a new AssetFactory client.
   *
   * @param serverUrl - Soroban RPC / Horizon server URL.
   * @param contractId - Stellar contract ID of the deployed AssetFactory contract.
   * @param networkPassphrase - Network passphrase used to sign transactions.
   *   Defaults to the Stellar testnet passphrase.
   */
  constructor(
    serverUrl: string,
    contractId: string,
    networkPassphrase: string = 'Test SDF Network ; September 2015'
  ) {
    validateServerUrl(serverUrl, 'serverUrl');
    validateContractId(contractId, 'contractId');
    validateNonEmptyString(networkPassphrase, 'networkPassphrase');
    this.server = new Server(serverUrl);
    this.contract = new Contract(contractId);
    this.networkPassphrase = networkPassphrase;
    this.logger = createLogger('AssetFactory');
    this.logger.info('AssetFactory initialized', { contractId });
  }

  /**
   * Deploy a Real Estate RWA token with property-specific metadata.
   *
   * Merges `propertyDetails` into the asset metadata and calls `create_asset`
   * on the factory contract with `AssetClass.RealEstate`.
   *
   * @param signer - Keypair that authorises and signs the transaction.
   * @param propertyDetails - Real-estate-specific configuration (location oracle,
   *   rental yield, appraisal value, etc.).
   * @param ownershipStructure - Base asset configuration (name, symbol, supply, etc.).
   * @returns The deployed token contract address and the Stellar transaction ID.
   * @throws {InvalidParametersError} If required fields in `ownershipStructure` are invalid.
   * @throws {RWASDKError} If the transaction fails on-chain.
   */
  async deployRealEstateToken(
    signer: Keypair,
    propertyDetails: RealEstateConfig,
    ownershipStructure: AssetConfig
  ): Promise<{ address: string; transactionId: string }> {
    validateNonEmptyString(propertyDetails.propertyAddress, 'propertyAddress');
    validateNonEmptyString(propertyDetails.locationOracle, 'locationOracle');
    if (propertyDetails.appraisalValue < 0n) {
      throw new InvalidParametersError('appraisalValue must be non-negative');
    }
    const account = await this.server.getAccount(signer.publicKey());

    const metadata = {
      ...ownershipStructure.metadata,
      property_address: propertyDetails.propertyAddress,
      location_oracle: propertyDetails.locationOracle,
      rental_yield: propertyDetails.rentalYieldRate.toString(),
      insurance_status: propertyDetails.insuranceStatus.toString(),
      appraisal_value: propertyDetails.appraisalValue.toString(),
      property_management_voting: propertyDetails.propertyManagementVoting.toString()
    };

    const config: AssetConfig = {
      ...ownershipStructure,
      assetClass: AssetClass.RealEstate,
      metadata
    };

    this.logger.info('Deploying Real Estate token', { name: config.name, propertyAddress: propertyDetails.propertyAddress });
    const tx = await this.buildCreateAssetTransaction(signer, config);
    const result = await this.submitTransaction(tx, signer);

    this.logger.info('Real Estate token deployed', { address: result.returnValue?.address || '', txHash: result.hash });
    return {
      address: result.returnValue?.address || '',
      transactionId: result.hash
    };
  }

  /**
   * Deploy a Commodity RWA token with vault and purity metadata.
   *
   * Validates the purity grade against the accepted set (`999`, `995`, `990`, `750`)
   * before calling `create_asset` with `AssetClass.Commodity`.
   *
   * @param signer - Keypair that authorises and signs the transaction.
   * @param commodityConfig - Commodity-specific configuration (vault location,
   *   purity grade, physical redemption window, etc.).
   * @param baseConfig - Base asset configuration (name, symbol, supply, etc.).
   * @returns The deployed token contract address and the Stellar transaction ID.
   * @throws {InvalidParametersError} If `purityGrade` is not one of the accepted values.
   * @throws {RWASDKError} If the transaction fails on-chain.
   */
  async deployCommodityToken(
    signer: Keypair,
    commodityConfig: CommodityConfig,
    baseConfig: AssetConfig
  ): Promise<{ address: string; transactionId: string }> {
    validateNonEmptyString(commodityConfig.commodityType, 'commodityType');
    validateNonNegativeInteger(commodityConfig.physicalRedemptionWindow, 'physicalRedemptionWindow');
    const account = await this.server.getAccount(signer.publicKey());

    if (!VALID_PURITY_GRADES.includes(commodityConfig.purityGrade as any)) {
      throw new InvalidParametersError('Invalid purity grade. Must be one of: ' + VALID_PURITY_GRADES.join(', '));
    }

    const metadata = {
      ...baseConfig.metadata,
      commodity_type: commodityConfig.commodityType,
      vault_location: commodityConfig.vaultLocation,
      purity_grade: commodityConfig.purityGrade,
      redemption_window: commodityConfig.physicalRedemptionWindow.toString(),
      custody_vault: commodityConfig.custodyVault
    };

    const config: AssetConfig = {
      ...baseConfig,
      assetClass: AssetClass.Commodity,
      metadata
    };

    this.logger.info('Deploying Commodity token', { name: baseConfig.name, purityGrade: commodityConfig.purityGrade });
    const tx = await this.buildCreateAssetTransaction(signer, config);
    const result = await this.submitTransaction(tx, signer);

    this.logger.info('Commodity token deployed', { address: result.returnValue?.address || '', txHash: result.hash });
    return {
      address: result.returnValue?.address || '',
      transactionId: result.hash
    };
  }

  /**
   * Deploy an Invoice RWA token backed by a trade receivable.
   *
   * Validates that `dueDate` is in the future and that `creditRating` is one
   * of the accepted values (`AAA`–`CCC`). Sets `totalSupply` to the invoice
   * face value before calling `create_asset` with `AssetClass.Invoice`.
   *
   * @param signer - Keypair that authorises and signs the transaction.
   * @param invoiceData - Invoice-specific configuration (invoice number, debtor,
   *   due date, credit rating, face amount, etc.).
   * @param baseConfig - Base asset configuration (name, symbol, compliance rules, etc.).
   * @returns The deployed token contract address and the Stellar transaction ID.
   * @throws {InvalidParametersError} If `dueDate` is in the past or `creditRating` is invalid.
   * @throws {RWASDKError} If the transaction fails on-chain.
   */
  async deployInvoiceToken(
    signer: Keypair,
    invoiceData: InvoiceConfig,
    baseConfig: AssetConfig
  ): Promise<{ address: string; transactionId: string }> {
    validateNonEmptyString(invoiceData.invoiceNumber, 'invoiceNumber');
    if (invoiceData.invoiceAmount <= 0n) {
      throw new InvalidParametersError('invoiceAmount must be greater than zero');
    }
    const account = await this.server.getAccount(signer.publicKey());

    const currentTime = Math.floor(Date.now() / 1000);
    if (invoiceData.dueDate <= currentTime) {
      throw new InvalidParametersError('Due date must be in future');
    }

    if (!VALID_CREDIT_RATINGS.includes(invoiceData.creditRating as any)) {
      throw new InvalidParametersError('Invalid credit rating. Must be one of: ' + VALID_CREDIT_RATINGS.join(', '));
    }

    const metadata = {
      ...baseConfig.metadata,
      invoice_number: invoiceData.invoiceNumber,
      debtor_address: invoiceData.debtorAddress,
      due_date: invoiceData.dueDate.toString(),
      credit_rating: invoiceData.creditRating,
      invoice_amount: invoiceData.invoiceAmount.toString(),
      automatic_settlement: invoiceData.automaticSettlement.toString()
    };

    const config: AssetConfig = {
      ...baseConfig,
      assetClass: AssetClass.Invoice,
      totalSupply: invoiceData.invoiceAmount,
      metadata
    };

    this.logger.info('Deploying Invoice token', { invoiceNumber: invoiceData.invoiceNumber, amount: invoiceData.invoiceAmount.toString() });
    const tx = await this.buildCreateAssetTransaction(signer, config);
    const result = await this.submitTransaction(tx, signer);

    this.logger.info('Invoice token deployed', { address: result.returnValue?.address || '', txHash: result.hash });
    return {
      address: result.returnValue?.address || '',
      transactionId: result.hash
    };
  }

  /**
   * Deploy a Security (equity) RWA token with regulatory compliance metadata.
   *
   * Validates `regulationFramework` against accepted values (`REG_D`, `REG_S`,
   * `RULE_144`, `REG_A+`) and enforces accredited-investor-only compliance rules.
   * Holding period is set to 365 days for `RULE_144`, 90 days otherwise.
   *
   * @param signer - Keypair that authorises and signs the transaction.
   * @param equityType - Type of equity (e.g. `"common"`, `"preferred"`).
   * @param regulationFramework - Applicable securities regulation framework.
   * @param baseConfig - Base asset configuration (name, symbol, supply, etc.).
   * @returns The deployed token contract address and the Stellar transaction ID.
   * @throws {InvalidParametersError} If `regulationFramework` is not one of the accepted values.
   * @throws {RWASDKError} If the transaction fails on-chain.
   */
  async deploySecurityToken(
    signer: Keypair,
    equityType: string,
    regulationFramework: string,
    baseConfig: AssetConfig
  ): Promise<{ address: string; transactionId: string }> {
    validateNonEmptyString(equityType, 'equityType');
    const account = await this.server.getAccount(signer.publicKey());

    if (!VALID_REGULATION_FRAMEWORKS.includes(regulationFramework as any)) {
      throw new InvalidParametersError('Invalid regulation framework. Must be one of: ' + VALID_REGULATION_FRAMEWORKS.join(', '));
    }

    const complianceRules: ComplianceRules = {
      ...baseConfig.complianceRules,
      accreditedInvestorOnly: true,
      holdingPeriodDays: regulationFramework === 'RULE_144' ? HOLDING_PERIOD_RULE_144 : HOLDING_PERIOD_DEFAULT
    };

    const metadata = {
      ...baseConfig.metadata,
      equity_type: equityType,
      regulation_framework: regulationFramework,
      regulatory_reporting: 'true'
    };

    const config: AssetConfig = {
      ...baseConfig,
      assetClass: AssetClass.Security,
      complianceRules: complianceRules,
      metadata
    };

    this.logger.info('Deploying Security token', { equityType, regulationFramework });
    const tx = await this.buildCreateAssetTransaction(signer, config);
    const result = await this.submitTransaction(tx, signer);

    this.logger.info('Security token deployed', { address: result.returnValue?.address || '', txHash: result.hash });
    return {
      address: result.returnValue?.address || '',
      transactionId: result.hash
    };
  }

  /**
   * Return a pre-populated `AssetConfig` template for the given asset class.
   *
   * The template includes sensible defaults for compliance rules and dividend
   * schedule. Callers should fill in `name`, `symbol`, and `totalSupply`
   * before passing the result to a deploy method.
   *
   * @param assetClass - The asset class to generate a template for.
   * @returns A partially-populated `AssetConfig` with class-appropriate defaults.
   */
  getAssetClassTemplate(assetClass: AssetClass): Omit<AssetConfig, 'name' | 'symbol' | 'totalSupply'> {
    return {
      decimals: DEFAULT_DECIMALS,
      assetClass: assetClass,
      complianceRules: this.getDefaultComplianceRules(assetClass),
      dividendSchedule: this.getDefaultDividendSchedule(assetClass),
      metadata: {}
    };
  }

  /**
   * Estimate the on-chain deployment cost for a given asset class.
   *
   * Returns approximate gas cost (in XLM), storage footprint (in bytes), and
   * expected confirmation time (in seconds). Values are based on empirical
   * multipliers per asset class and should be treated as estimates only.
   *
   * @param assetClass - The asset class to estimate costs for.
   * @returns An object containing `gasCostXlm`, `storageCostBytes`, and
   *   `estimatedTimeSeconds`.
   */
  async estimateDeploymentCost(assetClass: AssetClass): Promise<DeploymentCost> {
    const baseGasCost = 0.1;
    const baseStorageCost = 10000;
    const baseTime = 5;

    const multipliers: Record<AssetClass, { gas: number; storage: number; time: number }> = {
      [AssetClass.RealEstate]: { gas: 1.2, storage: 1.3, time: 1.5 },
      [AssetClass.Commodity]: { gas: 1.1, storage: 1.2, time: 1.2 },
      [AssetClass.Invoice]: { gas: 1.0, storage: 1.1, time: 1.0 },
      [AssetClass.Security]: { gas: 1.5, storage: 1.5, time: 2.0 },
      [AssetClass.Art]: { gas: 1.3, storage: 1.4, time: 1.7 },
      [AssetClass.CarbonCredit]: { gas: 1.1, storage: 1.1, time: 1.1 }
    };

    const multiplier = multipliers[assetClass];
    if (!multiplier) {
      throw new InvalidParametersError('Invalid asset class');
    }

    return {
      gasCostXlm: baseGasCost * multiplier.gas,
      storageCostBytes: Math.floor(baseStorageCost * multiplier.storage),
      estimatedTimeSeconds: Math.floor(baseTime * multiplier.time)
    };
  }

  /**
   * Fetch all assets currently registered in the on-chain registry.
   *
   * Reads the `registry` storage entry from the factory contract and maps
   * each entry to a plain object. Returns an empty array if the registry is
   * empty or the read fails.
   *
   * @returns An array of asset summary objects, each containing `symbol`,
   *   `name`, `assetClass`, `totalSupply`, `tokenAddress`, `createdAt`,
   *   and `isPaused`.
   */
  async getAllAssets(): Promise<any[]> {
    try {
      const result = await this.server.getContractData(
        this.contract.getStellarAccountId(),
        xdr.ScVal.scvSymbol('registry')
      );

      if (!result.val) {
        return [];
      }

      const registry = scValToNative(result.val);
      if (!registry || typeof registry !== 'object') return [];
      return Object.values(registry).map((asset: Record<string, any>) => ({
        symbol: asset.symbol,
        name: asset.name,
        assetClass: asset.asset_class,
        totalSupply: asset.total_supply.toString(),
        tokenAddress: asset.token_address,
        createdAt: asset.created_at,
        isPaused: asset.is_paused
      }));
    } catch (error) {
      this.logger.error('Error fetching assets:', { error });
      return [];
    }
  }

  /**
   * Trigger an emergency pause on all registered assets.
   *
   * Calls `emergency_pause_all` on the factory contract. Only the contract
   * admin is authorised to invoke this operation.
   *
   * @param signer - Admin keypair that authorises and signs the transaction.
   * @returns The Stellar transaction hash of the submitted transaction.
   * @throws {RWASDKError} If the transaction fails or the signer is not the admin.
   */
  async emergencyPauseAll(signer: Keypair): Promise<string> {
    this.logger.warn('Emergency pause all triggered', { signer: signer.publicKey() });
    const account = await this.server.getAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: DEFAULT_FEE_RATE.toString(),
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(this.contract.call(
        'emergency_pause_all',
        ...this.buildAuthArgs(signer)
      ))
      .setTimeout(DEFAULT_TIMEOUT_SECONDS)
      .build();

    const result = await this.submitTransaction(tx, signer);
    return result.hash;
  }

  private async buildCreateAssetTransaction(
    signer: Keypair,
    config: AssetConfig
  ): Promise<any> {
    const account = await this.server.getAccount(signer.publicKey());

    const typeMap: Record<AssetClass, string> = {
      [AssetClass.RealEstate]: 'AssetConfig',
      [AssetClass.Commodity]: 'AssetConfig',
      [AssetClass.Invoice]: 'AssetConfig',
      [AssetClass.Security]: 'AssetConfig',
      [AssetClass.Art]: 'AssetConfig',
      [AssetClass.CarbonCredit]: 'AssetConfig'
    };

    const assetType = typeMap[config.assetClass];
    if (!assetType) {
      throw new Error(`Unknown asset class: ${config.assetClass}`);
    }

    const configScVal = nativeToScVal(config, { type: assetType });

    return new TransactionBuilder(account, {
      fee: DEFAULT_FEE_RATE.toString(),
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(this.contract.call(
        'create_asset',
        ...this.buildAuthArgs(signer),
        configScVal
      ))
      .setTimeout(DEFAULT_TIMEOUT_SECONDS)
      .build();
  }

  private buildAuthArgs(signer: Keypair): xdr.ScVal[] {
    return [
      nativeToScVal(new Address(signer.publicKey()), { type: 'Address' })
    ];
  }

  private async submitTransaction(
    transaction: any,
    signer: Keypair
  ): Promise<any> {
    transaction.sign(signer);

    let result: any;
    try {
      result = await this.server.sendTransaction(transaction);
    } catch (error: any) {
      throw new NetworkError(`Failed to send transaction: ${error?.message ?? error}`);
    }

    if (result.status === 'ERROR') {
      throw new TransactionError(`Transaction failed: ${result.errorResult}`);
    }

    const txResult = await this.server.getTransaction(result.hash!);

    if (txResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return txResult;
    } else {
      throw new TransactionError(`Transaction not successful: ${txResult.status}`);
    }
  }

  private getDefaultComplianceRules(assetClass: AssetClass): ComplianceRules {
    switch (assetClass) {
      case AssetClass.RealEstate:
        return {
          kycRequired: true,
          accreditedInvestorOnly: false,
          geographicRestrictions: [],
          holdingPeriodDays: HOLDING_PERIOD_DEFAULT,
          transferLimits: TRANSFER_LIMIT_REAL_ESTATE
        };
      case AssetClass.Commodity:
        return {
          kycRequired: true,
          accreditedInvestorOnly: false,
          geographicRestrictions: [],
          holdingPeriodDays: 0,
          transferLimits: TRANSFER_LIMIT_COMMODITY
        };
      case AssetClass.Invoice:
        return {
          kycRequired: true,
          accreditedInvestorOnly: true,
          geographicRestrictions: [],
          holdingPeriodDays: HOLDING_PERIOD_INVOICE,
          transferLimits: TRANSFER_LIMIT_INVOICE
        };
      case AssetClass.Security:
        return {
          kycRequired: true,
          accreditedInvestorOnly: true,
          geographicRestrictions: ['US', 'EU', 'UK'],
          holdingPeriodDays: HOLDING_PERIOD_SECURITY,
          transferLimits: TRANSFER_LIMIT_SECURITY
        };
      case AssetClass.Art:
        return {
          kycRequired: true,
          accreditedInvestorOnly: false,
          geographicRestrictions: [],
          holdingPeriodDays: HOLDING_PERIOD_ART,
          transferLimits: TRANSFER_LIMIT_ART
        };
      case AssetClass.CarbonCredit:
        return {
          kycRequired: true,
          accreditedInvestorOnly: false,
          geographicRestrictions: [],
          holdingPeriodDays: 0,
          transferLimits: TRANSFER_LIMIT_CARBON_CREDIT
        };
    }
  }

  private getDefaultDividendSchedule(assetClass: AssetClass): DividendSchedule | undefined {
    const now = Math.floor(Date.now() / 1000);

    switch (assetClass) {
      case AssetClass.RealEstate:
        return {
          frequencyDays: HOLDING_PERIOD_DEFAULT,
          nextDistributionDate: now + (HOLDING_PERIOD_DEFAULT * DAY_IN_SECONDS),
          totalDistributed: BigInt(0),
          isActive: true
        };
      case AssetClass.Invoice:
        return {
          frequencyDays: HOLDING_PERIOD_INVOICE,
          nextDistributionDate: now + (HOLDING_PERIOD_INVOICE * DAY_IN_SECONDS),
          totalDistributed: BigInt(0),
          isActive: true
        };
      case AssetClass.Security:
        return {
          frequencyDays: HOLDING_PERIOD_SECURITY,
          nextDistributionDate: now + (HOLDING_PERIOD_SECURITY * DAY_IN_SECONDS),
          totalDistributed: BigInt(0),
          isActive: true
        };
      default:
        return undefined;
    }
  }
}
