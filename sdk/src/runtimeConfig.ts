/**
 * SDK runtime requirements and network configuration.
 *
 * Drips Wave 11, issue #397 — `feat(sdk-core): Document SDK runtime
 * requirements and network configuration`.
 *
 * This module is the single source of truth for the rules documented in
 * `docs/sdk-runtime.md`, kept next to the code so docs and implementation
 * cannot drift apart:
 *
 * - which Stellar networks the SDK knows (`SUPPORTED_NETWORKS`) and their
 *   default endpoints / passphrases (`STELLAR_NETWORKS` in `./constants`);
 * - the allowed ranges for per-request timeouts and fee rates;
 * - strict resolution of a user-supplied runtime config into a complete,
 *   validated `ResolvedRuntimeConfig` — validation runs FIRST, so a failed
 *   resolution returns nothing and the caller can never observe a
 *   half-filled config (no partial state);
 * - explicit failure semantics: an unknown network, a malformed RPC URL, an
 *   out-of-range timeout/fee, or a server URL / passphrase that belongs to a
 *   *different* network than the one named all throw `InvalidParametersError`
 *   naming the expected values. The SDK never silently switches networks.
 */

import {
  DEFAULT_FEE_RATE,
  DEFAULT_TIMEOUT_SECONDS,
  STELLAR_NETWORKS,
} from './constants';
import { InvalidParametersError } from './errors';
import { validateNonEmptyString, validateServerUrl } from './validation';

/** Networks the SDK knows how to address. Anything else is rejected. */
export const SUPPORTED_NETWORKS = ['testnet', 'mainnet', 'futurenet', 'standalone'] as const;

/** One of the names in {@link SUPPORTED_NETWORKS}. */
export type StellarNetworkName = (typeof SUPPORTED_NETWORKS)[number];

/** Default endpoint + passphrase for one supported network. */
export interface NetworkConfig {
  serverUrl: string;
  horizonUrl: string;
  passphrase: string;
}

/**
 * Minimum runtime the SDK is verified against.
 *
 * - `node`: `stellar-sdk` v12 documents Node 18 as the oldest supported
 *   maintenance release ("Install Node 18 ... we support the oldest
 *   maintenance version of Node"); this repo's CI pins Node 20
 *   (`.github/workflows/ci.yml`, `NODE_VERSION: '20'`).
 * - `typescript`: the repo builds with TypeScript 5 (`devDependencies`).
 */
export const RUNTIME_REQUIREMENTS = {
  node: '>=18.0.0',
  typescript: '>=5.0.0',
} as const;

/** Smallest accepted per-request timeout, in seconds. */
export const MIN_TIMEOUT_SECONDS = 1;
/** Largest accepted per-request timeout, in seconds (5 minutes). */
export const MAX_TIMEOUT_SECONDS = 300;
/** Smallest accepted fee rate, in basis points (0 = no fee). */
export const MIN_FEE_RATE_BPS = 0;
/** Largest accepted fee rate, in basis points (10000 = 100%). */
export const MAX_FEE_RATE_BPS = 10_000;

/**
 * Type guard for a supported network name. Matching is exact and
 * case-sensitive: `'MAINNET'` and `'mainnett'` are not networks.
 */
export function isSupportedNetwork(value: unknown): value is StellarNetworkName {
  return (
    typeof value === 'string' &&
    (SUPPORTED_NETWORKS as readonly string[]).includes(value)
  );
}

/**
 * Throw unless `network` is a supported network name.
 *
 * @throws {InvalidParametersError} naming the supported networks.
 */
export function validateNetworkName(
  network: unknown,
  name = 'network',
): asserts network is StellarNetworkName {
  if (!isSupportedNetwork(network)) {
    throw new InvalidParametersError(
      `Invalid ${name}: must be one of ${SUPPORTED_NETWORKS.join(', ')} ` +
        `(received ${JSON.stringify(network) ?? String(network)})`,
    );
  }
}

/**
 * Throw unless `value` is an integer timeout within
 * [`MIN_TIMEOUT_SECONDS`, `MAX_TIMEOUT_SECONDS`].
 *
 * @throws {InvalidParametersError}
 */
export function validateTimeoutSeconds(
  value: unknown,
  name = 'timeoutSeconds',
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_TIMEOUT_SECONDS ||
    value > MAX_TIMEOUT_SECONDS
  ) {
    throw new InvalidParametersError(
      `${name} must be an integer between ${MIN_TIMEOUT_SECONDS} and ` +
        `${MAX_TIMEOUT_SECONDS} seconds`,
    );
  }
}

/**
 * Throw unless `value` is an integer fee rate within
 * [`MIN_FEE_RATE_BPS`, `MAX_FEE_RATE_BPS`] basis points.
 *
 * @throws {InvalidParametersError}
 */
export function validateFeeRateBps(
  value: unknown,
  name = 'feeRateBps',
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_FEE_RATE_BPS ||
    value > MAX_FEE_RATE_BPS
  ) {
    throw new InvalidParametersError(
      `${name} must be an integer between ${MIN_FEE_RATE_BPS} and ` +
        `${MAX_FEE_RATE_BPS} basis points`,
    );
  }
}

/**
 * Return a copy of the default endpoint + passphrase for `network`.
 *
 * The returned object is a fresh copy: mutating it never changes
 * `STELLAR_NETWORKS`.
 *
 * @throws {InvalidParametersError} for an unknown network name.
 */
export function resolveNetworkConfig(network: unknown): NetworkConfig {
  validateNetworkName(network);
  return { ...STELLAR_NETWORKS[network] };
}

/**
 * User-supplied runtime config. Every field is validated at runtime
 * (see {@link validateRuntimeConfig}); `unknown` types let callers pass
 * unchecked input — e.g. parsed JSON — and get a typed error instead of a
 * crash later.
 */
export interface RuntimeConfigInput {
  /** Required. One of `testnet` | `mainnet` | `futurenet` | `standalone`. */
  network: unknown;
  /** Optional override for the Soroban RPC endpoint. Defaults to the network default. */
  serverUrl?: unknown;
  /** Optional override for the Horizon REST endpoint. Defaults to the network default. */
  horizonUrl?: unknown;
  /** Optional override for the network passphrase. Defaults to the network default. */
  passphrase?: unknown;
  /** Optional per-request timeout in seconds (1–300). Defaults to 30. */
  timeoutSeconds?: unknown;
  /** Optional default fee rate in basis points (0–10000). Defaults to 100. */
  feeRateBps?: unknown;
}

/** Fully resolved runtime config — no optional fields, no defaults left to fill. */
export interface ResolvedRuntimeConfig {
  network: StellarNetworkName;
  serverUrl: string;
  horizonUrl: string;
  passphrase: string;
  timeoutSeconds: number;
  feeRateBps: number;
}

/**
 * Reject a server URL / passphrase that belongs to a *different* network
 * than the one named. Pointing at mainnet Horizon while calling the network
 * `testnet` (or signing with the mainnet passphrase on testnet) is almost
 * always a misconfiguration, and the SDK must fail loudly instead of
 * submitting testnet-intended transactions to mainnet.
 *
 * Only exact matches against another network's *defaults* are rejected:
 * custom RPC URLs and custom passphrases (e.g. a local node) pass through.
 */
function assertNoCrossNetworkMismatch(
  network: StellarNetworkName,
  serverUrl: string | undefined,
  passphrase: string | undefined,
): void {
  if (serverUrl !== undefined) {
    for (const other of SUPPORTED_NETWORKS) {
      if (other !== network && STELLAR_NETWORKS[other].serverUrl === serverUrl) {
        throw new InvalidParametersError(
          `serverUrl '${serverUrl}' is the default endpoint for '${other}' ` +
            `but network is '${network}'. Use network '${other}' or a different serverUrl.`,
        );
      }
    }
  }
  if (passphrase !== undefined) {
    for (const other of SUPPORTED_NETWORKS) {
      if (other !== network && STELLAR_NETWORKS[other].passphrase === passphrase) {
        throw new InvalidParametersError(
          `passphrase belongs to network '${other}' but network is '${network}'. ` +
            `Use the passphrase for '${network}' or omit it to use the default.`,
        );
      }
    }
  }
}

/**
 * Validate a runtime config input without resolving it.
 *
 * Checks, in order: the input is an object; `network` is supported;
 * `serverUrl` / `horizonUrl` are valid URLs when given; `passphrase` is a
 * non-empty string when given; `timeoutSeconds` is an integer in 1–300;
 * `feeRateBps` is an integer in 0–10000; and neither `serverUrl` nor
 * `passphrase` belongs to a different network than the one named.
 *
 * @throws {InvalidParametersError} on the first violation found.
 */
export function validateRuntimeConfig(input: RuntimeConfigInput): void {
  if (input === null || typeof input !== 'object') {
    throw new InvalidParametersError('runtime config is required and must be an object');
  }
  validateNetworkName(input.network);
  const network = input.network as StellarNetworkName;
  if (input.serverUrl !== undefined) {
    validateServerUrl(input.serverUrl, 'serverUrl');
  }
  if (input.horizonUrl !== undefined) {
    validateServerUrl(input.horizonUrl, 'horizonUrl');
  }
  if (input.passphrase !== undefined) {
    validateNonEmptyString(input.passphrase, 'passphrase');
  }
  if (input.timeoutSeconds !== undefined) {
    validateTimeoutSeconds(input.timeoutSeconds);
  }
  if (input.feeRateBps !== undefined) {
    validateFeeRateBps(input.feeRateBps);
  }
  assertNoCrossNetworkMismatch(
    network,
    input.serverUrl as string | undefined,
    input.passphrase as string | undefined,
  );
}

/**
 * Resolve a user-supplied runtime config into a complete, validated
 * `ResolvedRuntimeConfig`, filling every omitted field from the named
 * network's defaults (`STELLAR_NETWORKS`) and the SDK defaults
 * (`DEFAULT_TIMEOUT_SECONDS`, `DEFAULT_FEE_RATE`).
 *
 * Validation runs FIRST: on any invalid input this throws
 * `InvalidParametersError` and returns nothing, so a failed resolution
 * never leaves a partially filled config behind.
 */
export function resolveRuntimeConfig(input: RuntimeConfigInput): ResolvedRuntimeConfig {
  validateRuntimeConfig(input);
  const network = input.network as StellarNetworkName;
  const defaults = STELLAR_NETWORKS[network];
  return {
    network,
    serverUrl: (input.serverUrl as string | undefined) ?? defaults.serverUrl,
    horizonUrl: (input.horizonUrl as string | undefined) ?? defaults.horizonUrl,
    passphrase: (input.passphrase as string | undefined) ?? defaults.passphrase,
    timeoutSeconds: (input.timeoutSeconds as number | undefined) ?? DEFAULT_TIMEOUT_SECONDS,
    feeRateBps: (input.feeRateBps as number | undefined) ?? DEFAULT_FEE_RATE,
  };
}
