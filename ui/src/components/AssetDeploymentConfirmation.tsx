'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import {
  DeploymentConfirmationSummary,
  canConfirmDeployment,
} from './deploymentConfirmation';

export interface AssetDeploymentConfirmationProps {
  summary: DeploymentConfirmationSummary;
  acknowledged: boolean;
  onAcknowledgeChange: (acknowledged: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  isLoading?: boolean;
  walletConnected?: boolean;
}

export function AssetDeploymentConfirmation({
  summary,
  acknowledged,
  onAcknowledgeChange,
  onConfirm,
  onCancel,
  isSubmitting = false,
  isLoading = false,
  walletConnected = true,
}: AssetDeploymentConfirmationProps) {
  const gate = canConfirmDeployment(summary, {
    acknowledged,
    isSubmitting,
    isLoading,
    walletConnected,
  });

  const busy = isSubmitting || isLoading;

  return (
    <Card
      role="dialog"
      aria-modal="true"
      aria-labelledby="deployment-confirmation-title"
      className="border-2 border-blue-500/60 shadow-md"
    >
      <CardHeader>
        <CardTitle
          id="deployment-confirmation-title"
          className="flex items-center gap-2 text-lg"
        >
          <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          Confirm Asset Deployment Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Review every parameter below before signing and submitting the deployment transaction to
          the Stellar network.
        </p>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border p-4 bg-gray-50/60 dark:bg-gray-900/40 text-sm">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Asset Name</dt>
            <dd className="font-medium break-words">{summary.options.name}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Asset Symbol</dt>
            <dd className="font-medium">
              <Badge variant="secondary">{summary.options.symbol}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Asset Type</dt>
            <dd className="font-medium">{summary.assetTypeLabel}</dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Total Supply / Decimals</dt>
            <dd className="font-medium">
              {summary.formattedTotalSupply} ({summary.options.decimals} decimals)
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-gray-500 dark:text-gray-400">Compliance Registry Address</dt>
            <dd className="font-mono text-xs break-all mt-0.5">
              {summary.options.complianceRegistry}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-gray-500 dark:text-gray-400">Dividend Distributor Address</dt>
            <dd className="font-mono text-xs break-all mt-0.5">
              {summary.options.dividendDistributor}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-gray-500 dark:text-gray-400">Asset Metadata</dt>
            <dd className="mt-1">
              {summary.metadataEntries.length === 0 ? (
                <span className="text-gray-500 dark:text-gray-400">None</span>
              ) : (
                <ul className="space-y-1">
                  {summary.metadataEntries.map((entry) => (
                    <li key={entry.key} className="font-mono text-xs break-all">
                      <span className="font-semibold">{entry.key}:</span> {entry.value || '(empty)'}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>

        {summary.warnings.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              <ul className="list-disc pl-4 space-y-1 text-sm">
                {summary.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <label className="flex items-start gap-3 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledgeChange(e.target.checked)}
            disabled={busy}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            aria-label="Acknowledge irreversible asset deployment parameters"
          />
          <span>
            I have verified the asset parameters and contract addresses above and understand that
            deploying this token on Stellar is irreversible.
          </span>
        </label>

        {!gate.allowed && gate.reason && !busy && !walletConnected && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {gate.reason}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            Back to Edit
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!gate.allowed}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Deploying...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Confirm &amp; Deploy
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default AssetDeploymentConfirmation;
