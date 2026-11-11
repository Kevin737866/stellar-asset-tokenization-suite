/**
 * Core SDK Configuration, Safety, Timeout, AbortSignal & Simulation Utilities
 *
 * Runtime Requirements & Network Configuration (#397):
 *   - Runtime: Node.js >= 18.0.0 (native `AbortController`/`AbortSignal`, `BigInt`,
 *     ES2020+) or modern browsers supporting `BigInt` and `AbortSignal`.
 *   - Supported Stellar Networks:
 *       - `testnet`    -> `https://horizon-testnet.stellar.org`  (`Test SDF Network ; September 2015`)
 *       - `mainnet`    -> `https://horizon.stellar.org`          (`Public Global Stellar Network ; September 2015`)
 *       - `futurenet`  -> `https://horizon-futurenet.stellar.org`(`Test SDF Future Network ; October 2022`)
 *       - `standalone` -> `http://localhost:8000`                (`Standalone Network ; February 2017`)
 *   - Timeout Configuration:
 *       Shared `RequestTimeoutConfig` defaults to `DEFAULT_REQUEST_TIMEOUT_MS` (30,000 ms),
 *       bounded between `MIN_REQUEST_TIMEOUT_MS` (100 ms) and `MAX_REQUEST_TIMEOUT_MS` (300,000 ms).
 *   - Cancellation:
 *       Read-only operations accept `ReadRequestOptions` (`signal?: AbortSignal`, `timeoutMs?: number`)
 *       via `executeReadWithAbort`, cleaning up all listeners and timers in `finally`.
 */

import { DEFAULT_TIMEOUT_SECONDS, STELLAR_NETWORKS } from './constants';
import {
  ContractError,
  InvalidParametersError,
  NetworkError,
  RWASDKError,
  TimeoutError,
} from './errors';
import { isBrowser, isNode } from './logger';
import { ErrorCode, RWASDKConfig, StellarNetwork } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// #397: Runtime Requirements & Network Configuration Documentation Constants
// ─────────────────────────────────────────────────────────────────────────────

export const SDK_RUNTIME_REQUIREMENTS = {
  minNodeVersion: '18.0.0',
  ecmascriptTarget: 'ES2020',
  requiredGlobals: ['BigInt', 'URL', 'AbortController', 'AbortSignal'] as const,
  supportedNetworks: ['testnet', 'mainnet', 'futurenet', 'standalone'] as readonly StellarNetwork[],
  defaultRequestTimeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000,
} as const;

export const SDK_NETWORK_DOCUMENTATION: Record<
  StellarNetwork,
  { network: StellarNetwork; defaultHorizonUrl: string; defaultServerUrl: string; passphrase: string; notes: string }
> = {
  testnet: {
    network: 'testnet',
    defaultHorizonUrl: STELLAR_NETWORKS.testnet.horizonUrl,
    defaultServerUrl: STELLAR_NETWORKS.testnet.serverUrl,
    passphrase: STELLAR_NETWORKS.testnet.passphrase,
    notes: 'Default safe network for integration and smoke testing.',
  },
  mainnet: {
    network: 'mainnet',
    defaultHorizonUrl: STELLAR_NETWORKS.mainnet.horizonUrl,
    defaultServerUrl: STELLAR_NETWORKS.mainnet.serverUrl,
    passphrase: STELLAR_NETWORKS.mainnet.passphrase,
    notes: 'Production network; requires explicit operator confirmation for writes.',
  },
  futurenet: {
    network: 'futurenet',
    defaultHorizonUrl: STELLAR_NETWORKS.futurenet.horizonUrl,
    defaultServerUrl: STELLAR_NETWORKS.futurenet.serverUrl,
    passphrase: STELLAR_NETWORKS.futurenet.passphrase,
    notes: 'Preview protocol environment for upcoming Soroban releases.',
  },
  standalone: {
    network: 'standalone',
    defaultHorizonUrl: STELLAR_NETWORKS.standalone.horizonUrl,
    defaultServerUrl: STELLAR_NETWORKS.standalone.serverUrl,
    passphrase: STELLAR_NETWORKS.standalone.passphrase,
    notes: 'Local Stellar Quickstart Docker network.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// #389: Typed Network Configuration Validation
// ─────────────────────────────────────────────────────────────────────────────

export interface TypedNetworkConfigInput {
  network: StellarNetwork;
  serverUrl: string;
  horizonUrl?: string;
  passphrase: string;
  requestTimeoutMs?: number;
}

export interface TypedNetworkConfigValidationResult {
  valid: boolean;
  network: StellarNetwork;
  serverUrl: string;
  horizonUrl: string;
  passphrase: string;
  requestTimeoutMs: number;
}

const SUPPORTED_NETWORK_SET = new Set<string>(['testnet', 'mainnet', 'futurenet', 'standalone']);

function parseValidHttpUrl(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new InvalidParametersError(`${fieldName} is required and must be a valid HTTP(S) URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new InvalidParametersError(`Invalid ${fieldName}: "${raw}" is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidParametersError(`Invalid ${fieldName}: protocol must be http: or https:`);
  }
  return raw.trim();
}

/**
 * Strictly validates network configuration before any SDK client is constructed.
 */
export function validateTypedNetworkConfig(
  config: TypedNetworkConfigInput,
  options: { requireMatchingPassphrase?: boolean } = {}
): TypedNetworkConfigValidationResult {
  if (config == null || typeof config !== 'object') {
    throw new InvalidParametersError('Stellar network configuration object is required');
  }
  if (typeof config.network !== 'string' || !SUPPORTED_NETWORK_SET.has(config.network)) {
    throw new InvalidParametersError(
      `Unsupported Stellar network "${String(config.network)}". Expected one of: testnet, mainnet, futurenet, standalone`
    );
  }

  const serverUrl = parseValidHttpUrl(config.serverUrl, 'stellar.serverUrl');
  const horizonUrl =
    config.horizonUrl !== undefined
      ? parseValidHttpUrl(config.horizonUrl, 'stellar.horizonUrl')
      : serverUrl;

  if (typeof config.passphrase !== 'string' || config.passphrase.trim().length === 0) {
    throw new InvalidParametersError('stellar.passphrase is required and must be a non-empty string');
  }

  const requireMatch = options.requireMatchingPassphrase ?? false;
  const expectedPassphrase = STELLAR_NETWORKS[config.network]?.passphrase;
  if (requireMatch && expectedPassphrase && config.passphrase.trim() !== expectedPassphrase) {
    throw new InvalidParametersError(
      `Passphrase mismatch for network "${config.network}": expected "${expectedPassphrase}"`
    );
  }

  const requestTimeoutMs = resolveRequestTimeoutMs(config.requestTimeoutMs);

  return {
    valid: true,
    network: config.network,
    serverUrl,
    horizonUrl,
    passphrase: config.passphrase.trim(),
    requestTimeoutMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// #395: Contract Address Validation Against Selected Network Config
// ─────────────────────────────────────────────────────────────────────────────

const SOROBAN_CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;
const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

export interface NetworkContractValidationOptions {
  /** Optional map of known contract IDs per network to detect cross-network misuse. */
  networkRegistry?: Partial<Record<StellarNetwork, readonly string[]>>;
  /** Allow G... account-style addresses in addition to C... Soroban contract IDs. */
  allowAccountAddress?: boolean;
}

/**
 * Validates that a contract address is syntactically valid and not misconfigured
 * for the active Stellar network (e.g., rejects testnet contracts when targeting mainnet
 * if registered on another network in `networkRegistry`).
 */
export function validateContractAddressForNetwork(
  address: unknown,
  networkConfig: Pick<TypedNetworkConfigInput, 'network'>,
  name = 'contractAddress',
  options: NetworkContractValidationOptions = {}
): string {
  if (typeof address !== 'string' || address.trim().length === 0) {
    throw new InvalidParametersError(`${name} is required for network "${networkConfig.network}"`);
  }
  const trimmed = address.trim();
  const isContract = SOROBAN_CONTRACT_ID_REGEX.test(trimmed);
  const isAccount = STELLAR_PUBLIC_KEY_REGEX.test(trimmed);

  if (!isContract && !(options.allowAccountAddress && isAccount)) {
    throw new InvalidParametersError(
      `Invalid ${name} "${trimmed}" for network "${networkConfig.network}": expected a 56-character C... Soroban contract ID`
    );
  }

  if (options.networkRegistry) {
    const activeNetwork = networkConfig.network;
    const activeList = options.networkRegistry[activeNetwork];
    const belongingNetworks = (Object.entries(options.networkRegistry) as Array<[StellarNetwork, readonly string[] | undefined]>)
      .filter(([, ids]) => Array.isArray(ids) && ids.includes(trimmed))
      .map(([net]) => net);

    if (belongingNetworks.length > 0 && !belongingNetworks.includes(activeNetwork)) {
      throw new InvalidParametersError(
        `${name} (${trimmed}) is registered for ${belongingNetworks.join(', ')}, not "${activeNetwork}"`
      );
    }

    if (Array.isArray(activeList) && activeList.length > 0 && !activeList.includes(trimmed)) {
      throw new InvalidParametersError(
        `${name} (${trimmed}) is not listed in configured contracts for "${activeNetwork}"`
      );
    }
  }

  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// #391: Shared Request Timeout Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_TIMEOUT_SECONDS * 1000;
export const MIN_REQUEST_TIMEOUT_MS = 100;
export const MAX_REQUEST_TIMEOUT_MS = 300_000;

export interface RequestTimeoutConfig {
  timeoutMs: number;
}

export function resolveRequestTimeoutMs(
  overrideMs?: number,
  config?: Pick<RWASDKConfig, 'defaultTimeout'>
): number {
  const candidate =
    overrideMs !== undefined
      ? overrideMs
      : config?.defaultTimeout !== undefined
        ? config.defaultTimeout * 1000
        : DEFAULT_REQUEST_TIMEOUT_MS;

  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    !Number.isInteger(candidate) ||
    candidate < MIN_REQUEST_TIMEOUT_MS ||
    candidate > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new InvalidParametersError(
      `Request timeout must be an integer between ${MIN_REQUEST_TIMEOUT_MS}ms and ${MAX_REQUEST_TIMEOUT_MS}ms`
    );
  }
  return candidate;
}

export async function withRequestTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  operationName = 'SDK request'
): Promise<T> {
  const validatedMs = resolveRequestTimeoutMs(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${operationName} timed out after ${validatedMs}ms`));
    }, validatedMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #392: AbortSignal Support for Read-Only SDK Requests
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  operationName?: string;
}

function createAbortError(operationName: string, signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  const detail = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'aborted by caller';
  return new NetworkError(`${operationName} aborted: ${detail}`, { aborted: true });
}

/**
 * Executes a read-only async operation with cooperative `AbortSignal` and optional timeout.
 */
export async function executeReadWithAbort<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: ReadRequestOptions = {}
): Promise<T> {
  const operationName = options.operationName ?? 'SDK read request';
  const externalSignal = options.signal;

  if (externalSignal?.aborted) {
    throw createAbortError(operationName, externalSignal);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onExternalAbort = () => {
    controller.abort((externalSignal as { reason?: unknown }).reason);
  };

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let timedOut = false;
  if (options.timeoutMs !== undefined) {
    const ms = resolveRequestTimeoutMs(options.timeoutMs);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new TimeoutError(`${operationName} timed out after ${ms}ms`));
    }, ms);
  }

  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (controller.signal.aborted) {
      reject(
        timedOut
          ? new TimeoutError(`${operationName} timed out`)
          : createAbortError(operationName, controller.signal)
      );
      return;
    }
    controller.signal.addEventListener(
      'abort',
      () => {
        if (timedOut) {
          reject(new TimeoutError(`${operationName} timed out after ${options.timeoutMs}ms`));
        } else {
          reject(createAbortError(operationName, controller.signal));
        }
      },
      { once: true }
    );
  });

  try {
    return await Promise.race([operation(controller.signal), abortPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #394: Stable Error Codes for Soroban Simulation Failures
// ─────────────────────────────────────────────────────────────────────────────

export const SOROBAN_SIMULATION_ERROR_CODES = {
  HOST_ERROR: 'SIMULATION_HOST_ERROR',
  RESOURCE_EXCEEDED: 'SIMULATION_RESOURCE_EXCEEDED',
  AUTH_INVALID: 'SIMULATION_AUTH_INVALID',
  FOOTPRINT_EXPIRED: 'SIMULATION_FOOTPRINT_EXPIRED',
  CONTRACT_TRAP: 'SIMULATION_CONTRACT_TRAP',
  NETWORK_UNREACHABLE: 'SIMULATION_NETWORK_UNREACHABLE',
  UNKNOWN: 'SIMULATION_UNKNOWN',
} as const;

export type SorobanSimulationErrorCode =
  (typeof SOROBAN_SIMULATION_ERROR_CODES)[keyof typeof SOROBAN_SIMULATION_ERROR_CODES];

export interface SimulationFailureDetails {
  code: SorobanSimulationErrorCode;
  sdkErrorCode: ErrorCode;
  message: string;
  retryable: boolean;
  suggestedAction: string;
  contractErrorNumber?: number;
}

/**
 * Classifies raw Soroban RPC simulation errors into stable, machine-readable codes.
 */
export function classifySimulationFailure(rawError: unknown): SimulationFailureDetails {
  const message =
    rawError instanceof Error
      ? rawError.message
      : typeof rawError === 'string'
        ? rawError
        : JSON.stringify(rawError ?? 'Unknown simulation failure');
  const lower = message.toLowerCase();

  const contractErrMatch = /Error\(Contract,\s*#(\d+)\)/i.exec(message);
  const contractErrorNumber = contractErrMatch ? parseInt(contractErrMatch[1], 10) : undefined;

  if (contractErrorNumber !== undefined || lower.includes('unreachablecode') || lower.includes('trap')) {
    return {
      code: SOROBAN_SIMULATION_ERROR_CODES.CONTRACT_TRAP,
      sdkErrorCode: ErrorCode.SIMULATION_FAILED,
      message,
      retryable: false,
      suggestedAction: 'Inspect contract error code and pre-conditions before resubmitting.',
      ...(contractErrorNumber !== undefined ? { contractErrorNumber } : {}),
    };
  }

  if (lower.includes('cpu') || lower.includes('memory') || lower.includes('budget') || lower.includes('resource')) {
    return {
      code: SOROBAN_SIMULATION_ERROR_CODES.RESOURCE_EXCEEDED,
      sdkErrorCode: ErrorCode.SIMULATION_FAILED,
      message,
      retryable: false,
      suggestedAction: 'Reduce batch size or complexity to stay within Soroban resource limits.',
    };
  }

  if (lower.includes('auth') || lower.includes('signature') || lower.includes('unauthorized')) {
    return {
      code: SOROBAN_SIMULATION_ERROR_CODES.AUTH_INVALID,
      sdkErrorCode: ErrorCode.UNAUTHORIZED,
      message,
      retryable: false,
      suggestedAction: 'Verify required signers and Soroban authorization entries.',
    };
  }

  if (lower.includes('expired') || lower.includes('archived') || lower.includes('restore')) {
    return {
      code: SOROBAN_SIMULATION_ERROR_CODES.FOOTPRINT_EXPIRED,
      sdkErrorCode: ErrorCode.SIMULATION_FAILED,
      message,
      retryable: true,
      suggestedAction: 'Restore expired ledger entries or refresh transaction footprint before retry.',
    };
  }

  if (lower.includes('econn') || lower.includes('timeout') || lower.includes('network') || lower.includes('fetch')) {
    return {
      code: SOROBAN_SIMULATION_ERROR_CODES.NETWORK_UNREACHABLE,
      sdkErrorCode: ErrorCode.NETWORK_ERROR,
      message,
      retryable: true,
      suggestedAction: 'Check Soroban RPC endpoint connectivity and retry.',
    };
  }

  if (lower.includes('hosterror') || lower.includes('wasm') || lower.includes('vm')) {
    return {
      code: SOROBAN_SIMULATION_ERROR_CODES.HOST_ERROR,
      sdkErrorCode: ErrorCode.SIMULATION_FAILED,
      message,
      retryable: false,
      suggestedAction: 'Verify contract ID, method name, and ScVal argument types.',
    };
  }

  return {
    code: SOROBAN_SIMULATION_ERROR_CODES.UNKNOWN,
    sdkErrorCode: ErrorCode.SIMULATION_FAILED,
    message,
    retryable: false,
    suggestedAction: 'Inspect raw simulation error payload and contract state.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// #390: Typed Result Wrapper for Contract Invocation Failures
// ─────────────────────────────────────────────────────────────────────────────

export interface ContractInvocationFailure {
  code: string;
  category: 'validation' | 'authorization' | 'simulation' | 'network' | 'timeout' | 'contract' | 'unknown';
  message: string;
  retryable: boolean;
  simulation?: SimulationFailureDetails;
  cause?: unknown;
}

export type ContractInvocationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ContractInvocationFailure };

export function toContractInvocationFailure(error: unknown): ContractInvocationFailure {
  if (error instanceof InvalidParametersError) {
    return {
      code: error.code,
      category: 'validation',
      message: error.message,
      retryable: false,
      cause: error,
    };
  }
  if (error instanceof TimeoutError) {
    return {
      code: error.code,
      category: 'timeout',
      message: error.message,
      retryable: true,
      cause: error,
    };
  }
  if (error instanceof NetworkError) {
    return {
      code: error.code,
      category: 'network',
      message: error.message,
      retryable: true,
      cause: error,
    };
  }
  if (error instanceof ContractError) {
    const sim = classifySimulationFailure(error.message);
    return {
      code: error.code,
      category: 'contract',
      message: error.message,
      retryable: sim.retryable,
      simulation: sim,
      cause: error,
    };
  }
  if (error instanceof RWASDKError) {
    const isAuth = error.code === ErrorCode.UNAUTHORIZED || error.code === ErrorCode.TX_BAD_AUTH;
    const isSim = error.code === ErrorCode.SIMULATION_FAILED;
    const sim = isSim ? classifySimulationFailure(error.message) : undefined;
    return {
      code: isSim && sim ? sim.code : error.code,
      category: isAuth ? 'authorization' : isSim ? 'simulation' : 'contract',
      message: error.message,
      retryable: sim?.retryable ?? false,
      ...(sim ? { simulation: sim } : {}),
      cause: error,
    };
  }

  const msg = error instanceof Error ? error.message : String(error);
  const sim = classifySimulationFailure(msg);
  return {
    code: sim.code,
    category: sim.code === SOROBAN_SIMULATION_ERROR_CODES.NETWORK_UNREACHABLE ? 'network' : 'unknown',
    message: msg,
    retryable: sim.retryable,
    simulation: sim,
    cause: error,
  };
}

export async function invokeContractSafely<T>(
  invocation: () => Promise<T>
): Promise<ContractInvocationResult<T>> {
  try {
    const value = await invocation();
    return { ok: true, value };
  } catch (err: unknown) {
    return { ok: false, failure: toContractInvocationFailure(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// #396: Typed SDK Capability and Feature Support Query
// ─────────────────────────────────────────────────────────────────────────────

export interface SDKCapabilityReport {
  sdkName: string;
  runtime: 'node' | 'browser' | 'unknown';
  nodeVersion: string | null;
  features: {
    abortSignal: boolean;
    exactDecimal: boolean;
    structuredLogRedaction: boolean;
    simulationErrorClassification: boolean;
    typedContractResults: boolean;
    networkContractValidation: boolean;
    sharedRequestTimeout: boolean;
    batchTransactions: boolean;
    gasEstimation: boolean;
    telemetry: boolean;
    custodyMonitoring: boolean;
  };
  supportedNetworks: readonly StellarNetwork[];
  selectedNetwork?: StellarNetwork;
  defaultTimeoutMs: number;
}

export function getSDKCapabilities(
  config?: Pick<RWASDKConfig, 'stellar' | 'defaultTimeout'>
): SDKCapabilityReport {
  const runtime: 'node' | 'browser' | 'unknown' = isNode
    ? 'node'
    : isBrowser
      ? 'browser'
      : 'unknown';

  return {
    sdkName: 'stellar-asset-tokenization-suite',
    runtime,
    nodeVersion: isNode ? process.versions.node : null,
    features: {
      abortSignal: typeof AbortController !== 'undefined' && typeof AbortSignal !== 'undefined',
      exactDecimal: typeof BigInt === 'function',
      structuredLogRedaction: true,
      simulationErrorClassification: true,
      typedContractResults: true,
      networkContractValidation: true,
      sharedRequestTimeout: true,
      batchTransactions: true,
      gasEstimation: true,
      telemetry: true,
      custodyMonitoring: true,
    },
    supportedNetworks: SDK_RUNTIME_REQUIREMENTS.supportedNetworks,
    ...(config?.stellar?.network ? { selectedNetwork: config.stellar.network } : {}),
    defaultTimeoutMs: resolveRequestTimeoutMs(undefined, config),
  };
}
