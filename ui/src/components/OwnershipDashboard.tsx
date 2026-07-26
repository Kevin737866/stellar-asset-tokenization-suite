'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Wallet,
  TrendingUp,
  PieChart as PieChartIcon,
  Vote,
  Lock,
  DollarSign,
  Building2,
  Package,
  Loader2,
  RefreshCw,
  AlertCircle,
  WifiOff,
} from 'lucide-react';
import { AssetInfo, Balance, AssetHolding, Portfolio } from '@/lib/types';
import { useToast, useErrorTranslator } from '@/components/Toast';

interface OwnershipDashboardProps {
  userAddress: string;
  portfolio: Portfolio;
  onLockTokens?: (assetAddress: string, amount: string, lockPeriod: number) => Promise<void>;
  onUnlockTokens?: (assetAddress: string, amount: string) => Promise<void>;
  onClaimDividends?: (assetAddress: string, distributionId: number) => Promise<void>;
  isLoading?: boolean;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

export default function OwnershipDashboard({
  userAddress,
  portfolio,
  onLockTokens,
  onUnlockTokens,
  onClaimDividends,
  isLoading = false,
}: OwnershipDashboardProps) {
  const toast = useToast();
  const translateError = useErrorTranslator();

  const [selectedAsset, setSelectedAsset] = useState<AssetHolding | null>(null);
  const [lockAmount, setLockAmount] = useState('');
  const [lockPeriod, setLockPeriod] = useState('');

  // Loading states for operations
  const [isLocking, setIsLocking] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState<string | null>(null);

  // Error states
  const [lockError, setLockError] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<Record<string, string>>({});
  const [claimError, setClaimError] = useState<Record<string, string>>({});
  const [isNetworkError, setIsNetworkError] = useState(false);

  // Prepare data for charts
  const pieChartData = portfolio.assets.map((holding) => ({
    name: holding.asset.name,
    value: parseFloat(holding.value),
    percentage: holding.percentage,
  }));

  const barChartData = portfolio.assets.map((holding) => ({
    name: holding.asset.symbol,
    balance: parseFloat(holding.balance.amount),
    value: parseFloat(holding.value),
    dividends: parseFloat(holding.dividends),
  }));

  const totalValue = parseFloat(portfolio.totalValue);
  const totalDividends = parseFloat(portfolio.totalDividends);
  const totalVotingPower = parseFloat(portfolio.votingPower);

  const handleLockTokens = async () => {
    if (!selectedAsset || !lockAmount || !lockPeriod) return;

    // Inline validation
    const amount = parseFloat(lockAmount);
    const maxAmount = parseFloat(selectedAsset.balance.amount);
    if (isNaN(amount) || amount <= 0) {
      setLockError('Amount must be a positive number');
      return;
    }
    if (amount > maxAmount) {
      setLockError(`Cannot lock more than your available balance (${maxAmount.toLocaleString()})`);
      return;
    }
    const period = parseInt(lockPeriod);
    if (isNaN(period) || period <= 0) {
      setLockError('Lock period must be a positive number of days');
      return;
    }

    const assetAddress = selectedAsset.asset.tokenAddress;
    setLockError(null);
    setIsLocking(true);
    setIsNetworkError(false);

    try {
      await onLockTokens?.(assetAddress, lockAmount, period);

      toast.success(
        'Tokens Locked',
        `Successfully locked ${parseFloat(lockAmount).toLocaleString()} tokens for ${period} days.`
      );
      setLockAmount('');
      setLockPeriod('');
      setLockError(null);
    } catch (error: any) {
      const { title, message } = translateError(error);

      if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('fetch') || error?.message?.includes('Network')) {
        setIsNetworkError(true);
      }

      setLockError(message);
      toast.error(title, message, () => handleLockTokens());
    } finally {
      setIsLocking(false);
    }
  };

  const handleUnlockTokens = async (assetAddress: string, amount: string) => {
    setIsUnlocking(assetAddress);
    setUnlockError((prev) => ({ ...prev, [assetAddress]: '' }));
    setIsNetworkError(false);

    try {
      await onUnlockTokens?.(assetAddress, amount);

      toast.success(
        'Tokens Unlocked',
        `Successfully unlocked ${parseFloat(amount).toLocaleString()} tokens.`
      );
      setUnlockError((prev) => {
        const next = { ...prev };
        delete next[assetAddress];
        return next;
      });
    } catch (error: any) {
      const { title, message } = translateError(error);

      if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('fetch') || error?.message?.includes('Network')) {
        setIsNetworkError(true);
      }

      setUnlockError((prev) => ({ ...prev, [assetAddress]: message }));
      toast.error(title, message, () => handleUnlockTokens(assetAddress, amount));
    } finally {
      setIsUnlocking(null);
    }
  };

  const handleClaimDividends = async (assetAddress: string, distributionId: number) => {
    setIsClaiming(assetAddress);
    setClaimError((prev) => ({ ...prev, [assetAddress]: '' }));
    setIsNetworkError(false);

    try {
      await onClaimDividends?.(assetAddress, distributionId);

      toast.success(
        'Dividends Claimed',
        'Your dividend rewards have been successfully claimed!'
      );
      setClaimError((prev) => {
        const next = { ...prev };
        delete next[assetAddress];
        return next;
      });
    } catch (error: any) {
      const { title, message } = translateError(error);

      if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('fetch') || error?.message?.includes('Network')) {
        setIsNetworkError(true);
      }

      setClaimError((prev) => ({ ...prev, [assetAddress]: message }));
      toast.error(title, message, () => handleClaimDividends(assetAddress, distributionId));
    } finally {
      setIsClaiming(null);
    }
  };

  // Initial loading state
  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-16 bg-gray-200 animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 bg-gray-100 animate-pulse rounded-lg" />
          <div className="h-80 bg-gray-100 animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Network Error Banner */}
      {isNetworkError && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertDescription>
            Network connection error. Please check your connection to the Stellar network and try again.
          </AlertDescription>
        </Alert>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Portfolio Value</p>
                <p className="text-2xl font-bold">${totalValue.toLocaleString()}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Dividends</p>
                <p className="text-2xl font-bold">${totalDividends.toLocaleString()}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Voting Power</p>
                <p className="text-2xl font-bold">{totalVotingPower.toLocaleString()}</p>
              </div>
              <Vote className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Assets Held</p>
                <p className="text-2xl font-bold">{portfolio.assets.length}</p>
              </div>
              <Wallet className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="dividends">Dividends</TabsTrigger>
          <TabsTrigger value="voting">Voting</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Portfolio Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5" />
                  Portfolio Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percentage }) => `${name} ${percentage.toFixed(1)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `$${Number(value).toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Asset Performance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Asset Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value) => `$${Number(value).toLocaleString()}`} />
                    <Bar dataKey="value" fill="#8884d8" />
                    <Bar dataKey="dividends" fill="#82ca9d" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="assets" className="space-y-6">
          <div className="grid grid-cols-1 gap-4">
            {portfolio.assets.map((holding, index) => (
              <Card
                key={index}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => setSelectedAsset(holding)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                          {holding.asset.assetType === 'real_estate' && <Building2 className="h-5 w-5" />}
                          {holding.asset.assetType === 'commodity' && <Package className="h-5 w-5" />}
                          {(holding.asset.assetType === 'invoice' || holding.asset.assetType === 'security') && (
                            <DollarSign className="h-5 w-5" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{holding.asset.name}</h3>
                          <p className="text-sm text-gray-600">{holding.asset.symbol}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div>
                          <p className="text-sm text-gray-600">Balance</p>
                          <p className="font-medium">
                            {parseFloat(holding.balance.amount).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Value</p>
                          <p className="font-medium">
                            ${parseFloat(holding.value).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Dividends</p>
                          <p className="font-medium">
                            ${parseFloat(holding.dividends).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Percentage</p>
                          <p className="font-medium">{holding.percentage.toFixed(2)}%</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-4">
                        <Badge
                          variant={holding.balance.lockedAmount === '0' ? 'secondary' : 'default'}
                        >
                          {holding.balance.lockedAmount === '0'
                            ? 'Unlocked'
                            : `${parseFloat(holding.balance.lockedAmount).toLocaleString()} Locked`}
                        </Badge>
                        <Badge variant="outline">
                          {holding.asset.isPaused ? 'Paused' : 'Active'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="dividends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Dividend Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                  <span className="font-medium">Total Dividends Earned</span>
                  <span className="text-2xl font-bold text-green-600">
                    ${totalDividends.toLocaleString()}
                  </span>
                </div>

                <div className="space-y-2">
                  {portfolio.assets.map((holding, index) => {
                    const addr = holding.asset.tokenAddress;
                    const isClaimInProgress = isClaiming === addr;
                    const errorMsg = claimError[addr];
                    return (
                      <div key={index}>
                        <div className="flex justify-between items-center p-3 border rounded">
                          <div>
                            <p className="font-medium">{holding.asset.name}</p>
                            <p className="text-sm text-gray-600">{holding.asset.symbol}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">
                              ${parseFloat(holding.dividends).toLocaleString()}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isClaimInProgress}
                              onClick={() => handleClaimDividends(addr, 0)}
                            >
                              {isClaimInProgress ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Claiming...
                                </>
                              ) : (
                                'Claim All'
                              )}
                            </Button>
                          </div>
                        </div>
                        {errorMsg && (
                          <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {errorMsg}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="voting" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-5 w-5" />
                Voting Power & Token Locking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="text-center p-6 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-2">Total Voting Power</p>
                  <p className="text-3xl font-bold text-purple-600">
                    {totalVotingPower.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {totalValue > 0
                      ? ((totalVotingPower / totalValue) * 100).toFixed(2)
                      : 0}% of portfolio
                  </p>
                </div>

                {selectedAsset && (
                  <div className="space-y-4 p-4 border rounded-lg">
                    <h4 className="font-medium">Lock Tokens for {selectedAsset.asset.name}</h4>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium">Amount</label>
                        <input
                          type="number"
                          value={lockAmount}
                          onChange={(e) => {
                            setLockAmount(e.target.value);
                            if (lockError) setLockError(null);
                          }}
                          placeholder="Amount to lock"
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Lock Period (days)</label>
                        <input
                          type="number"
                          value={lockPeriod}
                          onChange={(e) => {
                            setLockPeriod(e.target.value);
                            if (lockError) setLockError(null);
                          }}
                          placeholder="Lock period"
                          className="w-full p-2 border rounded"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button onClick={handleLockTokens} disabled={isLocking || !lockAmount || !lockPeriod}>
                          {isLocking ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              Locking...
                            </>
                          ) : (
                            'Lock Tokens'
                          )}
                        </Button>
                      </div>
                    </div>

                    {lockError && (
                      <p className="text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {lockError}
                      </p>
                    )}

                    <div className="text-sm text-gray-600">
                      Available: {selectedAsset.balance.amount} | Locked:{' '}
                      {selectedAsset.balance.lockedAmount} | Voting Power:{' '}
                      {selectedAsset.balance.votingPower}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {portfolio.assets.map((holding, index) => {
                    const addr = holding.asset.tokenAddress;
                    const isUnlockInProgress = isUnlocking === addr;
                    const errorMsg = unlockError[addr];
                    return (
                      <div key={index}>
                        <div className="flex justify-between items-center p-3 border rounded">
                          <div>
                            <p className="font-medium">{holding.asset.name}</p>
                            <p className="text-sm text-gray-600">
                              Locked: {holding.balance.lockedAmount} | Voting: {holding.balance.votingPower}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            {parseFloat(holding.balance.lockedAmount) > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isUnlockInProgress}
                                onClick={() =>
                                  handleUnlockTokens(addr, holding.balance.lockedAmount)
                                }
                              >
                                {isUnlockInProgress ? (
                                  <>
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    Unlocking...
                                  </>
                                ) : (
                                  'Unlock'
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                        {errorMsg && (
                          <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {errorMsg}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
