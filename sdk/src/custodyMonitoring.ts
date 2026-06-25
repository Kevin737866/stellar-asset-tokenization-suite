import { CustodyClient, CustodyAttestation, CustodianRegistry, DisputeRecord } from './custody';
import { Server, Keypair } from '@stellar/stellar-base';
import axios from 'axios';
import { REPUTATION_SCORE_LOW_THRESHOLD, YEAR_IN_MILLISECONDS, MONTH_IN_MILLISECONDS, DAY_IN_MILLISECONDS, MILLISECONDS_PER_MINUTE } from './constants';
import { createLogger, Logger } from './logger';
import { validateAddress, validateNonEmptyString, validatePositiveInteger, validateServerUrl } from './validation';

export interface CustodyAlert {
    assetId: string;
    alertType: 'attestation_expired' | 'attestation_expiring_soon' | 'invalid_attestation' | 'custodian_reputation_low' | 'insurance_lapsed';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: number;
    recommendedAction: string;
}

export interface CustodianMetrics {
    custodianAddress: string;
    name: string;
    reputationScore: number;
    totalAttestations: number;
    successfulDisputes: number;
    failedDisputes: number;
    disputeSuccessRate: number;
    averageVerificationTime: number;
    lastActivity: number;
    status: 'active' | 'suspended' | 'under_review';
}

export interface AssetDepreciationData {
    assetId: string;
    initialValue: number;
    currentValue: number;
    depreciationRate: number;
    lastUpdated: number;
    appraisalHistory: Array<{
        timestamp: number;
        value: number;
        appraiser: string;
        method: string;
    }>;
}

export interface InsuranceStatus {
    assetId: string;
    provider: string;
    policyNumber: string;
    coverageAmount: number;
    premiumAmount: number;
    validUntil: number;
    status: 'active' | 'expired' | 'lapsed' | 'claim_pending';
    lastPremiumPaid: number;
    autoClaimEnabled: boolean;
}

export interface MonitoringConfig {
    alertThresholds: {
        attestationExpiryWarningDays: number;
        minimumReputationScore: number;
        insuranceExpiryWarningDays: number;
        maxDisputeFailureRate: number;
    };
    notificationChannels: {
        email?: string[];
        webhook?: string;
        telegram?: string;
        slack?: string;
    };
    monitoringFrequency: number;
    autoRenewalEnabled: boolean;
}

export class CustodyMonitoring {
    private custodyClient: CustodyClient;
    private config: MonitoringConfig;
    private monitoringInterval?: NodeJS.Timeout;
    private server: Server;
    private logger: Logger;

    constructor(
        custodyClient: CustodyClient,
        config: MonitoringConfig,
        serverUrl: string = 'https://horizon-testnet.stellar.org'
    ) {
        validateServerUrl(serverUrl, 'serverUrl');
        validatePositiveInteger(config.monitoringFrequency, 'monitoringFrequency');
        this.custodyClient = custodyClient;
        this.config = config;
        this.server = new Server(serverUrl);
        this.logger = createLogger('CustodyMonitoring');
    }

    async startMonitoring(): Promise<void> {
        this.logger.info('Starting custody monitoring...');
        
        await this.performMonitoringCycle();
        
        this.monitoringInterval = setInterval(
            async () => {
                try {
                    await this.performMonitoringCycle();
                } catch (error) {
                    this.logger.error('Error in monitoring cycle:', { error });
                }
            },
            this.config.monitoringFrequency * MILLISECONDS_PER_MINUTE
        );
    }

    async stopMonitoring(): Promise<void> {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
        this.logger.info('Custody monitoring stopped');
    }

    private async performMonitoringCycle(): Promise<void> {
        this.logger.info(`Performing monitoring cycle at ${new Date().toISOString()}`);
        
        const alerts: CustodyAlert[] = [];
        
        const attestationAlerts = await this.checkAttestationExpiry();
        alerts.push(...attestationAlerts);
        
        const reputationAlerts = await this.checkCustodianReputation();
        alerts.push(...reputationAlerts);
        
        const insuranceAlerts = await this.checkInsuranceStatus();
        alerts.push(...insuranceAlerts);
        
        const disputeAlerts = await this.checkDisputeStatus();
        alerts.push(...disputeAlerts);
        
        if (alerts.length > 0) {
            await this.sendAlerts(alerts);
        }
        
        this.logger.info(`Monitoring cycle completed. Found ${alerts.length} alerts.`);
    }

    private async checkAttestationExpiry(): Promise<CustodyAlert[]> {
        const alerts: CustodyAlert[] = [];
        
        try {
            const contractAlerts = await this.custodyClient['getCustodyAlerts']();
            
            for (const [assetId, alertType] of contractAlerts) {
                const validTypes = ['attestation_expired', 'attestation_expiring_soon', 'invalid_attestation', 'custodian_reputation_low', 'insurance_lapsed'] as const;
            const safeAlertType: CustodyAlert['alertType'] = validTypes.includes(alertType as any)
              ? (alertType as CustodyAlert['alertType'])
              : 'invalid_attestation';

            const alert: CustodyAlert = {
                    assetId: assetId,
                    alertType: safeAlertType,
                    severity: this.determineAlertSeverity(alertType),
                    message: this.generateAlertMessage(alertType, assetId),
                    timestamp: Date.now(),
                    recommendedAction: this.getRecommendedAction(alertType)
                };
                
                alerts.push(alert);
            }
            
            const expiringSoonAlerts = await this.checkExpiringSoonAttestations();
            alerts.push(...expiringSoonAlerts);
            
        } catch (error) {
            this.logger.error('Error checking attestation expiry:', { error });
        }
        
        return alerts;
    }

    private async checkExpiringSoonAttestations(): Promise<CustodyAlert[]> {
        const alerts: CustodyAlert[] = [];
        
        return alerts;
    }

    private async checkCustodianReputation(): Promise<CustodyAlert[]> {
        const alerts: CustodyAlert[] = [];
        
        try {
            const custodians = await this.custodyClient.listActiveCustodians();
            
            for (const custodian of custodians) {
                if (custodian.reputationScore < this.config.alertThresholds.minimumReputationScore) {
                    const alert: CustodyAlert = {
                        assetId: custodian.custodianAddress,
                        alertType: 'custodian_reputation_low',
                        severity: custodian.reputationScore < REPUTATION_SCORE_LOW_THRESHOLD ? 'critical' : 'high',
                        message: `Custodian ${custodian.name} has low reputation score: ${custodian.reputationScore}`,
                        timestamp: Date.now(),
                        recommendedAction: 'Review custodian performance and consider suspension'
                    };
                    
                    alerts.push(alert);
                }
                
                const totalDisputes = custodian.successfulDisputes + custodian.failedDisputes;
                if (totalDisputes > 0) {
                    const failureRate = custodian.failedDisputes / totalDisputes;
                    if (failureRate > this.config.alertThresholds.maxDisputeFailureRate) {
                        const alert: CustodyAlert = {
                            assetId: custodian.custodianAddress,
                            alertType: 'custodian_reputation_low',
                            severity: 'high',
                            message: `Custodian ${custodian.name} has high dispute failure rate: ${(failureRate * 100).toFixed(1)}%`,
                            timestamp: Date.now(),
                            recommendedAction: 'Investigate dispute patterns and provide additional training'
                        };
                        
                        alerts.push(alert);
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error checking custodian reputation:', { error });
        }
        
        return alerts;
    }

    private async checkInsuranceStatus(): Promise<CustodyAlert[]> {
        const alerts: CustodyAlert[] = [];
        
        return alerts;
    }

    private async checkDisputeStatus(): Promise<CustodyAlert[]> {
        const alerts: CustodyAlert[] = [];
        
        return alerts;
    }

    private determineAlertSeverity(alertType: string): 'low' | 'medium' | 'high' | 'critical' {
        switch (alertType) {
            case 'attestation_expiring_soon':
                return 'medium';
            case 'attestation_expired':
            case 'insurance_lapsed':
                return 'high';
            case 'invalid_attestation':
                return 'critical';
            case 'custodian_reputation_low':
                return 'high';
            default:
                return 'medium';
        }
    }

    private generateAlertMessage(alertType: string, assetId: string): string {
        switch (alertType) {
            case 'attestation_expiring_soon':
                return `Attestation for asset ${assetId} is expiring soon`;
            case 'attestation_expired':
                return `Attestation for asset ${assetId} has expired`;
            case 'invalid_attestation':
                return `Invalid attestation detected for asset ${assetId}`;
            case 'insurance_lapsed':
                return `Insurance has lapsed for asset ${assetId}`;
            default:
                return `Alert for asset ${assetId}: ${alertType}`;
        }
    }

    private getRecommendedAction(alertType: string): string {
        switch (alertType) {
            case 'attestation_expiring_soon':
                return 'Submit a new attestation before the current one expires';
            case 'attestation_expired':
                return 'Submit a new attestation immediately to restore asset backing';
            case 'invalid_attestation':
                return 'Investigate the attestation issue and submit a corrected version';
            case 'insurance_lapsed':
                return 'Renew insurance policy immediately';
            case 'custodian_reputation_low':
                return 'Review custodian performance and consider additional oversight';
            default:
                return 'Review the alert and take appropriate action';
        }
    }

    private async sendAlerts(alerts: CustodyAlert[]): Promise<void> {
        const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
        const highAlerts = alerts.filter(alert => alert.severity === 'high');
        const mediumAlerts = alerts.filter(alert => alert.severity === 'medium');
        const lowAlerts = alerts.filter(alert => alert.severity === 'low');

        if (this.config.notificationChannels.email) {
            await this.sendEmailAlerts(criticalAlerts.concat(highAlerts));
        }
        
        if (this.config.notificationChannels.webhook) {
            await this.sendWebhookAlerts(alerts);
        }
        
        if (this.config.notificationChannels.slack) {
            await this.sendSlackAlerts(criticalAlerts.concat(highAlerts));
        }
        
        for (const alert of alerts) {
            this.logger.info(`[${alert.severity.toUpperCase()}] ${alert.message}`);
        }
    }

    private async sendEmailAlerts(alerts: CustodyAlert[]): Promise<void> {
        this.logger.info(`Would send ${alerts.length} email alerts`);
    }

    private async sendWebhookAlerts(alerts: CustodyAlert[]): Promise<void> {
        if (!this.config.notificationChannels.webhook) return;
        
        try {
            await axios.post(this.config.notificationChannels.webhook, {
                alerts,
                timestamp: Date.now(),
                source: 'custody-monitoring'
            });
        } catch (error) {
            this.logger.error('Failed to send webhook alerts:', { error });
        }
    }

    private async sendSlackAlerts(alerts: CustodyAlert[]): Promise<void> {
        this.logger.info(`Would send ${alerts.length} Slack alerts`);
    }

    async getCustodianMetrics(custodianAddress: string): Promise<CustodianMetrics> {
        validateAddress(custodianAddress, 'custodianAddress');
        const custodian = await this.custodyClient.getCustodianInfo(custodianAddress);
        
        const totalDisputes = custodian.successfulDisputes + custodian.failedDisputes;
        const disputeSuccessRate = totalDisputes > 0 ? 
            (custodian.successfulDisputes / totalDisputes) * 100 : 100;
        
        return {
            custodianAddress: custodian.custodianAddress,
            name: custodian.name,
            reputationScore: custodian.reputationScore,
            totalAttestations: custodian.totalAttestations,
            successfulDisputes: custodian.successfulDisputes,
            failedDisputes: custodian.failedDisputes,
            disputeSuccessRate: disputeSuccessRate,
            averageVerificationTime: 0,
            lastActivity: Date.now(),
            status: custodian.isActive ? 'active' : 'suspended'
        };
    }

    async trackAssetDepreciation(assetId: string): Promise<AssetDepreciationData> {
        validateNonEmptyString(assetId, 'assetId');
        return {
            assetId: assetId,
            initialValue: 1000000,
            currentValue: 950000,
            depreciationRate: 5,
            lastUpdated: Date.now(),
            appraisalHistory: []
        };
    }

    async verifyInsuranceStatus(assetId: string): Promise<InsuranceStatus> {
        validateNonEmptyString(assetId, 'assetId');
        return {
            assetId: assetId,
            provider: 'Global Insurance Co.',
            policyNumber: 'POL-123456',
            coverageAmount: 1000000,
            premiumAmount: 5000,
            validUntil: Date.now() + YEAR_IN_MILLISECONDS,
            status: 'active',
            lastPremiumPaid: Date.now() - MONTH_IN_MILLISECONDS,
            autoClaimEnabled: true
        };
    }

    updateConfig(newConfig: Partial<MonitoringConfig>): void {
        if (newConfig.monitoringFrequency !== undefined) {
            validatePositiveInteger(newConfig.monitoringFrequency, 'monitoringFrequency');
        }
        this.config = { ...this.config, ...newConfig };
        
        if (newConfig.monitoringFrequency && this.monitoringInterval) {
            this.stopMonitoring();
            this.startMonitoring();
        }
    }

    getMonitoringStatus(): {
        isActive: boolean;
        config: MonitoringConfig;
        lastCheck: number;
    } {
        return {
            isActive: !!this.monitoringInterval,
            config: this.config,
            lastCheck: Date.now()
        };
    }
}
