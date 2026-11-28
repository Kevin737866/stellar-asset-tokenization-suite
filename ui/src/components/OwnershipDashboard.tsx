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
import {
  DashboardState,
  getDashboardState,
  toSafeNumber,
  validateDashboardPortfolio,
} from './dashboardData';

/**
 * Ownership dashboard: portfolio overview, holdings, dividends and voting.
 *
 * Data requirements (see `dashboardData.ts` and `docs/ui-dashboard.md`):
 * - `userAddress` is the connected Stellar wallet address (`G...`).
 *   Display-only: this component never signs, sends, or moves funds.
 * - `portfolio` is the connected wallet's portfolio: an `assets` array
 *   plus `totalValue`, `totalDividends` and `votingPower` as non-negative
 *   decimal strings. A valid portfolio with zero holdings renders the
 *   empty state; a portfolio that fails validation renders the invalid
 *   state with its problems listed.
 *
 * Authorization: the parent MUST pass the connected wallet's own portfolio
 * and MUST verify in its callbacks that the signer matches `userAddress`
 * before submitting anything on-chain. The callbacks are optional — when
 * one is absent, that action is unavailable (no fallback transaction).
 *
 * Failure semantics: invalid numeric strings render as 0 (never `NaN`);
 * a failed lock / unlock / claim leaves the displayed portfolio unchanged
 * (form inputs are only cleared on success); network errors surface via
 * the banner and a retryable toast.
 */
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Loading states for operations
  const [isLocking, setIsLocking] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState<string | null>(null);

  // Error states
  const [lockError, setLockError] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<Record<string, string>>({});
  const [claimError, setClaimError] = useState<Record<string, string>>({});
  const [isNetworkError, setIsNetworkError] = useState(false);

  // Display state: loading skeletons are returned early below; the empty
  // and invalid states render in place of the tabbed sections so the
  // dashboard never shows blank charts for a wallet with no holdings.
  const dashboardState: DashboardState = getDashboardState(portfolio, isLoading);
  const validationProblems =
    dashboardState === 'invalid' ? validateDashboardPortfolio(portfolio).problems : [];

  // Defensive read: a malformed portfolio never crashes the dashboard.
  // Validation problems are surfaced by the invalid state above.
  const holdings: AssetHolding[] = Array.isArray(portfolio?.assets) ? portfolio.assets : [];

  // Prepare data for charts (invalid numbers render as 0, never NaN).
  const pieChartData = holdings.map((holding) => ({
    name: holding.asset.name,
    value: toSafeNumber(holding.value),
    percentage: holding.percentage,
  }));

  const barChartData = holdings.map((holding) => ({
    name: holding.asset.symbol,
    balance: toSafeNumber(holding.balance.amount),
    value: toSafeNumber(holding.value),
    dividends: toSafeNumber(holding.dividends),
  }));

  const totalValue = toSafeNumber(portfolio?.totalValue);
  const totalDividends = toSafeNumber(portfolio?.totalDividends);
  const totalVotingPower = toSafeNumber(portfolio?.votingPower);

  const handleLockTokens = async () => {
    if (!selectedAsset || !lockAmount || !lockPeriod) return;

    // Inline validation
    const amount = toSafeNumber(lockAmount);
    const maxAmount = toSafeNumber(selectedAsset.balance.amount);
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

    const assetAddress = String(selectedAsset.asset.tokenAddress);
    setLockError(null);
    setIsLocking(true);
    setIsNetworkError(false);

    try {
      await onLockTokens?.(assetAddress, lockAmount, period);

      toast.success(
        'Tokens Locked',
        `Successfully locked ${toSafeNumber(lockAmount).toLocaleString()} tokens for ${period} days.`
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
        `Successfully unlocked ${toSafeNumber(amount).toLocaleString()} tokens.`
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
                <div className="h-16 bg-gray-200 dark:bg-gray-700 animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-80 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg" />
          <div className="h-80 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg" />
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
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        role="region"
        aria-label="Portfolio overview"
      >
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300" id="total-value-label">Total Portfolio Value</p>
                <p
                  className="text-2xl font-bold"
                  aria-labelledby="total-value-label"
                >
                  ${totalValue.toLocaleString()}
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
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300" id="total-dividends-label">Total Dividends</p>
                <p
                  className="text-2xl font-bold"
                  aria-labelledby="total-dividends-label"
                >
                  ${totalDividends.toLocaleString()}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300" id="voting-power-label">Voting Power</p>
                <p
                  className="text-2xl font-bold"
                  aria-labelledby="voting-power-label"
                >
                  {totalVotingPower.toLocaleString()}
                </p>
              </div>
              <Vote className="h-8 w-8 text-purple-600" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300" id="assets-held-label">Assets Held</p>
                <p
                  className="text-2xl font-bold"
                  aria-labelledby="assets-held-label"
                >
                  {holdings.length}
                </p>
              </div>
              <Wallet className="h-8 w-8 text-orange-600" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Empty / invalid states replace the tabbed sections: the overview
          cards above stay visible because $0 totals are accurate for an
          empty wallet, but blank charts and empty lists are never shown. */}
      {dashboardState !== 'ready' ? (
        <Card>
          <CardContent className="p-8 text-center">
            {dashboardState === 'invalid' ? (
              <>
                <AlertCircle className="h-12 w-12 mx-auto text-red-400 mb-4" aria-hidden="true" />
                <p className="text-lg font-medium">Dashboard data couldn&apos;t be read</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  The portfolio data for this wallet failed validation, so totals are shown as $0 and
                  no actions are offered. Ask the data provider to fix the fields below.
                </p>
                <ul className="text-sm text-left text-red-500 dark:text-red-400 mt-4 space-y-1 max-w-lg mx-auto">
                  {validationProblems.map((problem) => (
                    <li key={problem} className="flex items-start gap-1">
                      <AlertCircle className="h-3 w-3 mt-1 shrink-0" aria-hidden="true" />
                      <span>{problem}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <Wallet className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" aria-hidden="true" />
                <p className="text-lg font-medium">No assets yet</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  This wallet holds no tokenized assets, so there is nothing to chart yet.
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  The dashboard needs the connected wallet&apos;s portfolio: its holdings (asset name,
                  symbol and token address, balance, value, dividends) plus total value, total
                  dividends and voting power. Once the wallet holds an asset, the overview charts,
                  holdings, dividends and voting sections appear here automatically.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4" role="tablist" aria-label="Dashboard sections">
          <TabsTrigger value="overview" role="tab" aria-selected="true">Overview</TabsTrigger>
          <TabsTrigger value="assets" role="tab">Assets</TabsTrigger>
          <TabsTrigger value="dividends" role="tab">Dividends</TabsTrigger>
          <TabsTrigger value="voting" role="tab">Voting</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6" role="tabpanel" aria-label="Overview tab">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Portfolio Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5" aria-hidden="true" />
                  Portfolio Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  role="img"
                  aria-label={`Pie chart showing portfolio distribution across ${pieChartData.length} assets`}
                >
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
                </div>
              </CardContent>
            </Card>

            {/* Asset Performance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" aria-hidden="true" />
                  Asset Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  role="img"
                  aria-label={`Bar chart showing asset performance for ${barChartData.length} assets`}
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={barChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(value) => `$${Number(value).toLocaleString()}`} />
                      <Bar dataKey="value" fill="#8884d8" name="Value" />
                      <Bar dataKey="dividends" fill="#82ca9d" name="Dividends" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Assets Tab */}
        <TabsContent value="assets" className="space-y-6" role="tabpanel" aria-label="Assets tab">
          <div className="grid grid-cols-1 gap-4" role="list" aria-label="Asset holdings">
            {holdings.map((holding, index) => (
              <Card
                key={index}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => setSelectedAsset(holding)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center" aria-hidden="true">
                          {holding.asset.assetType === 'real_estate' && <Building2 className="h-5 w-5" />}
                          {holding.asset.assetType === 'commodity' && <Package className="h-5 w-5" />}
                          {(holding.asset.assetType === 'invoice' || holding.asset.assetType === 'security') && (
                            <DollarSign className="h-5 w-5" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{holding.asset.name}</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-300">{holding.asset.symbol}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Balance</p>
                          <p className="font-medium">
                            {toSafeNumber(holding.balance.amount).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Value</p>
                          <p className="font-medium">
                            ${toSafeNumber(holding.value).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Dividends</p>
                          <p className="font-medium">
                            ${toSafeNumber(holding.dividends).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Percentage</p>
                          <p className="font-medium">{holding.percentage.toFixed(2)}%</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-4">
                        <Badge
                          variant={holding.balance.lockedAmount === '0' ? 'secondary' : 'default'}
                        >
                          {holding.balance.lockedAmount === '0'
                            ? 'Unlocked'
                            : `${toSafeNumber(holding.balance.lockedAmount).toLocaleString()} Locked`}
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

        {/* Dividends Tab */}
        <TabsContent value="dividends" className="space-y-6" role="tabpanel" aria-label="Dividends tab">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" aria-hidden="true" />
                Dividend Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <span className="font-medium">Total Dividends Earned</span>
                  <span className="text-2xl font-bold text-green-600 dark:text-green-400">
                    ${totalDividends.toLocaleString()}
                  </span>
                </div>

                <div className="space-y-2">
                  {holdings.map((holding, index) => {
                    const addr = String(holding.asset.tokenAddress);
                    const isClaimInProgress = isClaiming === addr;
                    const errorMsg = claimError[addr];
                    return (
                      <div key={index}>
                        <div className="flex justify-between items-center p-3 border dark:border-gray-700 rounded">
                          <div>
                            <p className="font-medium">{holding.asset.name}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-300">{holding.asset.symbol}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">
                              ${toSafeNumber(holding.dividends).toLocaleString()}
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
                          <p className="text-sm text-red-500 dark:text-red-400 mt-1 flex items-center gap-1">
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

        {/* Voting Tab */}
        <TabsContent value="voting" className="space-y-6" role="tabpanel" aria-label="Voting tab">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-5 w-5" aria-hidden="true" />
                Voting Power & Token Locking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="text-center p-6 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">Total Voting Power</p>
                  <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                    {totalVotingPower.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {totalValue > 0
                      ? ((totalVotingPower / totalValue) * 100).toFixed(2)
                      : 0}% of portfolio
                  </p>
                </div>

                {selectedAsset && (
                  <div
                    className="space-y-4 p-4 border rounded-lg"
                    role="form"
                    aria-label={`Lock tokens for ${selectedAsset.asset.name}`}
                  >
                    <h4 className="font-medium">Lock Tokens for {selectedAsset.asset.name}</h4>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="lock-amount" className="text-sm font-medium">Amount</label>
                        <input
                          id="lock-amount"
                          type="number"
                          value={lockAmount}
                          onChange={(e) => {
                            setLockAmount(e.target.value);
                            if (lockError) setLockError(null);
                          }}
                          placeholder="Amount to lock"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          aria-required="true"
                        />
                      </div>
                      <div>
                        <label htmlFor="lock-period" className="text-sm font-medium">Lock Period (days)</label>
                        <input
                          id="lock-period"
                          type="number"
                          value={lockPeriod}
                          onChange={(e) => {
                            setLockPeriod(e.target.value);
                            if (lockError) setLockError(null);
                          }}
                          placeholder="Lock period"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                          aria-required="true"
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

                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      Available: {selectedAsset.balance.amount} | Locked:{' '}
                      {selectedAsset.balance.lockedAmount} | Voting Power:{' '}
                      {selectedAsset.balance.votingPower}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {holdings.map((holding, index) => {
                    const addr = String(holding.asset.tokenAddress);
                    const isUnlockInProgress = isUnlocking === addr;
                    const errorMsg = unlockError[addr];
                    return (
                      <div key={index}>
                        <div className="flex justify-between items-center p-3 border dark:border-gray-700 rounded">
                          <div>
                            <p className="font-medium">{holding.asset.name}</p>
                            <p className="text-sm text-gray-600">
                              Locked: {holding.balance.lockedAmount} | Voting: {holding.balance.votingPower}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            {toSafeNumber(holding.balance.lockedAmount) > 0 && (
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
                          <p className="text-sm text-red-500 dark:text-red-400 mt-1 flex items-center gap-1">
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
      )}
    </div>
  );
}
