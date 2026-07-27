'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  Building2,
  UserCheck,
  Calendar,
  ShieldAlert,
  Upload,
  Globe,
  Key,
  Banknote,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import { useTheme } from '@/theme';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AttestationProof {
  attestationId: string;
  custodian: string;
  custodianName?: string;
  assetId: string;
  type: 'physical' | 'legal' | 'iot' | 'satellite' | 'oracle';
  typeLabel?: string;
  timestamp: number;
  expiresAt: number;
  status: 'valid' | 'expiring_soon' | 'expired';
  proofHash: string;
  verificationType: string;
  metadata: Record<string, string>;
}

interface InsuranceInfo {
  provider: string;
  policyNumber: string;
  coverageAmount: string;
  premiumAmount: string;
  validUntil: number;
  status: 'active' | 'expired' | 'lapsed';
  claimAutoTrigger: boolean;
}

interface OracleVerification {
  oracleAddress: string;
  name: string;
  verificationDate: number;
  method: string;
  status: 'verified' | 'pending' | 'disputed';
  signatureHash: string;
}

interface CustodyAlert {
  alertId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  recommendedAction: string;
}

export interface CustodyVerificationPanelProps {
  assetId: string;
  assetSymbol: string;
  proofs: AttestationProof[];
  insurance: InsuranceInfo | null;
  oracleVerifications: OracleVerification[];
  alerts: CustodyAlert[];
  isAdmin?: boolean;
  onRefresh?: () => Promise<void>;
  onSubmitProof?: (proofData: {
    assetId: string;
    type: string;
    custodian: string;
    proofHash: string;
    metadata: Record<string, string>;
  }) => Promise<void>;
  isLoading?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  critical: 'border-red-500 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200',
  high: 'border-orange-500 bg-orange-50 dark:bg-orange-950/30 text-orange-800 dark:text-orange-200',
  medium: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-200',
  low: 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-200',
};

const SEVERITY_ICONS = {
  critical: XCircle,
  high: AlertTriangle,
  medium: AlertTriangle,
  low: Shield,
};

const STATUS_STYLES: Record<AttestationProof['status'], { variant: string; icon: React.FC<{ className?: string }>; color: string }> = {
  valid: {
    variant: 'text-green-700 dark:text-green-400',
    icon: CheckCircle2,
    color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-300 dark:border-green-700',
  },
  expiring_soon: {
    variant: 'text-yellow-700 dark:text-yellow-400',
    icon: Clock,
    color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700',
  },
  expired: {
    variant: 'text-red-700 dark:text-red-400',
    icon: XCircle,
    color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700',
  },
};

const TYPE_LABELS: Record<AttestationProof['type'], string> = {
  physical: 'Physical Inspection',
  legal: 'Legal Verification',
  iot: 'IoT Monitoring',
  satellite: 'Satellite Imagery',
  oracle: 'Oracle Attestation',
};

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDaysUntil(ts: number): number {
  return Math.ceil((ts * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CustodyVerificationPanel({
  assetId,
  assetSymbol,
  proofs,
  insurance,
  oracleVerifications,
  alerts,
  isAdmin = false,
  onRefresh,
  onSubmitProof,
  isLoading = false,
}: CustodyVerificationPanelProps) {
  const { resolvedTheme } = useTheme();

  // State
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [expandedProofs, setExpandedProofs] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [proofForm, setProofForm] = useState({
    type: 'physical' as AttestationProof['type'],
    proofHash: '',
    metadataKey: '',
    metadataValue: '',
  });

  // Derived data
  const validProofs = proofs.filter((p) => p.status === 'valid');
  const expiringProofs = proofs.filter((p) => p.status === 'expiring_soon');
  const expiredProofs = proofs.filter((p) => p.status === 'expired');

  const filteredProofs = useMemo(() => {
    if (!searchFilter.trim()) return proofs;
    const q = searchFilter.toLowerCase();
    return proofs.filter(
      (p) =>
        p.attestationId.toLowerCase().includes(q) ||
        p.custodian.toLowerCase().includes(q) ||
        (p.custodianName && p.custodianName.toLowerCase().includes(q)) ||
        p.type.toLowerCase().includes(q) ||
        TYPE_LABELS[p.type].toLowerCase().includes(q)
    );
  }, [proofs, searchFilter]);

  const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
  const otherAlerts = alerts.filter((a) => a.severity !== 'critical');

  const toggleProofExpand = (id: string) => {
    setExpandedProofs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmitProof = async () => {
    if (!onSubmitProof) return;
    if (!proofForm.proofHash.trim()) {
      setSubmitError('Proof hash is required');
      return;
    }

    setSubmitError(null);
    setSubmitSuccess(null);
    setSubmitting(true);

    try {
      await onSubmitProof({
        assetId,
        type: proofForm.type,
        custodian: '', // Will be filled by the connected wallet
        proofHash: proofForm.proofHash,
        metadata: proofForm.metadataKey
          ? { [proofForm.metadataKey]: proofForm.metadataValue }
          : {},
      });

      setSubmitSuccess('Proof submitted successfully!');
      setProofForm({ type: 'physical', proofHash: '', metadataKey: '', metadataValue: '' });
      setTimeout(() => setSubmitSuccess(null), 5000);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit proof');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-theme-skeleton animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="h-96 bg-theme-skeleton animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div
      className="max-w-6xl mx-auto space-y-6"
      role="region"
      aria-label={`Custody verification for ${assetSymbol}`}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-theme-accent-primary" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-bold text-theme-text-primary">
              Custody Verification
            </h1>
            <p className="text-sm text-theme-text-secondary">
              Asset: {assetSymbol}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRefresh()}
              disabled={isLoading}
              aria-label="Refresh custody data"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshIcon className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="ml-1 hidden sm:inline">Refresh</span>
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setShowSubmitForm(!showSubmitForm)}
              aria-expanded={showSubmitForm}
              aria-controls="submit-proof-form"
            >
              <Upload className="h-4 w-4 mr-1" aria-hidden="true" />
              Submit Proof
            </Button>
          )}
        </div>
      </div>

      {/* ── Critical Alerts Banner ─────────────────────────────── */}
      {criticalAlerts.length > 0 && (
        <div className="space-y-2">
          {criticalAlerts.map((alert) => (
            <Alert
              key={alert.alertId}
              variant="destructive"
              className="border-l-4 animate-fade-in"
              role="alert"
            >
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
              <AlertDescription className="flex-1">
                <span className="font-semibold">{alert.message}</span>
                <span className="block text-sm mt-1 opacity-90">
                  {alert.recommendedAction}
                </span>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* ── Status Overview Cards ──────────────────────────────── */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        role="region"
        aria-label="Proof verification overview"
      >
        <Card className="transition-colors hover:shadow-md">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-theme-text-secondary">
                  Valid Proofs
                </p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {validProofs.length}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-500" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:shadow-md">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-theme-text-secondary">
                  Expiring Soon
                </p>
                <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {expiringProofs.length}
                </p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:shadow-md">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-theme-text-secondary">
                  Expired
                </p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {expiredProofs.length}
                </p>
              </div>
              <XCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card className="transition-colors hover:shadow-md">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-theme-text-secondary">
                  Alerts
                </p>
                <p
                  className={`text-2xl font-bold ${
                    alerts.length > 0
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {alerts.length}
                </p>
              </div>
              <ShieldAlert
                className={`h-8 w-8 ${
                  alerts.length > 0 ? 'text-orange-500' : 'text-green-500'
                }`}
                aria-hidden="true"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="proofs" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4" role="tablist" aria-label="Verification sections">
          <TabsTrigger value="proofs" role="tab">
            Proofs ({proofs.length})
          </TabsTrigger>
          <TabsTrigger value="insurance" role="tab">
            Insurance
          </TabsTrigger>
          <TabsTrigger value="oracles" role="tab">
            Oracle Verification
          </TabsTrigger>
          <TabsTrigger value="alerts" role="tab">
            Alerts ({alerts.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Proofs Tab ──────────────────────────────────────── */}
        <TabsContent value="proofs" className="space-y-4" role="tabpanel" aria-label="Attestation proofs">
          {/* Submit form */}
          {showSubmitForm && isAdmin && (
            <Card id="submit-proof-form" role="form" aria-label="Submit new attestation proof">
              <CardHeader>
                <CardTitle className="text-lg">Submit New Proof</CardTitle>
              </CardHeader>
              <CardContent>
                {submitSuccess && (
                  <Alert className="mb-4 border-green-500 bg-green-50 dark:bg-green-950/30" role="status">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800 dark:text-green-200">
                      {submitSuccess}
                    </AlertDescription>
                  </Alert>
                )}
                {submitError && (
                  <Alert variant="destructive" className="mb-4" role="alert">
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="proof-type">Verification Type</Label>
                    <select
                      id="proof-type"
                      value={proofForm.type}
                      onChange={(e) => setProofForm((p) => ({ ...p, type: e.target.value as AttestationProof['type'] }))}
                      className="w-full rounded-lg border border-theme-border bg-theme-input-bg text-theme-text-primary px-3 py-2 focus:ring-2 focus:ring-theme-accent-primary focus:border-transparent transition-colors"
                    >
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="proof-hash">Proof Hash</Label>
                    <Input
                      id="proof-hash"
                      value={proofForm.proofHash}
                      onChange={(e) => setProofForm((p) => ({ ...p, proofHash: e.target.value }))}
                      placeholder="0x..."
                      aria-required="true"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="proof-metadata-key">Metadata Key (optional)</Label>
                    <Input
                      id="proof-metadata-key"
                      value={proofForm.metadataKey}
                      onChange={(e) => setProofForm((p) => ({ ...p, metadataKey: e.target.value }))}
                      placeholder="e.g., inspection_id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="proof-metadata-value">Metadata Value</Label>
                    <Input
                      id="proof-metadata-value"
                      value={proofForm.metadataValue}
                      onChange={(e) => setProofForm((p) => ({ ...p, metadataValue: e.target.value }))}
                      placeholder="e.g., INS-2024-001"
                    />
                  </div>
                </div>
                <div className="flex justify-end mt-4 gap-2">
                  <Button variant="outline" onClick={() => setShowSubmitForm(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmitProof} disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Submit Proof'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-tertiary" />
            <Input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search by attestation ID, custodian, or proof type..."
              className="pl-9"
            />
          </div>

          {/* Proof List */}
          {filteredProofs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText className="h-12 w-12 mx-auto text-theme-text-tertiary mb-4" aria-hidden="true" />
                <p className="text-theme-text-secondary font-medium">No proofs found</p>
                <p className="text-sm text-theme-text-tertiary mt-1">
                  {searchFilter ? 'Try adjusting your search filter.' : 'No attestation proofs have been submitted yet.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" role="list" aria-label="Attestation proofs list">
              {filteredProofs.map((proof) => {
                const StatusIcon = STATUS_STYLES[proof.status].icon;
                const isExpanded = expandedProofs.has(proof.attestationId);
                const daysLeft = getDaysUntil(proof.expiresAt);

                return (
                  <Card
                    key={proof.attestationId}
                    className={`border-l-4 transition-colors hover:shadow-md ${STATUS_STYLES[proof.status].color}`}
                    role="listitem"
                    aria-label={`Attestation ${proof.attestationId}: ${TYPE_LABELS[proof.type]}, status ${proof.status}`}
                  >
                    <CardContent className="p-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Left: main info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusIcon className={`h-4 w-4 ${STATUS_STYLES[proof.status].variant}`} aria-hidden="true" />
                            <Badge variant="outline" className="font-mono text-xs">
                              {proof.attestationId.slice(0, 12)}...
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {TYPE_LABELS[proof.type]}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-sm">
                            <div>
                              <span className="text-theme-text-tertiary">Custodian</span>
                              <p className="font-mono text-xs text-theme-text-secondary truncate">
                                {proof.custodianName || `${proof.custodian.slice(0, 6)}...${proof.custodian.slice(-4)}`}
                              </p>
                            </div>
                            <div>
                              <span className="text-theme-text-tertiary">Submitted</span>
                              <p className="text-theme-text-secondary">{formatDate(proof.timestamp)}</p>
                            </div>
                            <div>
                              <span className="text-theme-text-tertiary">Expires</span>
                              <p className="text-theme-text-secondary">
                                {formatDate(proof.expiresAt)}
                                <span className="ml-1 text-xs">
                                  ({daysLeft > 0 ? `${daysLeft}d` : 'Expired'})
                                </span>
                              </p>
                            </div>
                            <div>
                              <span className="text-theme-text-tertiary">Status</span>
                              <Badge
                                variant={
                                  proof.status === 'valid'
                                    ? 'default'
                                    : proof.status === 'expiring_soon'
                                    ? 'secondary'
                                    : 'destructive'
                                }
                                className="text-xs capitalize"
                              >
                                {proof.status.replace('_', ' ')}
                              </Badge>
                            </div>
                          </div>

                          {/* Expandable details */}
                          {isExpanded && (
                            <div className="mt-3 pt-3 border-t border-theme-border text-sm space-y-2 animate-fade-in">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <span className="text-theme-text-tertiary">Proof Hash</span>
                                  <p className="font-mono text-xs text-theme-text-secondary break-all">
                                    {proof.proofHash}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-theme-text-tertiary">Verification Method</span>
                                  <p className="text-theme-text-secondary">{proof.verificationType}</p>
                                </div>
                              </div>
                              {Object.keys(proof.metadata).length > 0 && (
                                <div>
                                  <span className="text-theme-text-tertiary">Metadata</span>
                                  <div className="flex flex-wrap gap-2 mt-1">
                                    {Object.entries(proof.metadata).map(([k, v]) => (
                                      <Badge key={k} variant="outline" className="text-xs">
                                        {k}: {v}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Right: expand button */}
                        <button
                          onClick={() => toggleProofExpand(proof.attestationId)}
                          className="shrink-0 p-2 rounded-full hover:bg-theme-surface-hover transition-colors"
                          aria-label={isExpanded ? 'Collapse proof details' : 'Expand proof details'}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-theme-text-secondary" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-theme-text-secondary" />
                          )}
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Insurance Tab ───────────────────────────────────── */}
        <TabsContent value="insurance" className="space-y-4" role="tabpanel" aria-label="Insurance information">
          {!insurance ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Banknote className="h-12 w-12 mx-auto text-theme-text-tertiary mb-4" aria-hidden="true" />
                <p className="text-theme-text-secondary font-medium">No insurance information</p>
                <p className="text-sm text-theme-text-tertiary mt-1">
                  Insurance details for this asset are not available.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="transition-colors hover:shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Banknote className="h-5 w-5 text-theme-accent-success" aria-hidden="true" />
                  Insurance Coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="space-y-1">
                    <p className="text-sm text-theme-text-tertiary">Provider</p>
                    <p className="font-semibold text-theme-text-primary">{insurance.provider}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-theme-text-tertiary">Policy Number</p>
                    <p className="font-mono text-theme-text-primary">{insurance.policyNumber}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-theme-text-tertiary">Coverage Amount</p>
                    <p className="font-semibold text-theme-accent-success">
                      ${parseFloat(insurance.coverageAmount).toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-theme-text-tertiary">Premium</p>
                    <p className="text-theme-text-primary">
                      ${parseFloat(insurance.premiumAmount).toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-theme-text-tertiary">Valid Until</p>
                    <p className="text-theme-text-primary">{formatDate(insurance.validUntil)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-theme-text-tertiary">Status</p>
                    <Badge
                      variant={
                        insurance.status === 'active'
                          ? 'default'
                          : insurance.status === 'expired'
                          ? 'destructive'
                          : 'secondary'
                      }
                      className="capitalize"
                    >
                      {insurance.status}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-theme-text-tertiary">Auto Claim</p>
                    <Badge variant={insurance.claimAutoTrigger ? 'default' : 'outline'}>
                      {insurance.claimAutoTrigger ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Oracle Verification Tab ─────────────────────────── */}
        <TabsContent value="oracles" className="space-y-4" role="tabpanel" aria-label="Oracle verifications">
          {oracleVerifications.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Globe className="h-12 w-12 mx-auto text-theme-text-tertiary mb-4" aria-hidden="true" />
                <p className="text-theme-text-secondary font-medium">No oracle verifications</p>
                <p className="text-sm text-theme-text-tertiary mt-1">
                  Oracle verification data will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" role="list" aria-label="Oracle verification list">
              {oracleVerifications.map((ov, i) => (
                <Card
                  key={i}
                  className="transition-colors hover:shadow-md"
                  role="listitem"
                  aria-label={`Oracle verification by ${ov.name}: ${ov.status}`}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Globe className="h-4 w-4 text-theme-accent-primary" aria-hidden="true" />
                          <span className="font-semibold text-theme-text-primary">{ov.name}</span>
                          <Badge
                            variant={
                              ov.status === 'verified'
                                ? 'default'
                                : ov.status === 'disputed'
                                ? 'destructive'
                                : 'secondary'
                            }
                            className="text-xs capitalize"
                          >
                            {ov.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-theme-text-tertiary">Oracle Address</span>
                            <p className="font-mono text-xs text-theme-text-secondary">
                              {ov.oracleAddress.slice(0, 8)}...{ov.oracleAddress.slice(-6)}
                            </p>
                          </div>
                          <div>
                            <span className="text-theme-text-tertiary">Method</span>
                            <p className="text-theme-text-secondary">{ov.method}</p>
                          </div>
                          <div>
                            <span className="text-theme-text-tertiary">Verification Date</span>
                            <p className="text-theme-text-secondary">{formatDate(ov.verificationDate)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <span className="text-theme-text-tertiary">Signature</span>
                        <p className="font-mono text-theme-text-secondary">
                          {ov.signatureHash.slice(0, 8)}...
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Alerts Tab ──────────────────────────────────────── */}
        <TabsContent value="alerts" className="space-y-4" role="tabpanel" aria-label="Custody alerts">
          {alerts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Shield className="h-12 w-12 mx-auto text-green-500 mb-4" aria-hidden="true" />
                <p className="text-theme-text-secondary font-medium">No active alerts</p>
                <p className="text-sm text-theme-text-tertiary mt-1">
                  All custody verifications are in good standing.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" role="list" aria-label="Custody alerts list">
              {[...criticalAlerts, ...otherAlerts].map((alert) => {
                const Icon = SEVERITY_ICONS[alert.severity];
                return (
                  <div
                    key={alert.alertId}
                    className={`border-l-4 rounded-lg p-4 ${SEVERITY_STYLES[alert.severity]} transition-all hover:shadow-md animate-fade-in`}
                    role="listitem"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{alert.message}</span>
                          <Badge
                            variant="outline"
                            className="text-xs capitalize"
                          >
                            {alert.severity}
                          </Badge>
                        </div>
                        <p className="text-sm opacity-80">{alert.recommendedAction}</p>
                        <p className="text-xs opacity-60 mt-2 flex items-center gap-1">
                          <Calendar className="h-3 w-3" aria-hidden="true" />
                          {formatDate(alert.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Inline refresh icon component to avoid missing import
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}
