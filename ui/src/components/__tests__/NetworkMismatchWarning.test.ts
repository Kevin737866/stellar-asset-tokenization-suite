import {
  evaluateNetworkMismatch,
  formatNetworkLabel,
  guardTransactionSigning,
  NetworkMismatchError,
  normalizeStellarNetwork,
  STELLAR_NETWORK_PASSPHRASES,
} from '../NetworkMismatchWarning';

describe('NetworkMismatchWarning helpers', () => {
  describe('normalizeStellarNetwork', () => {
    it('normalizes known Stellar network names and aliases', () => {
      expect(normalizeStellarNetwork('testnet')).toBe('TESTNET');
      expect(normalizeStellarNetwork('  PUBLIC  ')).toBe('PUBLIC');
      expect(normalizeStellarNetwork('mainnet')).toBe('PUBLIC');
      expect(normalizeStellarNetwork('pubnet')).toBe('PUBLIC');
      expect(normalizeStellarNetwork('futurenet')).toBe('FUTURENET');
      expect(normalizeStellarNetwork('local')).toBe('STANDALONE');
    });

    it('normalizes known Stellar network passphrases', () => {
      expect(normalizeStellarNetwork(STELLAR_NETWORK_PASSPHRASES.PUBLIC)).toBe('PUBLIC');
      expect(normalizeStellarNetwork(STELLAR_NETWORK_PASSPHRASES.TESTNET)).toBe('TESTNET');
      expect(normalizeStellarNetwork(STELLAR_NETWORK_PASSPHRASES.FUTURENET)).toBe('FUTURENET');
      expect(normalizeStellarNetwork(STELLAR_NETWORK_PASSPHRASES.STANDALONE)).toBe('STANDALONE');
    });

    it('returns null for empty or missing inputs', () => {
      expect(normalizeStellarNetwork(undefined)).toBeNull();
      expect(normalizeStellarNetwork(null)).toBeNull();
      expect(normalizeStellarNetwork('')).toBeNull();
      expect(normalizeStellarNetwork('   ')).toBeNull();
    });
  });

  describe('formatNetworkLabel', () => {
    it('formats known networks and falls back gracefully', () => {
      expect(formatNetworkLabel('PUBLIC')).toBe('Stellar Mainnet (PUBLIC)');
      expect(formatNetworkLabel('testnet')).toBe('Stellar Testnet (TESTNET)');
      expect(formatNetworkLabel('Custom Private Net')).toBe('Custom Private Net');
      expect(formatNetworkLabel('')).toBe('Unknown Network');
    });
  });

  describe('evaluateNetworkMismatch', () => {
    it('allows signing when wallet and expected networks match (including aliases)', () => {
      const result = evaluateNetworkMismatch({
        expectedNetwork: 'mainnet',
        walletNetwork: STELLAR_NETWORK_PASSPHRASES.PUBLIC,
      });

      expect(result.status).toBe('match');
      expect(result.isMismatch).toBe(false);
      expect(result.canSign).toBe(true);
      expect(result.expectedNetwork).toBe('PUBLIC');
      expect(result.walletNetwork).toBe('PUBLIC');
    });

    it('detects mismatch between Mainnet and Testnet', () => {
      const result = evaluateNetworkMismatch({
        expectedNetwork: 'TESTNET',
        walletNetwork: 'PUBLIC',
      });

      expect(result.status).toBe('mismatch');
      expect(result.isMismatch).toBe(true);
      expect(result.canSign).toBe(false);
      expect(result.reason).toContain('Stellar Mainnet (PUBLIC)');
      expect(result.reason).toContain('Stellar Testnet (TESTNET)');
    });

    it('detects mismatch when passphrases differ even with same custom network name', () => {
      const result = evaluateNetworkMismatch({
        expectedNetwork: 'CUSTOM',
        walletNetwork: 'CUSTOM',
        expectedPassphrase: 'Custom Net A',
        walletPassphrase: 'Custom Net B',
      });

      expect(result.status).toBe('mismatch');
      expect(result.isMismatch).toBe(true);
      expect(result.canSign).toBe(false);
    });

    it('blocks signing when wallet network is unavailable', () => {
      const result = evaluateNetworkMismatch({
        expectedNetwork: 'TESTNET',
        walletNetwork: null,
      });

      expect(result.status).toBe('wallet_unavailable');
      expect(result.isMismatch).toBe(true);
      expect(result.canSign).toBe(false);
    });

    it('blocks signing when expected network configuration is missing or blank', () => {
      const result = evaluateNetworkMismatch({
        expectedNetwork: '   ',
        walletNetwork: 'TESTNET',
      });

      expect(result.status).toBe('invalid_config');
      expect(result.isMismatch).toBe(true);
      expect(result.canSign).toBe(false);
    });
  });

  describe('guardTransactionSigning', () => {
    it('invokes signTransaction when networks match', async () => {
      const signFn = jest.fn().mockResolvedValue({ signedXdr: 'AAAA' });

      const result = await guardTransactionSigning(
        { expectedNetwork: 'TESTNET', walletNetwork: 'TESTNET' },
        signFn
      );

      expect(signFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ signedXdr: 'AAAA' });
    });

    it('throws NetworkMismatchError and does not invoke signTransaction on mismatch', async () => {
      const signFn = jest.fn().mockResolvedValue({ signedXdr: 'AAAA' });

      await expect(
        guardTransactionSigning(
          { expectedNetwork: 'TESTNET', walletNetwork: 'PUBLIC' },
          signFn
        )
      ).rejects.toMatchObject({
        name: 'NetworkMismatchError',
        code: 'NETWORK_MISMATCH',
        expectedNetwork: 'TESTNET',
        walletNetwork: 'PUBLIC',
      });

      expect(signFn).not.toHaveBeenCalled();
    });

    it('throws WALLET_NETWORK_UNAVAILABLE when wallet network is missing', async () => {
      const signFn = jest.fn();

      await expect(
        guardTransactionSigning(
          { expectedNetwork: 'PUBLIC', walletNetwork: undefined },
          signFn
        )
      ).rejects.toBeInstanceOf(NetworkMismatchError);

      expect(signFn).not.toHaveBeenCalled();
    });

    it('throws INVALID_NETWORK_CONFIG when expected network is missing', async () => {
      const signFn = jest.fn();

      await expect(
        guardTransactionSigning(
          { expectedNetwork: '', walletNetwork: 'PUBLIC' },
          signFn
        )
      ).rejects.toMatchObject({
        code: 'INVALID_NETWORK_CONFIG',
      });

      expect(signFn).not.toHaveBeenCalled();
    });
  });
});
