/**
 * Typed network configuration validation for the SDK (Issue #389).
 *
 * Every entry point that creates API clients calls {@link validateNetworkConfig}
 * first. Validation is pure: it either returns a new, fully typed configuration
 * or throws an {@link InvalidParametersError} before any client exists. No
 * partially initialised SDK instance can escape this module.
 *
 * Accepted shape (`StellarConfig` from `./types`):
 * - `network`: one of `testnet`, `mainnet`, `futurenet`, `standalone`.
 * - `serverUrl`: required absolute `http:`/`https:` URL (Soroban RPC/Horizon).
 * - `passphrase`: required non-empty string of at most 256 characters.
 * - `horizonUrl`: optional absolute `http:`/`https:` URL.
 *
 * Cross-field checks (for example matching the passphrase to a known network)
 * are intentionally out of scope: private networks may use canonical network
 * names with custom passphrases and endpoints.
 */
import { InvalidParametersError } from './errors';
import { validateNonEmptyString } from './validation';
import type { StellarConfig } from './types';

/** Network discriminator accepted by the SDK. */
export type StellarNetwork = StellarConfig['network'];

/** Supported network names, kept in the same order as the `constants.ts` preset table. */
export const SUPPORTED_NETWORKS: readonly StellarNetwork[] = [
  'testnet',
  'mainnet',
  'futurenet',
  'standalone',
];

/** Normalised, validated copy of the network portion of `RWASDKConfig`. */
export interface ValidatedNetworkConfig {
  readonly network: StellarNetwork;
  readonly serverUrl: string;
  readonly passphrase: string;
  readonly horizonUrl?: string;
}

/**
 * Type guard for the accepted network discriminator.
 *
 * @example
 * ```ts
 * if (isSupportedNetwork(raw.network)) {
 *   // raw.network is narrowed to StellarNetwork
 * }
 * ```
 */
export function isSupportedNetwork(value: unknown): value is StellarNetwork {
  return typeof value === 'string'
    && (SUPPORTED_NETWORKS as readonly string[]).includes(value);
}

/**
 * Validate a network name and return it with its narrow `StellarNetwork` type.
 *
 * @throws {InvalidParametersError} when `value` is not a supported network.
 */
export function validateNetworkName(value: unknown, name = 'network'): StellarNetwork {
  if (!isSupportedNetwork(value)) {
    throw new InvalidParametersError(
      `Invalid ${name}: must be one of ${SUPPORTED_NETWORKS.join(', ')}`
    );
  }
  return value;
}

function validateHttpUrl(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidParametersError(`${name} is required and must be a non-empty URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InvalidParametersError(`Invalid ${name}: must be an absolute URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidParametersError(`Invalid ${name}: must use http or https`);
  }
  return value;
}

/**
 * Validate a complete network configuration and return a typed copy.
 *
 * The input is never mutated. Optional `horizonUrl` is omitted from the result
 * when absent so the returned object can be used as a drop-in `StellarConfig`.
 *
 * @param config - Usually `RWASDKConfig.stellar`; validated as `unknown` so
 *   callers with untyped JSON get a descriptive error instead of a `TypeError`.
 * @param name - Field path used in error messages (defaults to `config.stellar`).
 * @throws {InvalidParametersError} on the first invalid field, in the order
 *   `network`, `serverUrl`, `passphrase`, `horizonUrl`.
 */
export function validateNetworkConfig(
  config: unknown,
  name = 'config.stellar',
): ValidatedNetworkConfig {
  if (config == null || typeof config !== 'object' || Array.isArray(config)) {
    throw new InvalidParametersError(`${name} is required and must be an object`);
  }

  const candidate = config as Partial<StellarConfig>;
  const network = validateNetworkName(candidate.network, `${name}.network`);
  const serverUrl = validateHttpUrl(candidate.serverUrl, `${name}.serverUrl`);
  validateNonEmptyString(candidate.passphrase, `${name}.passphrase`, 256);
  const passphrase = candidate.passphrase as string;

  const horizonUrl = candidate.horizonUrl === undefined
    ? undefined
    : validateHttpUrl(candidate.horizonUrl, `${name}.horizonUrl`);

  return {
    network,
    serverUrl,
    passphrase,
    ...(horizonUrl === undefined ? {} : { horizonUrl }),
  };
}
