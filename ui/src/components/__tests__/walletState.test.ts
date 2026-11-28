import {
  DISCONNECTED_WALLET_STATE,
  WalletState,
  canDeployWithWallet,
  executeWalletConnect,
  executeWalletDisconnect,
  formatWalletAddress,
  isValidStellarPublicKey,
  resolveWalletState,
} from '../walletState';

const VALID_PUBLIC_KEY =
  'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

describe('AssetDeployer wallet state and authorization', () => {
  describe('isValidStellarPublicKey', () => {
    it('accepts a valid 56-character Stellar Ed25519 public key', () => {
      expect(isValidStellarPublicKey(VALID_PUBLIC_KEY)).toBe(true);
      expect(isValidStellarPublicKey(`  ${VALID_PUBLIC_KEY}  `)).toBe(true);
    });

    it('rejects empty, non-string, malformed, or wrong-prefix keys', () => {
      expect(isValidStellarPublicKey('')).toBe(false);
      expect(isValidStellarPublicKey('   ')).toBe(false);
      expect(isValidStellarPublicKey(null)).toBe(false);
      expect(isValidStellarPublicKey(undefined)).toBe(false);
      expect(isValidStellarPublicKey(12345)).toBe(false);
      // Wrong prefix (S is secret seed, not public key)
      expect(isValidStellarPublicKey(`S${VALID_PUBLIC_KEY.slice(1)}`)).toBe(false);
      // Too short
      expect(isValidStellarPublicKey(VALID_PUBLIC_KEY.slice(0, 55))).toBe(false);
      // Invalid base32 character ('0', '1', '8', '9' are invalid in Stellar base32)
      expect(isValidStellarPublicKey(`G0${VALID_PUBLIC_KEY.slice(2)}`)).toBe(false);
    });
  });

  describe('formatWalletAddress', () => {
    it('truncates a standard Stellar public key', () => {
      expect(formatWalletAddress(VALID_PUBLIC_KEY)).toBe('GAAZI4...CWN7');
    });

    it('returns short strings unchanged', () => {
      expect(formatWalletAddress('GSHORT')).toBe('GSHORT');
    });
  });

  describe('resolveWalletState', () => {
    it('uses internal state when no controlled props are provided', () => {
      const internal: WalletState = {
        status: 'connected',
        address: VALID_PUBLIC_KEY,
        network: 'TESTNET',
        error: null,
      };
      expect(resolveWalletState({}, internal)).toEqual(internal);
    });

    it('resolves controlled connected state', () => {
      const state = resolveWalletState(
        {
          walletAddress: VALID_PUBLIC_KEY,
          walletNetwork: 'PUBLIC',
          isWalletConnected: true,
        },
        DISCONNECTED_WALLET_STATE
      );
      expect(state).toEqual({
        status: 'connected',
        address: VALID_PUBLIC_KEY,
        network: 'PUBLIC',
        error: null,
      });
    });

    it('resolves controlled disconnected state even when address prop is present if isWalletConnected is false', () => {
      const state = resolveWalletState(
        {
          walletAddress: VALID_PUBLIC_KEY,
          isWalletConnected: false,
        },
        DISCONNECTED_WALLET_STATE
      );
      expect(state).toEqual(DISCONNECTED_WALLET_STATE);
    });

    it('resolves controlled connecting state', () => {
      const state = resolveWalletState(
        { isConnectingWallet: true },
        DISCONNECTED_WALLET_STATE
      );
      expect(state.status).toBe('connecting');
      expect(state.address).toBeNull();
    });

    it('rejects an invalid controlled walletAddress with an error state and no partial address', () => {
      const state = resolveWalletState(
        { walletAddress: 'INVALID_KEY', isWalletConnected: true },
        DISCONNECTED_WALLET_STATE
      );
      expect(state.status).toBe('error');
      expect(state.address).toBeNull();
      expect(state.error).toMatch(/Invalid Stellar wallet public key/i);
    });
  });

  describe('canDeployWithWallet', () => {
    it('allows deployment only when connected with a valid Stellar public key', () => {
      expect(
        canDeployWithWallet({
          status: 'connected',
          address: VALID_PUBLIC_KEY,
          network: 'TESTNET',
          error: null,
        })
      ).toEqual({ allowed: true });
    });

    it('blocks deployment when disconnected', () => {
      const result = canDeployWithWallet(DISCONNECTED_WALLET_STATE);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Connect a Stellar wallet/i);
    });

    it('blocks deployment while connecting', () => {
      const result = canDeployWithWallet({
        status: 'connecting',
        address: null,
        network: null,
        error: null,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/in progress/i);
    });

    it('blocks deployment when wallet is in error state', () => {
      const result = canDeployWithWallet({
        status: 'error',
        address: null,
        network: null,
        error: 'Freighter locked',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Freighter locked');
    });

    it('blocks deployment if status is connected but address is invalid', () => {
      const result = canDeployWithWallet({
        status: 'connected',
        address: 'not-a-key',
        network: 'TESTNET',
        error: null,
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('executeWalletConnect', () => {
    it('connects successfully with a valid public key and network', async () => {
      const state = await executeWalletConnect(async () => ({
        address: VALID_PUBLIC_KEY,
        network: 'TESTNET',
      }));
      expect(state).toEqual({
        status: 'connected',
        address: VALID_PUBLIC_KEY,
        network: 'TESTNET',
        error: null,
      });
    });

    it('connects successfully when connector returns a raw string key', async () => {
      const state = await executeWalletConnect(async () => VALID_PUBLIC_KEY);
      expect(state).toEqual({
        status: 'connected',
        address: VALID_PUBLIC_KEY,
        network: null,
        error: null,
      });
    });

    it('leaves no partial state when connector throws', async () => {
      const state = await executeWalletConnect(async () => {
        throw new Error('User rejected access');
      });
      expect(state).toEqual({
        status: 'error',
        address: null,
        network: null,
        error: 'User rejected access',
      });
    });

    it('leaves no partial state when connector returns an invalid key', async () => {
      const state = await executeWalletConnect(async () => ({
        address: 'BAD_ADDRESS',
        network: 'TESTNET',
      }));
      expect(state.status).toBe('error');
      expect(state.address).toBeNull();
      expect(state.network).toBeNull();
      expect(state.error).toMatch(/invalid Stellar public key/i);
    });

    it('leaves no partial state when connector returns empty/null', async () => {
      const state = await executeWalletConnect(async () => null);
      expect(state.status).toBe('error');
      expect(state.address).toBeNull();
      expect(state.network).toBeNull();
    });
  });

  describe('executeWalletDisconnect', () => {
    const connectedState: WalletState = {
      status: 'connected',
      address: VALID_PUBLIC_KEY,
      network: 'TESTNET',
      error: null,
    };

    it('resets to DISCONNECTED_WALLET_STATE on success', async () => {
      const result = await executeWalletDisconnect(connectedState, async () => {});
      expect(result.error).toBeUndefined();
      expect(result.state).toEqual(DISCONNECTED_WALLET_STATE);
    });

    it('preserves existing state without partial mutation when disconnector throws', async () => {
      const result = await executeWalletDisconnect(connectedState, async () => {
        throw new Error('Disconnect rejected');
      });
      expect(result.error).toBe('Disconnect rejected');
      expect(result.state).toEqual(connectedState);
    });
  });
});
