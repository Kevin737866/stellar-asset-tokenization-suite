/**
 * Typed network configuration validation for the SDK core (issue #389).
 *
 * `validateTypedNetworkConfig` is the single validation gate applied before
 * `StellarRWASDK` constructs any client. It gives callers explicit, typed
 * failure semantics (`InvalidParametersError`) instead of late `TypeError`s
 * from partial configuration, and guarantees that a rejected configuration
 * cannot leave a half-initialised SDK behind.
 *
 * Runtime requirements / defaults:
 *   - `network` must be one of `testnet`, `mainnet`, `futurenet`, `standalone`.
 *   - `serverUrl` / `horizonUrl` must be non-empty `http:` or `https:` URLs.
 *   - `passphrase` must be non-empty; operators can opt into requiring the
 *     canonical passphrase of the selected network.
 *   - `requestTimeoutMs` must be an integer in [100, 300000] (default 30000).
 */

import {
  DEFAULT_TIMEOUT_SECONDS,
  STELLAR_NETWORKS,
  SUPPORTED_STELLAR_NETWORKS,
} from './constants';
import { InvalidParametersError } from './errors';
import type { StellarNetwork } from './types';

/** Default request timeout for a validated network configuration. */
export const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_TIMEOUT_SECONDS * 1000;
/** Lower bound (inclusive) for `requestTimeoutMs`. */
export const MIN_REQUEST_TIMEOUT_MS = 100;
/** Upper bound (inclusive) for `requestTimeoutMs`. */
export const MAX_REQUEST_TIMEOUT_MS = 300_000;

/** Raw network configuration accepted by the typed validator. */
export interface TypedNetworkConfigInput {
  network: StellarNetwork;
  serverUrl: string;
  horizonUrl?: string;
  passphrase: string;
  requestTimeoutMs?: number;
}

/** Normalised, fully validated network configuration returned by the validator. */
export interface TypedNetworkConfigValidationResult {
  valid: boolean;
  network: StellarNetwork;
  serverUrl: string;
  horizonUrl: string;
  passphrase: string;
  requestTimeoutMs: number;
}

export interface TypedNetworkConfigValidationOptions {
  /**
   * When true, `passphrase` must equal the canonical passphrase published for
   * `network` in {@link STELLAR_NETWORKS}. Off by default so private/standalone
   * networks with custom passphrases remain supported.
   */
  requireMatchingPassphrase?: boolean;
}

/** Type guard for the supported Stellar network names. */
export function isSupportedStellarNetwork(value: unknown): value is StellarNetwork {
  return (
    typeof value === 'string' &&
    (SUPPORTED_STELLAR_NETWORKS as readonly string[]).includes(value)
  );
}

/**
 * Assert that `value` is a supported network name, throwing a typed SDK error
 * listing the accepted values otherwise.
 */
export function assertSupportedStellarNetwork(
  value: unknown,
  fieldName = 'network'
): asserts value is StellarNetwork {
  if (!isSupportedStellarNetwork(value)) {
    throw new InvalidParametersError(
      `Unsupported Stellar ${fieldName} "${String(value)}". ` +
      `Expected one of: ${SUPPORTED_STELLAR_NETWORKS.join(', ')}`
    );
  }
}

function validateHttpUrl(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new InvalidParametersError(`${fieldName} is required and must be a valid HTTP(S) URL`);
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidParametersError(`Invalid ${fieldName}: "${raw}" is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidParametersError(`Invalid ${fieldName}: protocol must be http: or https:`);
  }
  return trimmed;
}

/**
 * Validate and normalise a network configuration.
 *
 * All validation happens before any value is returned, so callers can use the
 * result to build clients with the guarantee that every field is well-formed.
 * On failure an {@link InvalidParametersError} is thrown and no partial result
 * is produced.
 *
 * @param config - Network settings to validate.
 * @param options - Optional policy switches (canonical passphrase enforcement).
 * @returns A new object with trimmed values, the resolved `horizonUrl` and the
 *   effective request timeout. `valid` is always `true` on return; failures are
 *   signalled by the thrown error.
 * @throws {InvalidParametersError} for an unsupported network, a missing or
 *   non-HTTP(S) URL, an empty passphrase, a canonical-passphrase mismatch, or an
 *   out-of-bounds request timeout.
 */
export function validateTypedNetworkConfig(
  config: TypedNetworkConfigInput,
  options: TypedNetworkConfigValidationOptions = {}
): TypedNetworkConfigValidationResult {
  if (config == null || typeof config !== 'object') {
    throw new InvalidParametersError('Stellar network configuration object is required');
  }

  const network = config.network;
  assertSupportedStellarNetwork(network);

  const serverUrl = validateHttpUrl(config.serverUrl, 'stellar.serverUrl');
  const horizonUrl =
    config.horizonUrl === undefined
      ? serverUrl
      : validateHttpUrl(config.horizonUrl, 'stellar.horizonUrl');

  if (typeof config.passphrase !== 'string' || config.passphrase.trim().length === 0) {
    throw new InvalidParametersError('stellar.passphrase is required and must be a non-empty string');
  }
  const passphrase = config.passphrase.trim();

  const expectedPassphrase = STELLAR_NETWORKS[network]?.passphrase;
  if (
    (options.requireMatchingPassphrase ?? false) &&
    expectedPassphrase &&
    passphrase !== expectedPassphrase
  ) {
    throw new InvalidParametersError(
      `Passphrase mismatch for network "${network}": expected "${expectedPassphrase}"`
    );
  }

  const requestTimeoutMs =
    config.requestTimeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : config.requestTimeoutMs;
  if (
    typeof requestTimeoutMs !== 'number' ||
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < MIN_REQUEST_TIMEOUT_MS ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new InvalidParametersError(
      `stellar.requestTimeoutMs must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ` +
      `${MAX_REQUEST_TIMEOUT_MS} ms`
    );
  }

  return {
    valid: true,
    network,
    serverUrl,
    horizonUrl,
    passphrase,
    requestTimeoutMs,
  };
}
