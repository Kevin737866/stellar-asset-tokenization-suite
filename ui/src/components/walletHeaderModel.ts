export type StellarNetwork = 'testnet' | 'mainnet' | 'futurenet' | 'standalone';

export const STELLAR_NETWORKS: readonly StellarNetwork[] = [
  'testnet',
  'mainnet',
  'futurenet',
  'standalone',
];

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

const NETWORK_LABELS: Record<StellarNetwork, string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet',
  futurenet: 'Futurenet',
  standalone: 'Standalone',
};

export const NOT_CONNECTED_LABEL = 'Not connected';
export const UNKNOWN_NETWORK_LABEL = 'Unknown network';

function toTrimmedString(value: unknown): string {
  if (typeof value === 'string') return value.trim();

  if (value != null && typeof (value as { toString?: unknown }).toString === 'function') {
    const converted = (value as { toString(): unknown }).toString();
    return typeof converted === 'string' ? converted.trim() : '';
  }

  return '';
}

export function normalizeStellarAccount(value: unknown): string | null {
  const address = toTrimmedString(value);
  return STELLAR_ADDRESS_REGEX.test(address) ? address : null;
}

export function formatStellarAccount(value: unknown): string {
  const address = normalizeStellarAccount(value);
  if (!address) return NOT_CONNECTED_LABEL;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatStellarNetwork(value: unknown): string {
  const network = toTrimmedString(value);
  return STELLAR_NETWORKS.find((candidate) => candidate === network)
    ? NETWORK_LABELS[network as StellarNetwork]
    : UNKNOWN_NETWORK_LABEL;
}
