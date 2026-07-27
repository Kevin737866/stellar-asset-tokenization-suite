'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, TrendingUp, Clock, DollarSign, History, Settings, Zap } from 'lucide-react';

interface DividendDistribution {
  distributionId: number;
  tokenAddress: string;
  currency: string;
  totalAmount: string;
  perTokenAmount: string;
  claimDeadline: Date;
  createdAt: Date;
  isActive: boolean;
  metadata: Record<string, string>;
}

interface ClaimRecord {
  distributionId: number;
  date: Date;
  amount: string;
  currency: string;
  txHash: string;
}

interface YieldSummary {
  totalEarned: string;
  pending: string;
  annualizedYield: number;
}

interface DividendPanelProps {
  userAddress: string;
  distributions: DividendDistribution[];
  claimHistory: ClaimRecord[];
  yieldSummary: YieldSummary;
  isAdmin?: boolean;
  onClaim: (distributionId: number) => Promise<{ txHash: string; amount: string }>;
  onClaimAll: () => Promise<{ txHash: string; amounts: string[] }>;
  onCreateDistribution?: (params: {
    tokenAddress: string;
    currency: string;
    amount: string;
    deadline: Date;
  }) => Promise<{ txHash: string; distributionId: number }>;
  onEstimateGas?: (distributionId: number) => Promise<{ baseFee: string; totalFee: string }>;
  isLoading?: boolean;
}

const CURRENCIES = ['USDC', 'XLM', 'EURC', 'BTC', 'ETH'];

export default function DividendPanel({
  userAddress,
  distributions,
  claimHistory,
  yieldSummary,
  isAdmin = false,
  onClaim,
  onClaimAll,
  onCreateDistribution,
  onEstimateGas,
  isLoading = false,
}: DividendPanelProps) {
  const [autoClaim, setAutoClaim] = useState(false);
  const [claimLoading, setClaimLoading] = useState<Record<number, boolean>>({});
  const [gasEstimates, setGasEstimates] = useState<Record<number, { baseFee: string; totalFee: string }>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({
    tokenAddress: '',
    currency: 'USDC',
    amount: '',
    deadlineDays: '30',
  });
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Sort distributions by deadline (closest first) and active status
  const sortedDistributions = useMemo(() => {
    return [...distributions].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return new Date(a.claimDeadline).getTime() - new Date(b.claimDeadline).getTime();
    });
  }, [distributions]);

  const activeDistributions = sortedDistributions.filter(d => d.isActive);
  const pastDistributions = sortedDistributions.filter(d => !d.isActive);

  // Calculate time remaining for countdown
  const getTimeRemaining = (deadline: Date): string => {
    const now = Date.now();
    const diff = new Date(deadline).getTime() - now;

    if (diff <= 0) return 'Expired';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  };

  const getDeadlineUrgency = (deadline: Date): 'critical' | 'warning' | 'normal' => {
    const diff = new Date(deadline).getTime() - Date.now();
    const days = diff / (1000 * 60 * 60 * 24);
    if (days <= 1) return 'critical';
    if (days <= 3) return 'warning';
    return 'normal';
  };

  const handleClaim = async (distributionId: number) => {
    setClaimLoading(prev => ({ ...prev, [distributionId]: true }));
    setClaimError(null);
    setClaimSuccess(null);

    try {
      const result = await onClaim(distributionId);
      setClaimSuccess(`Successfully claimed ${result.amount}!`);
      // Clear success message after 5 seconds
      setTimeout(() => setClaimSuccess(null), 5000);
    } catch (err: any) {
      setClaimError(err.message || 'Failed to claim dividend');
      setTimeout(() => setClaimError(null), 5000);
    } finally {
      setClaimLoading(prev => ({ ...prev, [distributionId]: false }));
    }
  };

  const handleClaimAll = async () => {
    setClaimError(null);
    setClaimSuccess(null);

    if (activeDistributions.length === 0) {
      setClaimError('No active distributions to claim');
      return;
    }

    try {
      const result = await onClaimAll();
      setClaimSuccess(`Successfully claimed ${result.amounts.length} distributions!`);
      setTimeout(() => setClaimSuccess(null), 5000);
    } catch (err: any) {
      setClaimError(err.message || 'Failed to claim dividends');
      setTimeout(() => setClaimError(null), 5000);
    }
  };

  const handleCreateDistribution = async () => {
    if (!onCreateDistribution) return;

    try {
      const deadline = new Date(Date.now() + parseInt(createForm.deadlineDays) * 86400000);
      await onCreateDistribution({
        tokenAddress: createForm.tokenAddress,
        currency: createForm.currency,
        amount: createForm.amount,
        deadline,
      });

      setCreateForm({
        tokenAddress: '',
        currency: 'USDC',
        amount: '',
        deadlineDays: '30',
      });
      setShowCreateForm(false);
    } catch (err: any) {
      setClaimError(err.message || 'Failed to create distribution');
    }
  };

  // Fetch gas estimates for active distributions
  useEffect(() => {
    if (!onEstimateGas || activeDistributions.length === 0) return;

    const fetchEstimates = async () => {
      const estimates: Record<number, { baseFee: string; totalFee: string }> = {};
      for (const dist of activeDistributions) {
        try {
          const est = await onEstimateGas(dist.distributionId);
          estimates[dist.distributionId] = est;
        } catch {
          estimates[dist.distributionId] = { baseFee: '100', totalFee: '100' };
        }
      }
      setGasEstimates(estimates);
    };

    fetchEstimates();
  }, [activeDistributions, onEstimateGas]);

  // Auto-claim effect
  useEffect(() => {
    if (!autoClaim || activeDistributions.length === 0) return;

    const interval = setInterval(async () => {
      for (const dist of activeDistributions) {
        const deadline = new Date(dist.claimDeadline);
        const daysLeft = (deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

        // Auto-claim if less than 1 day remaining
        if (daysLeft <= 1) {
          try {
            await onClaim(dist.distributionId);
          } catch {
            // Silently fail for auto-claim
          }
        }
      }
    }, 3600000); // Check every hour

    return () => clearInterval(interval);
  }, [autoClaim, activeDistributions, onClaim]);

  return (
    <div
      className="max-w-6xl mx-auto space-y-6"
      role="region"
      aria-label="Dividend management panel"
    >
      {/* Yield Summary Cards */}
      <div
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
        role="region"
        aria-label="Dividend yield summary"
      >
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300" id="total-earned-label">
                  Total Earned
                </p>
                <p className="text-2xl font-bold" aria-labelledby="total-earned-label">
                  ${parseFloat(yieldSummary.totalEarned || '0').toLocaleString()}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300" id="pending-label">
                  Pending
                </p>
                <p className="text-2xl font-bold" aria-labelledby="pending-label">
                  ${parseFloat(yieldSummary.pending || '0').toLocaleString()}
                </p>
              </div>
              <Clock className="h-8 w-8 text-yellow-600" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300" id="apy-label">
                  Annualized Yield
                </p>
                <p className="text-2xl font-bold" aria-labelledby="apy-label">
                  {(yieldSummary.annualizedYield || 0).toFixed(2)}%
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Messages */}
      {claimSuccess && (
        <Alert role="status" aria-live="polite">
          <Zap className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{claimSuccess}</AlertDescription>
        </Alert>
      )}
      {claimError && (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertDescription>{claimError}</AlertDescription>
        </Alert>
      )}

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            onClick={handleClaimAll}
            disabled={isLoading || activeDistributions.length === 0}
            aria-label={
              activeDistributions.length === 0
                ? 'No active distributions to claim'
                : `Claim all ${activeDistributions.length} active distributions`
            }
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Processing...
              </>
            ) : (
              <>
                <DollarSign className="mr-2 h-4 w-4" aria-hidden="true" />
                Claim All ({activeDistributions.length})
              </>
            )}
          </Button>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoClaim}
              onChange={(e) => setAutoClaim(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              aria-label="Auto-claim dividends when deadline approaches"
            />
            <span className="text-sm text-gray-600 dark:text-gray-300">Auto-claim</span>
          </label>
        </div>

        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => setShowCreateForm(!showCreateForm)}
            aria-expanded={showCreateForm}
            aria-controls="create-distribution-form"
          >
            <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
            {showCreateForm ? 'Cancel' : 'Create Distribution'}
          </Button>
        )}
      </div>

      {/* Create Distribution Form (Admin) */}
      {showCreateForm && isAdmin && (
        <Card id="create-distribution-form" role="form" aria-label="Create dividend distribution">
          <CardHeader>
            <CardTitle>Create New Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dist-token-address">Token Address</Label>
                <Input
                  id="dist-token-address"
                  value={createForm.tokenAddress}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, tokenAddress: e.target.value }))
                  }
                  placeholder="0x..."
                  aria-required="true"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dist-currency">Currency</Label>
                <Select
                  value={createForm.currency}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({ ...prev, currency: value }))
                  }
                >
                  <SelectTrigger id="dist-currency">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((cur) => (
                      <SelectItem key={cur} value={cur}>
                        {cur}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dist-amount">Amount</Label>
                <Input
                  id="dist-amount"
                  type="number"
                  value={createForm.amount}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, amount: e.target.value }))
                  }
                  placeholder="1000"
                  aria-required="true"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dist-deadline">Deadline (days)</Label>
                <Input
                  id="dist-deadline"
                  type="number"
                  value={createForm.deadlineDays}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, deadlineDays: e.target.value }))
                  }
                  placeholder="30"
                  aria-required="true"
                />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button
                onClick={handleCreateDistribution}
                disabled={!createForm.tokenAddress || !createForm.amount}
                aria-label="Submit new distribution"
              >
                Create Distribution
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="active" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3" role="tablist" aria-label="Distribution tabs">
          <TabsTrigger value="active" role="tab" aria-selected="true">
            Active ({activeDistributions.length})
          </TabsTrigger>
          <TabsTrigger value="history" role="tab">
            History
          </TabsTrigger>
          <TabsTrigger value="past" role="tab">
            Past ({pastDistributions.length})
          </TabsTrigger>
        </TabsList>

        {/* Active Distributions Tab */}
        <TabsContent value="active" className="space-y-4" role="tabpanel" aria-label="Active distributions">
          {activeDistributions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <DollarSign className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" aria-hidden="true" />
                <p className="text-gray-500 dark:text-gray-400">No active distributions</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  Active dividend distributions will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            activeDistributions.map((dist) => {
              const urgency = getDeadlineUrgency(new Date(dist.claimDeadline));
              return (
                <Card
                  key={dist.distributionId}
                  className={`transition-all ${
                    urgency === 'critical' ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30' :
                    urgency === 'warning' ? 'border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30' : ''
                  }`}
                  role="article"
                  aria-label={`Distribution ${dist.distributionId}: ${dist.currency} ${dist.totalAmount}`}
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-lg">
                            Distribution #{dist.distributionId}
                          </h3>
                          <Badge
                            variant={urgency === 'critical' ? 'destructive' :
                              urgency === 'warning' ? 'default' : 'secondary'}
                          >
                            {getTimeRemaining(new Date(dist.claimDeadline))}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Currency</p>
                            <p className="font-medium">{dist.currency}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Total Amount</p>
                            <p className="font-medium">
                              {parseFloat(dist.totalAmount).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Per Token</p>
                            <p className="font-medium">{parseFloat(dist.perTokenAmount).toFixed(6)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 dark:text-gray-400">Deadline</p>
                            <p className="font-medium">
                              {new Date(dist.claimDeadline).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {gasEstimates[dist.distributionId] && (
                          <span className="text-xs text-gray-500 dark:text-gray-400" aria-label={`Estimated gas fee: ${gasEstimates[dist.distributionId].totalFee} stroops`}>
                            Gas: ~{gasEstimates[dist.distributionId].totalFee} stroops
                          </span>
                        )}
                        <Button
                          onClick={() => handleClaim(dist.distributionId)}
                          disabled={claimLoading[dist.distributionId] || isLoading}
                          aria-label={`Claim dividend for distribution ${dist.distributionId}${gasEstimates[dist.distributionId] ? ', estimated gas: ' + gasEstimates[dist.distributionId].totalFee + ' stroops' : ''}`}
                        >
                          {claimLoading[dist.distributionId] ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                              Claiming...
                            </>
                          ) : (
                            <>
                              <DollarSign className="mr-2 h-4 w-4" aria-hidden="true" />
                              Claim
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Claim History Tab */}
        <TabsContent value="history" className="space-y-4" role="tabpanel" aria-label="Claim history">
          {claimHistory.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <History className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" aria-hidden="true" />
                <p className="text-gray-500 dark:text-gray-400">No claim history</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  Your dividend claim history will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full" role="table" aria-label="Dividend claim history">
                    <thead>
                      <tr className="text-left text-sm text-gray-600 dark:text-gray-300 border-b dark:border-gray-700">
                        <th className="pb-2 font-medium" scope="col">Date</th>
                        <th className="pb-2 font-medium" scope="col">Distribution</th>
                        <th className="pb-2 font-medium" scope="col">Amount</th>
                        <th className="pb-2 font-medium" scope="col">Currency</th>
                        <th className="pb-2 font-medium" scope="col">Transaction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claimHistory.map((claim, index) => (
                        <tr
                          key={`${claim.distributionId}-${index}`}
                          className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          <td className="py-3">
                            {new Date(claim.date).toLocaleDateString()}
                          </td>
                          <td className="py-3">
                            <Badge variant="outline">#{claim.distributionId}</Badge>
                          </td>
                          <td className="py-3 font-medium">
                            {parseFloat(claim.amount).toLocaleString()}
                          </td>
                          <td className="py-3">{claim.currency}</td>
                          <td className="py-3">
                            <code className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded" title={claim.txHash}>
                              {claim.txHash.slice(0, 8)}...
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Past Distributions Tab */}
        <TabsContent value="past" className="space-y-4" role="tabpanel" aria-label="Past distributions">
          {pastDistributions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <History className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" aria-hidden="true" />
                <p className="text-gray-500">No past distributions</p>
              </CardContent>
            </Card>
          ) : (
            pastDistributions.map((dist) => (
              <Card
                key={dist.distributionId}
                className="opacity-60"
                role="article"
                aria-label={`Past distribution ${dist.distributionId}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">
                          Distribution #{dist.distributionId}
                        </h3>
                        <Badge variant="secondary">Closed</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Currency</p>
                          <p className="font-medium">{dist.currency}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Total Amount</p>
                          <p className="font-medium">
                            {parseFloat(dist.totalAmount).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Closed</p>
                          <p className="font-medium">
                            {new Date(dist.claimDeadline).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
