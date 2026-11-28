import { DEFAULT_TIMEOUT_SECONDS } from './constants';

/** Default polling interval in milliseconds when waiting for transaction confirmation. */
export const DEFAULT_CONFIRMATION_POLL_INTERVAL_MS = 1000;

/** Default bounded timeout in milliseconds for transaction confirmation polling. */
export const DEFAULT_CONFIRMATION_TIMEOUT_MS = DEFAULT_TIMEOUT_SECONDS * 1000;

/** Hard upper bound (5 minutes) for transaction confirmation polling timeout. */
export const MAX_CONFIRMATION_TIMEOUT_MS = 300_000;

export type TransactionConfirmationStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND' | 'PENDING';

export type TransactionConfirmationErrorCode =
  | 'INVALID_PARAMETERS'
  | 'TRANSACTION_FAILED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR';

export class TransactionConfirmationError extends Error {
  public readonly code: TransactionConfirmationErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: TransactionConfirmationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TransactionConfirmationError';
    this.code = code;
    this.details = details;
  }
}

export interface TransactionConfirmationServer {
  getTransaction(hash: string): Promise<{
    status: string;
    ledger?: number;
    createdAt?: number | string;
    resultXdr?: any;
    resultMetaXdr?: any;
    errorResult?: any;
  }>;
}

export interface TransactionConfirmationOptions {
  /** Bounded timeout in milliseconds. Must be > 0 and <= {@link MAX_CONFIRMATION_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Interval between poll attempts in milliseconds. Must be > 0 and <= `timeoutMs`. */
  pollIntervalMs?: number;
  /** Optional upper bound on total poll attempts (positive integer). */
  maxAttempts?: number;
  /** Optional Soroban RPC server instance (takes precedence over `serverUrl`). */
  server?: TransactionConfirmationServer;
  /** Soroban RPC server URL used when `server` is not provided. */
  serverUrl?: string;
  /** Optional progress callback invoked after each poll attempt. */
  onPoll?: (info: { attempt: number; status: string; elapsedMs: number }) => void;
  /** Optional AbortSignal to cancel polling early. */
  signal?: AbortSignal;
  /** Optional custom sleep function (primarily for deterministic testing). */
  sleep?: (ms: number) => Promise<void>;
}

export interface TransactionConfirmationResult {
  transactionHash: string;
  status: 'SUCCESS';
  confirmed: true;
  ledger?: number;
  createdAt?: number | string;
  resultXdr?: any;
  resultMetaXdr?: any;
  attempts: number;
  elapsedMs: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Poll a Soroban RPC server for transaction confirmation with a bounded timeout.
 *
 * Read-only observation loop: failed, timed-out, or aborted polls leave no
 * partial state changes.
 *
 * @param txHash  - Non-empty transaction hash to poll.
 * @param options - Polling configuration including `timeoutMs`, `pollIntervalMs`,
 *                  `maxAttempts`, and either `server` or `serverUrl`.
 * @returns {@link TransactionConfirmationResult} when the transaction is confirmed.
 * @throws {TransactionConfirmationError} with code:
 *   - `INVALID_PARAMETERS` on invalid `txHash`, `timeoutMs`, `pollIntervalMs`, `maxAttempts`, or missing server.
 *   - `TRANSACTION_FAILED` when the transaction settles with `FAILED` status.
 *   - `TIMEOUT` when the bounded timeout or `maxAttempts` is exceeded, or `signal` is aborted.
 *   - `NETWORK_ERROR` when `server.getTransaction` throws an unexpected transport error.
 */
export async function pollTransactionConfirmation(
  txHash: string,
  options: TransactionConfirmationOptions = {},
): Promise<TransactionConfirmationResult> {
  if (typeof txHash !== 'string' || txHash.trim().length === 0) {
    throw new TransactionConfirmationError(
      'INVALID_PARAMETERS',
      'txHash must be a non-empty string',
    );
  }
  const normalizedHash = txHash.trim();

  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TransactionConfirmationError(
      'INVALID_PARAMETERS',
      'options.timeoutMs must be a positive finite number',
    );
  }
  if (timeoutMs > MAX_CONFIRMATION_TIMEOUT_MS) {
    throw new TransactionConfirmationError(
      'INVALID_PARAMETERS',
      `options.timeoutMs cannot exceed ${MAX_CONFIRMATION_TIMEOUT_MS}ms (received ${timeoutMs}ms)`,
    );
  }

  const pollIntervalMs =
    options.pollIntervalMs ?? Math.min(DEFAULT_CONFIRMATION_POLL_INTERVAL_MS, timeoutMs);
  if (
    typeof pollIntervalMs !== 'number' ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs <= 0
  ) {
    throw new TransactionConfirmationError(
      'INVALID_PARAMETERS',
      'options.pollIntervalMs must be a positive finite number',
    );
  }
  if (pollIntervalMs > timeoutMs) {
    throw new TransactionConfirmationError(
      'INVALID_PARAMETERS',
      `options.pollIntervalMs (${pollIntervalMs}ms) cannot exceed options.timeoutMs (${timeoutMs}ms)`,
    );
  }

  if (
    options.maxAttempts !== undefined &&
    (typeof options.maxAttempts !== 'number' ||
      !Number.isInteger(options.maxAttempts) ||
      options.maxAttempts <= 0)
  ) {
    throw new TransactionConfirmationError(
      'INVALID_PARAMETERS',
      'options.maxAttempts must be a positive integer',
    );
  }

  let server = options.server;
  if (!server) {
    if (!options.serverUrl || !isValidHttpUrl(options.serverUrl)) {
      throw new TransactionConfirmationError(
        'INVALID_PARAMETERS',
        'Either options.server or a valid http(s) options.serverUrl is required',
      );
    }
    const { SorobanRpc } = await import('stellar-sdk');
    server = new SorobanRpc.Server(options.serverUrl) as unknown as TransactionConfirmationServer;
  }

  const sleepFn = options.sleep ?? defaultSleep;
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;
  let attempts = 0;
  let lastStatus = 'NOT_FOUND';

  while (true) {
    if (options.signal?.aborted) {
      throw new TransactionConfirmationError(
        'TIMEOUT',
        `Transaction confirmation polling aborted for ${normalizedHash}`,
        { txHash: normalizedHash, aborted: true, attempts, elapsedMs: Date.now() - startTime },
      );
    }

    attempts += 1;
    let response: any;
    try {
      response = await server.getTransaction(normalizedHash);
    } catch (err: unknown) {
      if (err instanceof TransactionConfirmationError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new TransactionConfirmationError(
        'NETWORK_ERROR',
        `Failed to poll transaction ${normalizedHash}: ${msg}`,
        { txHash: normalizedHash, attempts, elapsedMs: Date.now() - startTime },
      );
    }

    const elapsedMs = Date.now() - startTime;
    const status = String(response?.status ?? 'NOT_FOUND').toUpperCase();
    lastStatus = status;

    options.onPoll?.({ attempt: attempts, status, elapsedMs });

    if (status === 'SUCCESS') {
      return {
        transactionHash: normalizedHash,
        status: 'SUCCESS',
        confirmed: true,
        ledger: response.ledger,
        createdAt: response.createdAt,
        resultXdr: response.resultXdr,
        resultMetaXdr: response.resultMetaXdr,
        attempts,
        elapsedMs,
      };
    }

    if (status === 'FAILED') {
      throw new TransactionConfirmationError(
        'TRANSACTION_FAILED',
        `Transaction ${normalizedHash} failed on-chain`,
        {
          txHash: normalizedHash,
          status: 'FAILED',
          ledger: response.ledger,
          resultXdr: response.resultXdr,
          errorResult: response.errorResult,
          attempts,
          elapsedMs,
        },
      );
    }

    if (options.maxAttempts !== undefined && attempts >= options.maxAttempts) {
      throw new TransactionConfirmationError(
        'TIMEOUT',
        `Transaction ${normalizedHash} not confirmed after ${attempts} attempts (last status: ${lastStatus})`,
        { txHash: normalizedHash, lastStatus, attempts, elapsedMs, timeoutMs },
      );
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new TransactionConfirmationError(
        'TIMEOUT',
        `Transaction ${normalizedHash} confirmation timed out after ${timeoutMs}ms (last status: ${lastStatus})`,
        { txHash: normalizedHash, lastStatus, attempts, elapsedMs, timeoutMs },
      );
    }

    await sleepFn(Math.min(pollIntervalMs, remainingMs));
  }
}
