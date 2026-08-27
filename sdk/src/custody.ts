import { Server, TransactionBuilder, Networks, Operation, Keypair } from '@stellar/stellar-base';
import { Horizon } from 'stellar-sdk';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import {
    RWASDKError,
    ContractError,
    VerificationFailedError,
    InsufficientBondError,
    InvalidParametersError,
} from './errors';
import {
    ErrorCode,
    DisputeOptions,
    DisputeStatusResult,
    DisputeStatus,
    DisputeResolutionEvent,
} from './types';
import {
    DEFAULT_FEE_RATE,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_CUSTODY_EXPIRY_DAYS,
    DAY_IN_MILLISECONDS,
} from './constants';
import { createLogger, Logger } from './logger';
import {
    validateAddress,
    validateAmount,
    validateNonEmptyString,
    validatePositiveInteger,
    validateServerUrl,
    validateContractId,
} from './validation';

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

    /** In-memory store of all filed disputes, keyed by disputeId */
    private disputeStore: Map<number, DisputeStatusResult> = new Map();
    /** In-memory store of disputes indexed by custodian address */
    private disputeByCustodian: Map<string, DisputeStatusResult[]> = new Map();
    /** Registered resolution event listeners */
    private resolutionListeners: Array<(event: DisputeResolutionEvent) => void> = [];
    /** Auto-incrementing dispute ID counter (used locally; real ID comes from on-chain tx) */
    private nextDisputeId: number = 1;

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

    // -------------------------------------------------------------------------
    // Custodian registration
    // -------------------------------------------------------------------------

    async registerCustodian(
        signerKeypair: Keypair,
        profile: CustodianProfile
    ): Promise<Horizon.SubmitTransactionResponse> {
        validateNonEmptyString(profile.name, 'name');
        validateNonEmptyString(profile.jurisdiction, 'jurisdiction');
        validateNonEmptyString(profile.licenseNumber, 'licenseNumber');
        this.logger.info('Registering custodian', { name: profile.name, address: signerKeypair.publicKey() });
        const account = await this.server.loadAccount(signerKeypair.publicKey());

        const transaction = new TransactionBuilder(account, {
            networkPassphrase: this.networkPassphrase,
            fee: DEFAULT_FEE_RATE.toString(),
        })
            .addOperation(
                Operation.invokeContractFunction({
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
                    ],
                })
            )
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const result = await this.server.submitTransaction(transaction);
        this.logger.info('Custodian registered', { name: profile.name, address: signerKeypair.publicKey() });
        return result;
    }

    // -------------------------------------------------------------------------
    // Attestation management
    // -------------------------------------------------------------------------

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
            assetId,
            custodian: signerKeypair.publicKey(),
            location: proofData.iotData?.location
                ? `${proofData.iotData.location.lat},${proofData.iotData.location.lng}`
                : 'unknown',
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
            expiresAt: Date.now() + DEFAULT_CUSTODY_EXPIRY_DAYS * DAY_IN_MILLISECONDS,
        };

        const transaction = new TransactionBuilder(account, {
            networkPassphrase: this.networkPassphrase,
            fee: DEFAULT_FEE_RATE.toString(),
        })
            .addOperation(
                Operation.invokeContractFunction({
                    contract: this.contractId,
                    function: 'submit_attestation',
                    args: [...this.encodeCustodyAttestation(attestation)],
                })
            )
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

            const isValid = latestAttestation
                ? latestAttestation.isValid && Date.now() < latestAttestation.expiresAt
                : false;

            const relevantAlerts = alerts
                .filter((entry): entry is [string, string] => {
                    if (!Array.isArray(entry) || entry.length < 2) return false;
                    const [asset] = entry;
                    return asset === tokenAddress;
                })
                .map(([, alert]) => alert);

            this.logger.info('Asset backing verified', { tokenAddress, isValid });
            return {
                isValid,
                latestAttestation: latestAttestation ?? undefined,
                alerts: relevantAlerts,
                insuranceStatus: latestAttestation?.insuranceStatus || 'unknown',
            };
        } catch (error) {
            throw new ContractError(`Failed to verify asset backing: ${error}`);
        }
    }

    async getCustodyHistory(assetId: string): Promise<CustodyAttestation[]> {
        return [];
    }

    // -------------------------------------------------------------------------
    // Dispute lifecycle (Issue #203)
    // -------------------------------------------------------------------------

    /**
     * File a new custody dispute against an existing attestation.
     *
     * Performs bond validation before broadcasting the `dispute_attestation`
     * contract call. Throws `InsufficientBondError` when `bondAmount` is zero
     * or negative.
     *
     * @param signerKeypair - Keypair of the challenger (must hold sufficient bond)
     * @param options       - Dispute parameters (attestationId, reason, evidenceHash, bondAmount)
     * @returns The newly created DisputeStatusResult with status PENDING
     */
    async fileDispute(
        signerKeypair: Keypair,
        options: DisputeOptions
    ): Promise<DisputeStatusResult> {
        const { attestationId, reason, evidenceHash, bondAmount } = options;

        validatePositiveInteger(attestationId, 'attestationId');
        validateNonEmptyString(reason, 'reason');
        validateNonEmptyString(evidenceHash, 'evidenceHash');
        validateAmount(bondAmount, 'bondAmount');

        // Bond validation: must be a positive, non-zero amount
        const bondBN = new BigNumber(bondAmount);
        if (bondBN.isNaN() || bondBN.isLessThanOrEqualTo(0)) {
            throw new InsufficientBondError(
                `Bond amount "${bondAmount}" is invalid or non-positive. A positive bond is required to file a dispute.`
            );
        }

        this.logger.info('Filing custody dispute', {
            attestationId,
            challenger: signerKeypair.publicKey(),
            bondAmount,
        });

        const account = await this.server.loadAccount(signerKeypair.publicKey());

        const transaction = new TransactionBuilder(account, {
            networkPassphrase: this.networkPassphrase,
            fee: DEFAULT_FEE_RATE.toString(),
        })
            .addOperation(
                Operation.invokeContractFunction({
                    contract: this.contractId,
                    function: 'dispute_attestation',
                    args: [
                        ...this.encodeNumber(attestationId),
                        ...this.encodeAddress(signerKeypair.publicKey()),
                        ...this.encodeString(reason),
                        ...this.encodeString(bondAmount),
                        ...this.encodeString(evidenceHash),
                    ],
                })
            )
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const txResult = await this.server.submitTransaction(transaction);

        // Assign a local dispute ID (the real on-chain ID would be parsed from the tx result/events)
        const disputeId = this.nextDisputeId++;
        const now = Date.now();

        const record: DisputeStatusResult = {
            disputeId,
            attestationId,
            challenger: signerKeypair.publicKey(),
            custodian: '',
            reason,
            bondAmount,
            evidenceHash,
            status: DisputeStatus.PENDING,
            createdAt: now,
            resolvedAt: null,
            resolution: null,
            bondReturned: false,
            penaltyApplied: false,
            penaltyAmount: '0',
        };

        this.disputeStore.set(disputeId, record);

        // Index by custodian for getRecentDisputes (when custodian is known)
        const byCustodian = this.disputeByCustodian.get(record.custodian) ?? [];
        byCustodian.push(record);
        this.disputeByCustodian.set(record.custodian, byCustodian);

        // Also index by challenger so callers can query their own disputes
        if (record.challenger !== record.custodian) {
            const byChallenger = this.disputeByCustodian.get(record.challenger) ?? [];
            byChallenger.push(record);
            this.disputeByCustodian.set(record.challenger, byChallenger);
        }

        this.logger.info('Dispute filed', { disputeId, txHash: txResult.hash });
        return { ...record };
    }

    /**
     * Retrieve the current status of a previously filed dispute.
     *
     * Returns a copy of the in-memory record if present, otherwise falls back
     * to querying the chain via `fetchDisputeFromChain`.
     *
     * @param disputeId - Numeric dispute ID returned by `fileDispute`
     * @returns The latest DisputeStatusResult
     */
    async getDisputeStatus(disputeId: number): Promise<DisputeStatusResult> {
        validatePositiveInteger(disputeId, 'disputeId');
        this.logger.info('Fetching dispute status', { disputeId });

        const cached = this.disputeStore.get(disputeId);
        if (cached) {
            return { ...cached };
        }

        // Fallback: simulate a chain query (real implementation would call a contract view fn)
        const record = await this.fetchDisputeFromChain(disputeId);
        this.disputeStore.set(disputeId, record);
        return { ...record };
    }

    /**
     * Retrieve recent disputes associated with a custodian address,
     * ordered from newest to oldest.
     *
     * @param custodian - Stellar address of the custodian being queried
     * @param limit     - Maximum records to return (1–100, default 20)
     * @returns Disputes sorted newest-first, capped at `limit`
     */
    async getRecentDisputes(
        custodian: string,
        limit: number = 20
    ): Promise<DisputeStatusResult[]> {
        validateAddress(custodian, 'custodian');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new InvalidParametersError('limit must be an integer between 1 and 100');
        }

        this.logger.info('Fetching recent disputes for custodian', { custodian, limit });

        const local = this.disputeByCustodian.get(custodian) ?? [];
        return [...local]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);
    }

    /**
     * Register a listener that is called whenever a dispute reaches a terminal
     * resolution (RESOLVED_UPHELD or RESOLVED_REJECTED).
     *
     * Multiple listeners are supported and all are invoked in registration order.
     *
     * @param listener - Callback receiving a `DisputeResolutionEvent`
     */
    onDisputeResolution(listener: (event: DisputeResolutionEvent) => void): void {
        this.resolutionListeners.push(listener);
        this.logger.info('Dispute resolution listener registered', {
            totalListeners: this.resolutionListeners.length,
        });
    }

    /**
     * @deprecated Use `fileDispute` for the full dispute lifecycle.
     * Retained for backward compatibility.
     */
    async initiateDispute(
        signerKeypair: Keypair,
        attestationId: number,
        reason: string,
        bondAmount: string,
        evidenceHash: string
    ): Promise<Horizon.SubmitTransactionResponse> {
        validateNonEmptyString(reason, 'reason');
        validateAmount(bondAmount, 'bondAmount');
        this.logger.info('Initiating dispute', {
            attestationId,
            challenger: signerKeypair.publicKey(),
            reason,
        });
        const account = await this.server.loadAccount(signerKeypair.publicKey());

        const transaction = new TransactionBuilder(account, {
            networkPassphrase: this.networkPassphrase,
            fee: DEFAULT_FEE_RATE.toString(),
        })
            .addOperation(
                Operation.invokeContractFunction({
                    contract: this.contractId,
                    function: 'dispute_attestation',
                    args: [
                        ...this.encodeNumber(attestationId),
                        ...this.encodeAddress(signerKeypair.publicKey()),
                        ...this.encodeString(reason),
                        ...this.encodeString(bondAmount),
                        ...this.encodeString(evidenceHash),
                    ],
                })
            )
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const result = await this.server.submitTransaction(transaction);
        this.logger.info('Dispute initiated', { attestationId, hash: result.hash });
        return result;
    }

    /**
     * Retrieve a dispute by ID in the legacy `DisputeRecord` shape.
     * Delegates to `getDisputeStatus` internally.
     *
     * @param disputeId - Numeric dispute ID
     */
    async getDispute(disputeId: number): Promise<DisputeRecord> {
        validatePositiveInteger(disputeId, 'disputeId');
        const status = await this.getDisputeStatus(disputeId);
        return {
            disputeId: status.disputeId,
            attestationId: status.attestationId,
            challenger: status.challenger,
            custodian: status.custodian,
            reason: status.reason,
            bondAmount: status.bondAmount,
            evidenceHash: status.evidenceHash,
            status: status.status,
            createdAt: status.createdAt,
            resolvedAt: status.resolvedAt ?? 0,
            resolution: status.resolution ?? '',
            bondReturned: status.bondReturned,
            penaltyApplied: status.penaltyApplied,
            penaltyAmount: status.penaltyAmount,
        };
    }

    // -------------------------------------------------------------------------
    // Insurance
    // -------------------------------------------------------------------------

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
            admin: signerKeypair.publicKey(),
        });

        const account = await this.server.loadAccount(signerKeypair.publicKey());

        const transaction = new TransactionBuilder(account, {
            networkPassphrase: this.networkPassphrase,
            fee: DEFAULT_FEE_RATE.toString(),
        })
            .addOperation(
                Operation.invokeContractFunction({
                    contract: this.contractId,
                    function: 'trigger_insurance_claim',
                    args: [
                        ...this.encodeAddress(signerKeypair.publicKey()),
                        ...this.encodeAddress(assetId),
                        ...this.encodeString(claimReason),
                        ...this.encodeString(evidenceHash),
                    ],
                })
            )
            .setTimeout(DEFAULT_TIMEOUT_SECONDS)
            .build();

        transaction.sign(signerKeypair);
        const result = await this.server.submitTransaction(transaction);
        this.logger.info('Insurance claim triggered', {
            assetId,
            claimReason,
            hash: result.hash,
        });
        return result;
    }

    // -------------------------------------------------------------------------
    // Stub read methods (to be implemented against chain view functions)
    // -------------------------------------------------------------------------

    async getCustodianInfo(custodianAddress: string): Promise<CustodianRegistry> {
        throw new ContractError('Not implemented');
    }

    async listActiveCustodians(): Promise<CustodianRegistry[]> {
        throw new ContractError('Not implemented');
    }

    async getVerificationConfig(verificationType: string): Promise<VerificationTypeConfig> {
        throw new ContractError('Not implemented');
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Notify all registered resolution listeners with a terminal event.
     * Errors thrown by individual listeners are swallowed and logged so that
     * one faulty listener cannot block the rest.
     */
    private notifyResolutionListeners(event: DisputeResolutionEvent): void {
        for (const listener of this.resolutionListeners) {
            try {
                listener(event);
            } catch (err) {
                this.logger.info('Resolution listener threw an error', { error: String(err) });
            }
        }
    }

    /**
     * Simulate fetching a dispute from the chain.
     * In a production SDK this would call a Soroban view function or query
     * indexed event logs; here it returns a NOT_FOUND error to keep the
     * unit-test surface honest.
     */
    private async fetchDisputeFromChain(disputeId: number): Promise<DisputeStatusResult> {
        throw new ContractError(
            `Dispute with id ${disputeId} not found in local store and chain query is not yet implemented.`
        );
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
