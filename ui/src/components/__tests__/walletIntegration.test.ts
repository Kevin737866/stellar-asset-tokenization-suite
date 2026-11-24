import {
  createDisconnectedWalletState,
  getExpectedNetworkPassphrase,
  isValidStellarPublicKey,
  STELLAR_NETWORK_PASSPHRASES,
  validateSigningRequest,
  validateWalletConnection,
  WalletConnectionState,
} from '../walletIntegration';

const VALID_PUBLIC_KEY = 'G' + 'A'.repeat(55);

describe('walletIntegration', () => {
  it('creates a clean disconnected wallet state', () => {
    expect(createDisconnectedWalletState()).toEqual({
      connected: false,
      publicKey: null,
      network: null,
    });
  });

  it('returns canonical Stellar network passphrases', () => {
    expect(getExpectedNetworkPassphrase('PUBLIC')).toBe(
      STELLAR_NETWORK_PASSPHRASES.PUBLIC
    );
    expect(getExpectedNetworkPassphrase('TESTNET')).toBe(
      STELLAR_NETWORK_PASSPHRASES.TESTNET
    );
    expect(getExpectedNetworkPassphrase('FUTURENET')).toBe(
      STELLAR_NETWORK_PASSPHRASES.FUTURENET
    );
  });

  it('validates Stellar Ed25519 public keys', () => {
    expect(isValidStellarPublicKey(VALID_PUBLIC_KEY)).toBe(true);
    expect(isValidStellarPublicKey('')).toBe(false);
    expect(isValidStellarPublicKey('S' + 'A'.repeat(55))).toBe(false);
    expect(isValidStellarPublicKey('G' + 'A'.repeat(54))).toBe(false);
    expect(isValidStellarPublicKey('G' + '1'.repeat(55))).toBe(false);
    expect(isValidStellarPublicKey(null)).toBe(false);
  });

  it('accepts a valid connected wallet on the expected network', () => {
    const state: WalletConnectionState = {
      connected: true,
      publicKey: VALID_PUBLIC_KEY,
      network: 'TESTNET',
    };

    expect(validateWalletConnection(state, 'TESTNET')).toEqual({ ok: true });
  });

  it('rejects disconnected, missing, invalid-key, and mismatched-network wallet states without mutating input', () => {
    const disconnected: WalletConnectionState = createDisconnectedWalletState();
    const disconnectedSnapshot = { ...disconnected };
    expect(validateWalletConnection(disconnected, 'TESTNET')).toMatchObject({
      ok: false,
      code: 'WALLET_NOT_CONNECTED',
    });
    expect(disconnected).toEqual(disconnectedSnapshot);

    expect(validateWalletConnection(null, 'TESTNET')).toMatchObject({
      ok: false,
      code: 'WALLET_NOT_CONNECTED',
    });

    const invalidKey: WalletConnectionState = {
      connected: true,
      publicKey: 'INVALID_KEY',
      network: 'TESTNET',
    };
    expect(validateWalletConnection(invalidKey, 'TESTNET')).toMatchObject({
      ok: false,
      code: 'INVALID_PUBLIC_KEY',
    });

    const wrongNetwork: WalletConnectionState = {
      connected: true,
      publicKey: VALID_PUBLIC_KEY,
      network: 'PUBLIC',
    };
    expect(validateWalletConnection(wrongNetwork, 'TESTNET')).toMatchObject({
      ok: false,
      code: 'NETWORK_MISMATCH',
    });
  });

  it('validates signing requests for success and invalid/unauthorized failure cases', () => {
    const validState: WalletConnectionState = {
      connected: true,
      publicKey: VALID_PUBLIC_KEY,
      network: 'TESTNET',
    };

    expect(
      validateSigningRequest(validState, {
        xdr: 'AAAAAgAAAABexampleXdr==',
        expectedNetwork: 'TESTNET',
        networkPassphrase: STELLAR_NETWORK_PASSPHRASES.TESTNET,
      })
    ).toEqual({ ok: true });

    expect(
      validateSigningRequest(validState, {
        xdr: '   ',
        expectedNetwork: 'TESTNET',
      })
    ).toMatchObject({
      ok: false,
      code: 'INVALID_XDR',
    });

    expect(
      validateSigningRequest(validState, {
        xdr: 'AAAAAgAAAABexampleXdr==',
        expectedNetwork: 'TESTNET',
        networkPassphrase: STELLAR_NETWORK_PASSPHRASES.PUBLIC,
      })
    ).toMatchObject({
      ok: false,
      code: 'INVALID_NETWORK_PASSPHRASE',
    });

    expect(
      validateSigningRequest(createDisconnectedWalletState(), {
        xdr: 'AAAAAgAAAABexampleXdr==',
        expectedNetwork: 'TESTNET',
      })
    ).toMatchObject({
      ok: false,
      code: 'WALLET_NOT_CONNECTED',
    });
  });
});
