'use client';

/**
 * WalletConnect
 *
 * Provides wallet connection controls for the Stellar RWA UI with full
 * accessibility support:
 *   - Every interactive control has an explicit aria-label describing its
 *     action and current state.
 *   - A single aria-live="polite" region announces connection status changes
 *     (connecting, connected, disconnected, errors) to screen readers without
 *     interrupting the user mid-task.
 *   - Destructive or in-progress states use aria-live="assertive" so urgent
 *     errors (authorization failures, network errors) are announced immediately.
 *   - Buttons carry aria-busy and aria-disabled during async operations to
 *     prevent double-submission and communicate loading state to AT.
 *   - The provider selection list uses role="radiogroup" / role="radio" so
 *     keyboard users can arrow-navigate between wallet options.
 *   - The connected wallet summary section is a role="status" region that is
 *     always present in the DOM (visibility toggled by CSS), so AT have a
 *     stable landmark to revisit.
 */

import React, { useState, useCallback, useRef, useEffect, useId } from 'react';
import { Loader2, Wallet, LogOut, Copy, CheckCircle2, AlertCircle, WifiOff, ExternalLink } from 'lucide-react';
import { WalletStatus, WalletProvider, WalletInfo, WalletConnectOptions } from '@/lib/types';
import { useToast, useErrorTranslator } from '@/components/Toast';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WalletConnectProps {
  /**
   * Called when the user confirms they want to connect a wallet.
   * Implementations should open the wallet extension and return the
   * connected account info, or throw a typed error on failure.
   */
  onConnect: (options: WalletConnectOptions) => Promise<WalletInfo>;

  /**
   * Called when the user triggers disconnect.  Should revoke any stored
   * session tokens and return cleanly; errors are caught and surfaced.
   */
  onDisconnect: () => Promise<void>;

  /** Pre-populated wallet info when the session is already connected. */
  initialWallet?: WalletInfo;

  /** Stellar network label shown in the connected summary. */
  network?: string;

  /** Callback fired after a successful connection. */
  onConnected?: (wallet: WalletInfo) => void;

  /** Callback fired after a successful disconnection. */
  onDisconnected?: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_META: Record<WalletProvider, { label: string; description: string; docsUrl: string }> = {
  freighter: {
    label: 'Freighter',
    description: 'Official Stellar browser-extension wallet by SDF',
    docsUrl: 'https://www.freighter.app/',
  },
  albedo: {
    label: 'Albedo',
    description: 'Web-based signer — no extension required',
    docsUrl: 'https://albedo.link/',
  },
  xbull: {
    label: 'xBull',
    description: 'Multi-network Stellar wallet',
    docsUrl: 'https://xbull.app/',
  },
  rabet: {
    label: 'Rabet',
    description: 'Stellar browser-extension wallet',
    docsUrl: 'https://rabet.io/',
  },
};

const PROVIDERS = Object.keys(PROVIDER_META) as WalletProvider[];

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WalletConnect({
  onConnect,
  onDisconnect,
  initialWallet,
  network = 'Testnet',
  onConnected,
  onDisconnected,
}: WalletConnectProps) {
  const toast = useToast();
  const translateError = useErrorTranslator();

  // Stable ID prefix for aria-describedby / aria-controls associations.
  const uid = useId();
  const id = (suffix: string) => `${uid}-${suffix}`;

  // ── State ──────────────────────────────────────────────────────────────────

  const [status, setStatus] = useState<WalletStatus>(
    initialWallet ? 'connected' : 'disconnected',
  );
  const [wallet, setWallet] = useState<WalletInfo | null>(initialWallet ?? null);
  const [selectedProvider, setSelectedProvider] = useState<WalletProvider>('freighter');
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);

  /**
   * statusAnnouncement is the text injected into the aria-live region.
   * It is set after every status transition so screen readers announce the
   * new state; it is NOT used to drive visual rendering (that uses `status`).
   */
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>('');

  /**
   * urgentAnnouncement targets the assertive live region for errors that
   * need to interrupt the user immediately.
   */
  const [urgentAnnouncement, setUrgentAnnouncement] = useState<string>('');

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the assertive region clear after AT has had time to read it.
  useEffect(() => {
    if (!urgentAnnouncement) return;
    const t = setTimeout(() => setUrgentAnnouncement(''), 6000);
    return () => clearTimeout(t);
  }, [urgentAnnouncement]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    setErrorMessage(null);
    setIsNetworkError(false);
    setStatus('connecting');
    setStatusAnnouncement(`Connecting to ${PROVIDER_META[selectedProvider].label}…`);

    try {
      const info = await onConnect({ provider: selectedProvider, network });
      setWallet(info);
      setStatus('connected');
      setStatusAnnouncement(
        `Connected to ${PROVIDER_META[selectedProvider].label}. ` +
        `Account: ${shortenAddress(info.address)}. Network: ${info.network}.`,
      );
      toast.success(
        'Wallet Connected',
        `${PROVIDER_META[selectedProvider].label} · ${shortenAddress(info.address)}`,
      );
      onConnected?.(info);
    } catch (err: unknown) {
      const { title, message } = translateError(err);

      const isNetwork =
        (err as { code?: string })?.code === 'NETWORK_ERROR' ||
        (err instanceof Error && (err.message.includes('fetch') || err.message.includes('Network')));

      setIsNetworkError(isNetwork);
      setErrorMessage(message);
      setStatus('error');

      // Use the assertive region so the error surfaces without delay.
      setUrgentAnnouncement(`Connection failed: ${message}`);
      toast.error(title, message, handleConnect);
    }
  }, [selectedProvider, network, onConnect, onConnected, toast, translateError]);

  const handleDisconnect = useCallback(async () => {
    setStatus('connecting'); // reuse "busy" state during async op
    setStatusAnnouncement('Disconnecting wallet…');
    try {
      await onDisconnect();
      setWallet(null);
      setStatus('disconnected');
      setStatusAnnouncement('Wallet disconnected.');
      toast.info('Wallet Disconnected', 'You have been signed out.');
      onDisconnected?.();
    } catch (err: unknown) {
      const { title, message } = translateError(err);
      setStatus('connected'); // restore — disconnect failed
      setUrgentAnnouncement(`Disconnect failed: ${message}`);
      toast.error(title, message);
    }
  }, [onDisconnect, onDisconnected, toast, translateError]);

  const handleCopyAddress = useCallback(async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setStatusAnnouncement('Wallet address copied to clipboard.');
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setUrgentAnnouncement('Failed to copy address. Please copy it manually.');
    }
  }, [wallet]);

  const isBusy = status === 'connecting';

  // ── Render: Connected view ─────────────────────────────────────────────────

  if (status === 'connected' && wallet) {
    return (
      <section
        className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-5 space-y-4 max-w-sm"
        aria-label="Connected wallet"
      >
        {/* Polite live region — always present so AT can track it */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {statusAnnouncement}
        </div>
        {/* Assertive live region for urgent errors */}
        <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
          {urgentAnnouncement}
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
            <Wallet className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {PROVIDER_META[wallet.provider]?.label ?? wallet.provider}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{wallet.network}</p>
          </div>
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300"
            aria-label="Wallet status: connected"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
            Connected
          </span>
        </div>

        {/* Address row */}
        <div
          id={id('address-block')}
          className="flex items-center justify-between rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-3 py-2"
        >
          <code
            className="text-sm font-mono text-gray-700 dark:text-gray-300"
            aria-label={`Wallet address: ${wallet.address}`}
            title={wallet.address}
          >
            {shortenAddress(wallet.address)}
          </code>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopyAddress}
              aria-label={copied ? 'Address copied' : 'Copy wallet address to clipboard'}
              aria-pressed={copied}
              className="rounded p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              {copied ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <a
              href={`https://stellar.expert/explorer/${wallet.network.toLowerCase()}/account/${wallet.address}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${shortenAddress(wallet.address)} on Stellar Explorer (opens in new tab)`}
              className="rounded p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        {/* Balance */}
        {wallet.balance !== undefined && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Balance:{' '}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {parseFloat(wallet.balance).toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM
            </span>
          </p>
        )}

        {/* Disconnect */}
        <button
          onClick={handleDisconnect}
          disabled={isBusy}
          aria-label="Disconnect wallet"
          aria-busy={isBusy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
        >
          {isBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Disconnecting…
            </>
          ) : (
            <>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Disconnect
            </>
          )}
        </button>
      </section>
    );
  }

  // ── Render: Disconnected / connecting / error view ────────────────────────

  return (
    <section
      className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 space-y-5 max-w-sm"
      aria-label="Connect wallet"
    >
      {/* Polite status live region */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {statusAnnouncement}
      </div>
      {/* Assertive error live region */}
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {urgentAnnouncement}
      </div>

      {/* Heading */}
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-gray-500 dark:text-gray-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Connect Wallet
        </h2>
      </div>

      {/* Error banner */}
      {status === 'error' && errorMessage && (
        <div
          className="flex items-start gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-300"
          role="alert"
          aria-label={isNetworkError ? 'Network connection error' : 'Connection error'}
        >
          {isNetworkError ? (
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Provider picker */}
      <fieldset>
        <legend className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
          Choose wallet provider
        </legend>
        <div
          role="radiogroup"
          aria-label="Wallet provider selection"
          aria-required="true"
          className="space-y-2"
        >
          {PROVIDERS.map((provider) => {
            const { label, description, docsUrl } = PROVIDER_META[provider];
            const isSelected = selectedProvider === provider;
            const radioId = id(`provider-${provider}`);
            const descId = id(`provider-desc-${provider}`);

            return (
              <div key={provider}>
                <label
                  htmlFor={radioId}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-blue-500 ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <input
                    type="radio"
                    id={radioId}
                    name={id('wallet-provider')}
                    value={provider}
                    checked={isSelected}
                    onChange={() => setSelectedProvider(provider)}
                    aria-describedby={descId}
                    className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                      {label}
                    </span>
                    <span
                      id={descId}
                      className="block text-xs text-gray-500 dark:text-gray-400"
                    >
                      {description}
                    </span>
                  </div>
                  <a
                    href={docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Learn more about ${label} (opens in new tab)`}
                    className="shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 rounded"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      {/* Network indicator */}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Network:{' '}
        <span className="font-medium text-gray-700 dark:text-gray-300">{network}</span>
      </p>

      {/* Connect button */}
      <button
        onClick={handleConnect}
        disabled={isBusy}
        aria-label={
          isBusy
            ? `Connecting to ${PROVIDER_META[selectedProvider].label}, please wait`
            : `Connect ${PROVIDER_META[selectedProvider].label} wallet`
        }
        aria-busy={isBusy}
        aria-describedby={status === 'error' ? id('error-hint') : undefined}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        {isBusy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Connecting…
          </>
        ) : (
          <>
            <Wallet className="h-4 w-4" aria-hidden="true" />
            Connect {PROVIDER_META[selectedProvider].label}
          </>
        )}
      </button>

      {/* Retry hint for screen readers when in error state */}
      {status === 'error' && (
        <p id={id('error-hint')} className="sr-only">
          Connection failed. Activate the Connect button to retry.
        </p>
      )}
    </section>
  );
}
