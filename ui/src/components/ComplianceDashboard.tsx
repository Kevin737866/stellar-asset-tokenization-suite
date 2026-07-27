'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { StellarRWASDK } from '../../sdk/src';
import { Address } from '../../sdk/src';
import { KYCStatus, VerificationLevel, TransferLimits } from '../../sdk/src/types';
import { useToast, useErrorTranslator } from './Toast';

interface ComplianceDashboardProps {
  sdk: StellarRWASDK;
  userAddress: string;
}

const VERIFICATION_LABELS: Record<number, string> = {
  [VerificationLevel.BASIC]: 'Basic',
  [VerificationLevel.ENHANCED]: 'Enhanced',
  [VerificationLevel.INSTITUTIONAL]: 'Institutional',
};

const VERIFICATION_COLORS: Record<number, string> = {
  [VerificationLevel.BASIC]: 'bg-blue-100 text-blue-800',
  [VerificationLevel.ENHANCED]: 'bg-purple-100 text-purple-800',
  [VerificationLevel.INSTITUTIONAL]: 'bg-amber-100 text-amber-800',
};

function getExpiryCountdown(expiryDate: Date): string {
  const now = Date.now();
  const exp = expiryDate instanceof Date ? expiryDate.getTime() : new Date(expiryDate).getTime();
  const diff = exp - now;
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function getRiskScoreColor(score: number): string {
  if (score >= 4) return 'text-green-600';
  if (score >= 3) return 'text-yellow-600';
  return 'text-red-600';
}

function ProgressBar({ used, total, color }: { used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return (
    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ComplianceDashboard({ sdk, userAddress }: ComplianceDashboardProps) {
  const toast = useToast();
  const translateError = useErrorTranslator();

  const [kycStatus, setKycStatus] = useState<KYCStatus | null>(null);
  const [transferLimits, setTransferLimits] = useState<TransferLimits | null>(null);
  const [isBlacklisted, setIsBlacklisted] = useState<boolean>(false);
  const [isWhitelisted, setIsWhitelisted] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTargetAddress, setAdminTargetAddress] = useState('');
  const [adminActionLoading, setAdminActionLoading] = useState(false);

  const fetchData = useCallback(async (showToasts = true) => {
    setFetchError(null);
    setIsLoading(true);
    try {
      const addr = new Address(userAddress);
      const [kyc, limits] = await Promise.allSettled([
        sdk.complianceClient.getKYCStatus(addr),
        sdk.complianceClient.checkTransferLimits(addr, '0').then(() => null).catch(() => null),
      ]);

      if (kyc.status === 'fulfilled') {
        setKycStatus(kyc.value);
      } else {
        setKycStatus(null);
      }

      if (limits.status === 'fulfilled' && limits.value) {
        setTransferLimits(limits.value as unknown as TransferLimits);
      }
    } catch (err: any) {
      const { title, message } = translateError(err);
      setFetchError(message);
      if (showToasts) {
        toast.error(title, message, () => fetchData(true));
      }
    } finally {
      setIsLoading(false);
    }
  }, [sdk, userAddress, toast, translateError]);

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  const handleAdminAction = async (action: string, reason?: string) => {
    const target = adminTargetAddress || userAddress;
    if (!target) {
      toast.warning('Missing Address', 'Please enter a target address.');
      return;
    }
    setAdminActionLoading(true);
    try {
      const addr = new Address(target);
      const adminAddr = new Address(userAddress);
      switch (action) {
        case 'blacklist':
          await sdk.complianceClient.addToBlacklist(adminAddr, addr, reason || 'Admin action');
          toast.success('Blacklisted', `${target} has been blacklisted.`);
          break;
        case 'unblacklist':
          await sdk.complianceClient.removeFromBlacklist(adminAddr, addr);
          toast.success('Unblacklisted', `${target} has been removed from blacklist.`);
          break;
        case 'whitelist':
          await sdk.complianceClient.addToWhitelist(adminAddr, addr);
          toast.success('Whitelisted', `${target} has been whitelisted.`);
          break;
        case 'unwhitelist':
          await sdk.complianceClient.removeFromWhitelist(adminAddr, addr);
          toast.success('Unwhitelisted', `${target} has been removed from whitelist.`);
          break;
      }
      fetchData(false);
    } catch (err: any) {
      const { title, message } = translateError(err);
      toast.error(title, message);
    } finally {
      setAdminActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 animate-pulse rounded w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="h-48 bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (fetchError && !kycStatus) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <span className="text-2xl">⚠</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Failed to Load Compliance Data</h3>
        <p className="text-gray-500 mb-4 max-w-md">{fetchError}</p>
        <button
          onClick={() => fetchData(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Compliance Dashboard</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="rounded border-gray-300"
            />
            Admin Mode
          </label>
          <button
            onClick={() => fetchData(true)}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">KYC Status</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                kycStatus?.isVerified
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}>
                {kycStatus?.isVerified ? 'Verified' : 'Unverified'}
              </span>
              {kycStatus?.verificationLevel != null && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  VERIFICATION_COLORS[kycStatus.verificationLevel] || 'bg-gray-100 text-gray-800'
                }`}>
                  {VERIFICATION_LABELS[kycStatus.verificationLevel] || 'Unknown'}
                </span>
              )}
            </div>
            {kycStatus?.expiryDate && (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                <span className="text-gray-500">Expires in: </span>
                <span className="font-medium">{getExpiryCountdown(kycStatus.expiryDate)}</span>
              </div>
            )}
            {kycStatus?.jurisdiction && (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                <span className="text-gray-500">Jurisdiction: </span>
                <span className="font-medium">{kycStatus.jurisdiction}</span>
              </div>
            )}
            {kycStatus?.riskScore != null && (
              <div className="text-sm text-gray-600 dark:text-gray-300">
                <span className="text-gray-500">Risk Score: </span>
                <span className={`font-bold ${getRiskScoreColor(kycStatus.riskScore)}`}>
                  {kycStatus.riskScore}/5
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Transfer Limits</h2>
          {transferLimits ? (
            <div className="space-y-4">
              {([
                { label: 'Daily', used: parseFloat(transferLimits.remainingDaily || '0'), total: parseFloat(transferLimits.dailyLimit || '0'), reset: transferLimits.lastResetDaily },
                { label: 'Monthly', used: parseFloat(transferLimits.remainingMonthly || '0'), total: parseFloat(transferLimits.monthlyLimit || '0'), reset: transferLimits.lastResetMonthly },
                { label: 'Annual', used: parseFloat(transferLimits.remainingAnnual || '0'), total: parseFloat(transferLimits.annualLimit || '0'), reset: transferLimits.lastResetAnnual },
              ] as const).map((item) => {
                const spent = item.total - item.used;
                return (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 dark:text-gray-300">{item.label}</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {spent.toLocaleString()} / {item.total.toLocaleString()}
                      </span>
                    </div>
                    <ProgressBar used={spent} total={item.total} color={spent / item.total > 0.8 ? 'bg-red-500' : 'bg-blue-500'} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">No transfer limits configured</p>
          )}
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Status Indicators</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">Accredited Investor</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                kycStatus?.isAccredited ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
              }`}>
                {kycStatus?.isAccredited ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">Blacklisted</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                isBlacklisted ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
              }`}>
                {isBlacklisted ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-300">Whitelisted</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                isWhitelisted ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
              }`}>
                {isWhitelisted ? 'Yes' : 'No'}
              </span>
            </div>
            {kycStatus?.amlFlags && kycStatus.amlFlags.length > 0 && (
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-300 block mb-1">AML Flags</span>
                <div className="flex flex-wrap gap-1">
                  {kycStatus.amlFlags.map((flag, i) => (
                    <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                      {flag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(!kycStatus?.amlFlags || kycStatus.amlFlags.length === 0) && (
              <div className="text-sm text-gray-500 italic">No AML flags</div>
            )}
          </div>
        </section>
      </div>

      {isAdmin && (
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">Admin Controls</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Address</label>
              <input
                type="text"
                value={adminTargetAddress}
                onChange={(e) => setAdminTargetAddress(e.target.value)}
                placeholder={userAddress}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleAdminAction('blacklist')}
                disabled={adminActionLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {adminActionLoading ? 'Processing...' : 'Blacklist'}
              </button>
              <button
                onClick={() => handleAdminAction('unblacklist')}
                disabled={adminActionLoading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {adminActionLoading ? 'Processing...' : 'Remove from Blacklist'}
              </button>
              <button
                onClick={() => handleAdminAction('whitelist')}
                disabled={adminActionLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {adminActionLoading ? 'Processing...' : 'Whitelist'}
              </button>
              <button
                onClick={() => handleAdminAction('unwhitelist')}
                disabled={adminActionLoading}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {adminActionLoading ? 'Processing...' : 'Remove from Whitelist'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
