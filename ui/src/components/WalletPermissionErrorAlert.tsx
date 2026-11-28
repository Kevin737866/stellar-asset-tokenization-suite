'use client';

import React from 'react';
import { ShieldAlert, RefreshCw, X } from 'lucide-react';
import {
  explainWalletPermissionError,
  WalletPermissionErrorExplanation,
} from './walletPermissionErrors';

export interface WalletPermissionErrorAlertProps {
  /** Raw error object or string to classify, or a pre-computed explanation. */
  error?: unknown;
  /** Pre-computed explanation (takes precedence over `error` if provided). */
  explanation?: WalletPermissionErrorExplanation | null;
  /** Optional callback to retry the failed wallet action. */
  onRetry?: () => void;
  /** Label for the retry button. Defaults to "Retry". */
  retryLabel?: string;
  /** Optional callback to dismiss the alert. */
  onDismiss?: () => void;
  /** Optional additional CSS classes. */
  className?: string;
}

/**
 * Displays a clear explanation and numbered actionable recovery steps
 * whenever a Stellar wallet permission or authorization error occurs.
 */
export const WalletPermissionErrorAlert: React.FC<WalletPermissionErrorAlertProps> = ({
  error,
  explanation: providedExplanation,
  onRetry,
  retryLabel = 'Retry',
  onDismiss,
  className = '',
}) => {
  const explanation =
    providedExplanation !== undefined
      ? providedExplanation
      : explainWalletPermissionError(error);

  if (!explanation) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 p-4 text-sm ${className}`.trim()}
    >
      <div className="flex items-start gap-3">
        <ShieldAlert
          className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-amber-900 dark:text-amber-100">
            {explanation.title}
          </h4>
          <p className="mt-1 text-amber-800 dark:text-amber-200">
            {explanation.message}
          </p>

          {explanation.recoverySteps.length > 0 && (
            <div className="mt-3">
              <p className="font-medium text-amber-900 dark:text-amber-100 text-xs uppercase tracking-wide">
                How to fix this
              </p>
              <ol
                className="mt-1.5 list-decimal list-inside space-y-1 text-amber-800 dark:text-amber-200"
                aria-label="Recovery steps"
              >
                {explanation.recoverySteps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {onRetry && explanation.retryable && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {retryLabel}
            </button>
          )}
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss wallet permission error"
            className="shrink-0 rounded-full p-1 text-amber-700 dark:text-amber-300 hover:bg-amber-200/60 dark:hover:bg-amber-800/60 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

export default WalletPermissionErrorAlert;
