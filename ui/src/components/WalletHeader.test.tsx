import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header } from './Header';
import { WalletHeader } from './WalletHeader';
import {
  formatStellarAccount,
  formatStellarNetwork,
  normalizeStellarAccount,
  NOT_CONNECTED_LABEL,
  STELLAR_NETWORKS,
  UNKNOWN_NETWORK_LABEL,
} from './walletHeaderModel';

const VALID_ACCOUNT = `G${'A'.repeat(54)}B`;

describe('WalletHeader', () => {
  it('renders the active account and selected network', () => {
    const markup = renderToStaticMarkup(
      <WalletHeader account={VALID_ACCOUNT} network="testnet" />
    );

    expect(markup).toContain('aria-label="Stellar wallet header"');
    expect(markup).toContain('aria-label="Active Stellar account"');
    expect(markup).toContain('aria-label="Selected Stellar network"');
    expect(markup).toContain('Account:');
    expect(markup).toContain('GAAAAA...AAAB');
    expect(markup).toContain(`title="${VALID_ACCOUNT}"`);
    expect(markup).toContain('Network:');
    expect(markup).toContain('Testnet');
    expect(markup).toContain('data-status="connected"');
  });

  it('renders a disconnected state without exposing an invalid account', () => {
    const markup = renderToStaticMarkup(
      <WalletHeader account="not-an-address" network="mainnet" />
    );

    expect(markup).toContain(NOT_CONNECTED_LABEL);
    expect(markup).toContain('data-status="not connected"');
    expect(markup).not.toContain('not-an-address');
    expect(markup).toContain('Mainnet');
  });

  it('renders an unknown network without exposing unrecognized input', () => {
    const markup = renderToStaticMarkup(
      <WalletHeader account={VALID_ACCOUNT} network="localnet" />
    );

    expect(markup).toContain(UNKNOWN_NETWORK_LABEL);
    expect(markup).not.toContain('localnet');
    expect(markup).toContain('GAAAAA...AAAB');
  });

  it('preserves a valid account when the network is null', () => {
    const markup = renderToStaticMarkup(<WalletHeader account={VALID_ACCOUNT} network={null} />);

    expect(markup).toContain('GAAAAA...AAAB');
    expect(markup).toContain(UNKNOWN_NETWORK_LABEL);
  });

  it('exposes the same component through the Header alias', () => {
    expect(Header).toBe(WalletHeader);
  });
});

describe('walletHeaderModel', () => {
  it('accepts a valid Stellar public key with surrounding whitespace', () => {
    expect(normalizeStellarAccount(`  ${VALID_ACCOUNT}  `)).toBe(VALID_ACCOUNT);
    expect(formatStellarAccount(`  ${VALID_ACCOUNT}  `)).toBe('GAAAAA...AAAB');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['short', VALID_ACCOUNT.slice(0, -1)],
    ['long', `${VALID_ACCOUNT}C`],
    ['lowercase', VALID_ACCOUNT.toLowerCase()],
    ['contract id', `C${VALID_ACCOUNT.slice(1)}`],
  ])('rejects %s account input', (_label, value) => {
    expect(normalizeStellarAccount(value)).toBeNull();
    expect(formatStellarAccount(value)).toBe(NOT_CONNECTED_LABEL);
  });

  it.each(STELLAR_NETWORKS)('formats the %s network label', (network) => {
    expect(formatStellarNetwork(network)).toBe(network[0].toUpperCase() + network.slice(1));
  });

  it('trims network input and rejects unrecognized values', () => {
    expect(formatStellarNetwork('  futurenet  ')).toBe('Futurenet');
    expect(formatStellarNetwork('Testnet')).toBe(UNKNOWN_NETWORK_LABEL);
    expect(formatStellarNetwork('')).toBe(UNKNOWN_NETWORK_LABEL);
    expect(formatStellarNetwork(undefined)).toBe(UNKNOWN_NETWORK_LABEL);
  });
});
