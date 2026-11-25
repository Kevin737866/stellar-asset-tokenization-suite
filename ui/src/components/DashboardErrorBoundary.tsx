'use client';

import React from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Categories of dashboard data failures.
 *
 * - `network`   : transient connectivity or fetch failure — safe to retry.
 * - `auth`      : authorization/KYC failure — retrying will not help without
 *                 user action.
 * - `recoverable`: any other non-fatal failure (timeout, rate-limit, partial
 *                 data) — safe to retry.
 * - `fatal`     : logic/rendering error from which the boundary cannot recover
 *                 without a full page reload.
 */
export type DashboardErrorKind = 'network' | 'auth' | 'recoverable' | 'fatal';

/** Classifies an error value into a {@link DashboardErrorKind}. */
export function classifyError(error: unknown): DashboardErrorKind {
  if (!error) return 'recoverable';

  const code = (error as any)?.code as string | undefined;
  const message = ((error as any)?.message ?? '') as string;

  // Authorization / compliance — retrying will not help
  if (
    code === 'TX_BAD_AUTH' ||
    code === 'COMPLIANCE_FAILED' ||
    code === 'KYC_NOT_VERIFIED' ||
    code === 'BLACKLISTED'
  ) {
    return 'auth';
  }

  // Network / connectivity
  if (
    code === 'NETWORK_ERROR' ||
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('fetch') ||
    message.toLowerCase().includes('timeout') ||
    message.toLowerCase().includes('econnrefused') ||
    message.toLowerCase().includes('failed to fetch')
  ) {
    return 'network';
  }

  // React render-phase errors surfaced by the Error Boundary
  // (these arrive without a `code` and typically have a component stack)
  if ((error as any)?._reactComponentStack !== undefined) {
    return 'fatal';
  }

  return 'recoverable';
}

/** Returns `true` for error kinds that the boundary can recover from via retry. */
export function isRecoverableError(kind: DashboardErrorKind): boolean {
  return kind === 'network' || kind === 'recoverable';
}

// ---------------------------------------------------------------------------
// Props & State
// ---------------------------------------------------------------------------

export interface DashboardErrorBoundaryProps {
  /** Content to render when no error is present. */
  children: React.ReactNode;

  /**
   * Optional callback invoked when the user clicks "Retry".
   * Use this to re-fetch dashboard data from the parent.
   */
  onRetry?: () => void;

  /**
   * Optional fallback to render instead of the built-in error UI.
   * Receives the error, its kind, and a `retry` function.
   */
  fallback?: (
    error: unknown,
    kind: DashboardErrorKind,
    retry: () => void
  ) => React.ReactNode;

  /** Optional label shown in the error panel heading (default: "Dashboard"). */
  label?: string;
}

interface DashboardErrorBoundaryState {
  error: unknown;
  errorKind: DashboardErrorKind;
  /** Incremented on every retry to force child tree remount. */
  retryCount: number;
}

// ---------------------------------------------------------------------------
// DashboardErrorBoundary
// ---------------------------------------------------------------------------

/**
 * React Error Boundary for dashboard panels.
 *
 * Catches render-phase errors thrown by any descendant component and presents
 * a contextual recovery UI.  Network and other transient failures expose a
 * "Retry" button that resets the error state (and optionally calls `onRetry`
 * to re-trigger data fetching in the parent).  Authorization failures display
 * a non-retryable message.  Fatal render errors offer a full-page reload.
 *
 * Usage:
 * ```tsx
 * <DashboardErrorBoundary onRetry={refetchPortfolio} label="Ownership">
 *   <OwnershipDashboard ... />
 * </DashboardErrorBoundary>
 * ```
 */
export class DashboardErrorBoundary extends React.Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  constructor(props: DashboardErrorBoundaryProps) {
    super(props);
    this.state = { error: null, errorKind: 'recoverable', retryCount: 0 };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(
    error: unknown
  ): Partial<DashboardErrorBoundaryState> {
    const kind = classifyError(error);
    return { error, errorKind: kind };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // Attach the component stack to the error object so classifyError can
    // distinguish render-phase errors from data errors in future calls.
    if (error && typeof error === 'object') {
      (error as any)._reactComponentStack = info.componentStack;
    }
    // Re-classify now that the stack is attached
    const kind = classifyError(error);
    if (kind !== this.state.errorKind) {
      this.setState({ errorKind: kind });
    }
  }

  /**
   * Resets the boundary so the child tree can remount.
   * Calls `props.onRetry` after the state update so the parent can refetch.
   */
  handleRetry(): void {
    const { onRetry } = this.props;
    this.setState(
      (prev) => ({ error: null, errorKind: 'recoverable', retryCount: prev.retryCount + 1 }),
      () => {
        onRetry?.();
      }
    );
  }

  render(): React.ReactNode {
    const { error, errorKind, retryCount } = this.state;
    const { children, fallback, label = 'Dashboard' } = this.props;

    if (error !== null) {
      if (fallback) {
        return fallback(error, errorKind, this.handleRetry);
      }
      return (
        <DefaultErrorFallback
          error={error}
          kind={errorKind}
          label={label}
          onRetry={this.handleRetry}
        />
      );
    }

    // Key on retryCount forces a full remount of the subtree after a retry,
    // clearing any stale local state in child components.
    return (
      <React.Fragment key={retryCount}>
        {children}
      </React.Fragment>
    );
  }
}

// ---------------------------------------------------------------------------
// Default fallback UI
// ---------------------------------------------------------------------------

interface DefaultErrorFallbackProps {
  error: unknown;
  kind: DashboardErrorKind;
  label: string;
  onRetry: () => void;
}

function DefaultErrorFallback({
  error,
  kind,
  label,
  onRetry,
}: DefaultErrorFallbackProps): React.ReactElement {
  const recoverable = isRecoverableError(kind);
  const isNetwork = kind === 'network';

  const message = (() => {
    if (isNetwork) {
      return 'Unable to connect to the Stellar network. Check your internet connection and try again.';
    }
    if (kind === 'auth') {
      return 'Your account does not have permission to view this data. Please complete KYC verification or contact support.';
    }
    if (kind === 'fatal') {
      return 'A rendering error occurred. Please reload the page.';
    }
    const rawMessage = (error as any)?.message;
    return typeof rawMessage === 'string' && rawMessage.length > 0
      ? rawMessage
      : 'An unexpected error occurred while loading dashboard data.';
  })();

  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-6 text-center"
      role="alert"
      aria-live="assertive"
      data-testid="dashboard-error-boundary"
    >
      {/* Icon */}
      <div
        className={`h-16 w-16 rounded-full flex items-center justify-center mb-4 ${
          isNetwork
            ? 'bg-orange-100 dark:bg-orange-900'
            : kind === 'auth'
            ? 'bg-yellow-100 dark:bg-yellow-900'
            : 'bg-red-100 dark:bg-red-900'
        }`}
      >
        {isNetwork ? (
          <WifiOff
            className="h-7 w-7 text-orange-600 dark:text-orange-400"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className={`h-7 w-7 ${
              kind === 'auth'
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-600 dark:text-red-400'
            }`}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Heading */}
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {isNetwork
          ? 'Connection Error'
          : kind === 'auth'
          ? 'Access Denied'
          : kind === 'fatal'
          ? 'Rendering Error'
          : `Failed to Load ${label} Data`}
      </h3>

      {/* Description */}
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md">{message}</p>

      {/* Actions */}
      {recoverable && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="retry-button"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          aria-label={`Retry loading ${label} data`}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      )}

      {kind === 'fatal' && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          data-testid="reload-button"
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          Reload Page
        </button>
      )}
    </div>
  );
}

export default DashboardErrorBoundary;
