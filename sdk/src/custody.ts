import { Server, TransactionBuilder, Networks, Operation, Asset, Keypair, Account } from '@stellar/stellar-base';
import { Horizon } from '@stellar/stellar-sdk';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import { RWASDKError, ContractError, VerificationFailedError, InsufficientBondError } from './errors';
import { ErrorCode } from './types';
import { DEFAULT_FEE_RATE, DEFAULT_TIMEOUT_SECONDS, DEFAULT_CUSTODY_EXPIRY_DAYS, DAY_IN_MILLISECONDS } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateAmount, validateNonEmptyString, validatePositiveInteger, validateServerUrl, validateContractId } from './validation';

export interface CustodyAttestation {
    assetId: string;
    custodian: string;
    location: string;
    condition: string;
    value: string;
    timestamp: number;
    proofHash: string;
    verificationType: string;
    insuranceStatus: string;
    legalTitleHash: string;
    auditReportHash: string;
    multiSigSignatures: string[];
    metadata: Record<string, string>;
    isValid: boolean;
    expiresAt: number;
}

export interface CustodianRegistry {
    custodianAddress: string;
    name: string;
    jurisdiction: string;
    licenseNumber: string;
    reputationScore: number;
    verificationTypes: string[];
    isActive: boolean;
    totalAttestations: number;
    successfulDisputes: number;
    failedDisputes: number;
    bondRequired: string;
    insuranceProvider: string;
}

export interface DisputeRecord {
    disputeId: number;
    attestationId: number;
    challenger: string;
    custodian: string;
    reason: string;
    bondAmount: string;
    evidenceHash: string;
    status: string;
    createdAt: number;
    resolvedAt: number;
    resolution: string;
    bondReturned: boolean;
    penaltyApplied: boolean;
    penaltyAmount: string;
}

export interface VerificationTypeConfig {
    verificationType: string;
    requiredDocuments: string[];
    verificationFrequency: number;
    multiSigRequired: boolean;
    sigThreshold: number;
    insuranceRequired: boolean;
    minInsuranceCoverage: string;
    iotMonitoringRequired: boolean;
    satelliteVerification: boolean;
    legalVerificationRequired: boolean;
}

export interface InsuranceIntegration {
    provider: string;
    policyNumber: string;
    coverageAmount: string;
    premiumAmount: string;
    validUntil: number;
    claimAutoTrigger: boolean;
    lastPremiumPaid: number;
    isActive: boolean;
}

export interface CustodianProfile {
    name: string;
    jurisdiction: string;
    licenseNumber: string;
    verificationTypes: string[];
    bondRequired: string;
    insuranceProvider: string;
    credentials: {
        professionalLicense: string;
        insuranceBond: string;
        backgroundCheck: string;
        financialAudit: string;
    };
}

export interface ProofData {
    documents: Record<string, string>;
    iotData?: {
        temperature: number;
        humidity: number;
        location: { lat: number; lng: number };
        motionDetected: boolean;
        timestamp: number;
    };
    satelliteImagery?: {
        image_hash: string;
        coordinates: { lat: number; lng: number };
        timestamp: number;
        verification_type: string;
    };
    legalVerification?: {
        courtFilingHash: string;
        verificationStatus: string;
        verifiedBy: string;
        timestamp: number;
    };
    cryptographicProofs: {
        merkleRoot: string;
        merkleProofs: Record<string, string[]>;
        zkProof?: string;
        photoHash: string;
        videoHash: string;
        notarySignature: string;
    };
}

export class CustodyClient {
    private server: Server;
    private contractId: string;
    private networkPassphrase: string;
    private logger: Logger;

    constructor(
        contractId: string,
        serverUrl: string = 'https://horizon-testnet.stellar.org',
        networkPassphrase: string = Networks.TESTNET
    ) {
        validateNonEmptyString(contractId, 'contractId');
        validateServerUrl(serverUrl, 'serverUrl');
        this.server = new Server(serverUrl);
        this.contractId = contractId;
        this.networkPassphrase = networkPassphrase;
        this.logger = createLogger('CustodyClient');
    }

    async registerCustodian(
        signerKeypair: Keypair,
        profile: CustodianProfile
    ): Promise<Horizon.SubmitTransactionResponse> {
        validateNonEmptyString(profile.name, 'name');
        validateNonEmptyString(profile.jurisdiction, 'jurisdiction');
        validateNonEmptyString(profile.licenseNumber, 'licenseNumber');
        this.logger.info('Registering custodian', { name: profile.name, address: signerKeypair.publicKey() });
        const account = await this.server.loadAccount(signerKeypair.publicKey());
        
        const verificationTypes = profile.verificationTypes.map(type => 
            new TransactionBuilder(account, { networkPassphrase: this.networkPassphrase, fee: DEFAULT_FEE_RATE.toString() })
                .addOperation(Operation.invokeContractFunction({
                    contract: this.contractId,
                    function: 'register_custodian',
                    args: [
                        ...this.encodeAddress(signerKeypair.publicKey()),
                        ...this.encodeString(profile.name),
                        ...this.encodeString(profile.jurisdiction),
                        ...this.encodeString(profile.licenseNumber),
                        ...this.encodeStringArray(profile.verificationTypes),
                        ...this.encodeString(profile.bondRequired),
                        ...this.encodeString(profile.insuranceProvider),
                    ]
                }))
                .setTimeout(DEFAULT_TIMEOUT_SECONDS)
                .build()
        );

        const transaction = new TransactionBuilder(account, { 
            networkPassphrase: this.networkPassphrase, 
            fee: DEFAULT_FEE_RATE.toString() 
        })
            .addOperation(Operation.invokeContractFunction({
                contract: this.contractId,
                function: 'register_custodian',
                args: [
                    ...this.encodeAddress(signerKeypair.publicKey()),
                    ...this.encodeString(profile.name),
                    ...this.encodeString(profile.jurisdiction),
                    ...this.encodeString(profile.licenseNumber),
                    ...this.encodeStringArray(profile.verificationTypes),
                    ...this.encodeString(profile.bondRequired),
                    ...this.encodeString(profile.insuranceProvider),
                ]
            }))
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const result = await this.server.submitTransaction(transaction);
        this.logger.info('Custodian registered', { name: profile.name, address: signerKeypair.publicKey() });
        return result;
    }

    async submitAttestation(
        signerKeypair: Keypair,
        assetId: string,
        proofData: ProofData,
        signatures: string[]
    ): Promise<Horizon.SubmitTransactionResponse> {
        validateNonEmptyString(assetId, 'assetId');
        this.logger.info('Submitting attestation', { assetId, custodian: signerKeypair.publicKey() });
        const account = await this.server.loadAccount(signerKeypair.publicKey());
        
        const attestation: CustodyAttestation = {
            assetId: assetId,
            custodian: signerKeypair.publicKey(),
            location: proofData.iotData?.location ? 
                `${proofData.iotData.location.lat},${proofData.iotData.location.lng}` : 
                'unknown',
            condition: 'verified',
            value: '0',
            timestamp: Date.now(),
            proofHash: this.calculateProofHash(proofData),
            verificationType: this.determineVerificationType(proofData),
            insuranceStatus: 'insured',
            legalTitleHash: proofData.legalVerification?.courtFilingHash || '',
            auditReportHash: proofData.cryptographicProofs.merkleRoot,
            multiSigSignatures: signatures,
            metadata: this.buildMetadata(proofData),
            isValid: true,
            expiresAt: Date.now() + (DEFAULT_CUSTODY_EXPIRY_DAYS * DAY_IN_MILLISECONDS),
        };

        const transaction = new TransactionBuilder(account, { 
            networkPassphrase: this.networkPassphrase, 
            fee: DEFAULT_FEE_RATE.toString() 
        })
            .addOperation(Operation.invokeContractFunction({
                contract: this.contractId,
                function: 'submit_attestation',
                args: [...this.encodeCustodyAttestation(attestation)]
            }))
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const result = await this.server.submitTransaction(transaction);
        this.logger.info('Attestation submitted', { assetId, hash: result.hash });
        return result;
    }

    async verifyAssetBacking(tokenAddress: string): Promise<{
        isValid: boolean;
        latestAttestation?: CustodyAttestation;
        alerts: string[];
        insuranceStatus: string;
    }> {
        validateAddress(tokenAddress, 'tokenAddress');
        this.logger.info('Verifying asset backing', { tokenAddress });
        try {
            const latestAttestation = await this.getLatestAttestation(tokenAddress);
            const alerts = await this.getCustodyAlerts();
            
            const isValid = latestAttestation ? 
                latestAttestation.isValid && 
                Date.now() < latestAttestation.expiresAt : 
                false;

            const relevantAlerts = alerts
                .filter((entry): entry is [string, string] => {
                  if (!Array.isArray(entry) || entry.length < 2) return false;
                  const [asset] = entry;
                  return asset === tokenAddress;
                })
                .map(([, alert]) => alert);

            this.logger.info('Asset backing verified', { tokenAddress, isValid });
            return {
                isValid: isValid,
                latestAttestation: latestAttestation,
                alerts: relevantAlerts,
                insuranceStatus: latestAttestation?.insuranceStatus || 'unknown'
            };
        } catch (error) {
            throw new ContractError(`Failed to verify asset backing: ${error}`);
        }
    }

    async getCustodyHistory(assetId: string): Promise<CustodyAttestation[]> {
        const attestations: CustodyAttestation[] = [];
        return attestations;
    }

    async initiateDispute(
        signerKeypair: Keypair,
        attestationId: number,
        reason: string,
        bondAmount: string,
        evidenceHash: string
    ): Promise<Horizon.SubmitTransactionResponse> {
        validateNonEmptyString(reason, 'reason');
        validateAmount(bondAmount, 'bondAmount');
        this.logger.info('Initiating dispute', { attestationId, challenger: signerKeypair.publicKey(), reason });
        const account = await this.server.loadAccount(signerKeypair.publicKey());
        
        const transaction = new TransactionBuilder(account, { 
            networkPassphrase: this.networkPassphrase, 
            fee: DEFAULT_FEE_RATE.toString() 
        })
            .addOperation(Operation.invokeContractFunction({
                contract: this.contractId,
                function: 'dispute_attestation',
                args: [
                    ...this.encodeNumber(attestationId),
                    ...this.encodeAddress(signerKeypair.publicKey()),
                    ...this.encodeString(reason),
                    ...this.encodeString(bondAmount),
                    ...this.encodeString(evidenceHash),
                ]
            }))
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const result = await this.server.submitTransaction(transaction);
        this.logger.info('Dispute initiated', { attestationId, hash: result.hash });
        return result;
    }

    /**
     * Trigger an insurance claim for an undercollateralized asset.
     *
     * @param signerKeypair - Keypair of the authorized admin who triggers the claim
     * @param assetId       - On-chain address of the RWA token asset
     * @param claimReason   - Short symbol describing the reason (e.g. 'undercollateralized')
     * @param evidenceHash  - 32-byte hex string evidence hash (64 hex chars)
     * @returns Horizon submit transaction response
     */
    async triggerInsuranceClaim(
        signerKeypair: Keypair,
        assetId: string,
        claimReason: string,
        evidenceHash: string
    ): Promise<Horizon.SubmitTransactionResponse> {
        validateAddress(assetId, 'assetId');
        validateNonEmptyString(claimReason, 'claimReason');
        validateNonEmptyString(evidenceHash, 'evidenceHash');
        if (!/^[0-9a-fA-F]{64}$/.test(evidenceHash)) {
            throw new ContractError('evidenceHash must be a 64-character hex string (32 bytes)');
        }

        this.logger.info('Triggering insurance claim', {
            assetId,
            claimReason,
            admin: signerKeypair.publicKey()
        });

        const account = await this.server.loadAccount(signerKeypair.publicKey());

        const transaction = new TransactionBuilder(account, {
            networkPassphrase: this.networkPassphrase,
            fee: DEFAULT_FEE_RATE.toString()
        })
            .addOperation(Operation.invokeContractFunction({
                contract: this.contractId,
                function: 'trigger_insurance_claim',
                args: [
                    ...this.encodeAddress(signerKeypair.publicKey()), // auth
                    ...this.encodeAddress(assetId),                   // asset_id
                    ...this.encodeString(claimReason),                // claim_reason
                    ...this.encodeString(evidenceHash),               // evidence_hash
                ]
            }))
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const result = await this.server.submitTransaction(transaction);
        this.logger.info('Insurance claim triggered', {
            assetId,
            claimReason,
            hash: result.hash
        });
        return result;
    }

    async getDispute(disputeId: number): Promise<DisputeRecord> {
        validatePositiveInteger(disputeId, 'disputeId');
        throw new ContractError('Not implemented');
    }

    async getCustodianInfo(custodianAddress: string): Promise<CustodianRegistry> {
        throw new ContractError('Not implemented');
    }

    async listActiveCustodians(): Promise<CustodianRegistry[]> {
        throw new ContractError('Not implemented');
    }

    async getVerificationConfig(verificationType: string): Promise<VerificationTypeConfig> {
        throw new ContractError('Not implemented');
    }

    private async getLatestAttestation(assetId: string): Promise<CustodyAttestation | null> {
        return null;
    }

    private async getCustodyAlerts(): Promise<[string, string][]> {
        return [];
    }

    private calculateProofHash(proofData: ProofData): string {
        const dataString = JSON.stringify(proofData);
        return Buffer.from(dataString).toString('hex').substring(0, 64);
    }

    private determineVerificationType(proofData: ProofData): string {
        if (proofData.documents.property_deed) return 'real_estate';
        if (proofData.documents.vault_audit_cert) return 'precious_metals';
        if (proofData.documents.provenance_docs) return 'art_collectibles';
        if (proofData.documents.warehouse_receipt) return 'commodities';
        if (proofData.documents.debtor_confirmation) return 'invoice';
        return 'unknown';
    }

    private buildMetadata(proofData: ProofData): Record<string, string> {
        const metadata: Record<string, string> = {};
        
        if (proofData.iotData) {
            metadata.iot_monitored = 'true';
            metadata.last_iot_reading = proofData.iotData.timestamp.toString();
        }
        
        if (proofData.satelliteImagery) {
            metadata.satellite_verified = 'true';
            metadata.satellite_timestamp = proofData.satelliteImagery.timestamp.toString();
        }
        
        if (proofData.legalVerification) {
            metadata.legal_verified = proofData.legalVerification.verificationStatus;
        }
        
        return metadata;
    }

    private encodeAddress(address: string): Buffer[] {
        if (typeof address !== 'string' || address.length === 0) {
            throw new Error('Invalid address: must be a non-empty string');
        }
        return [Buffer.from(address, 'utf8')];
    }

    private encodeString(str: string): Buffer[] {
        if (typeof str !== 'string') {
            throw new Error('Invalid string: must be a string');
        }
        return [Buffer.from(str, 'utf8')];
    }

    private encodeStringArray(arr: string[]): Buffer[] {
        if (!Array.isArray(arr)) {
            throw new Error('Invalid array: must be an array of strings');
        }
        return [Buffer.from(JSON.stringify(arr), 'utf8')];
    }

    private encodeNumber(num: number): Buffer[] {
        if (typeof num !== 'number' || !Number.isFinite(num)) {
            throw new Error('Invalid number: must be a finite number');
        }
        return [Buffer.from(num.toString(), 'utf8')];
    }

    private encodeCustodyAttestation(attestation: CustodyAttestation): Buffer[] {
        if (!attestation || typeof attestation !== 'object') {
            throw new Error('Invalid attestation: must be an object');
        }
        return [Buffer.from(JSON.stringify(attestation), 'utf8')];
    }
}
