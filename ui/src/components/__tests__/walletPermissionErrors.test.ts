import {
  explainWalletPermissionError,
  isWalletPermissionError,
} from '../walletPermissionErrors';

describe('explainWalletPermissionError', () => {
  it('explains user-rejected wallet requests by code and message', () => {
    const byCode = explainWalletPermissionError({ code: 4001 });
    expect(byCode).not.toBeNull();
    expect(byCode?.kind).toBe('user_rejected');
    expect(byCode?.title).toBe('Wallet Permission Denied');
    expect(byCode?.recoverySteps.length).toBeGreaterThanOrEqual(2);
    expect(byCode?.retryable).toBe(true);

    const byMessage = explainWalletPermissionError(
      new Error('User declined access in Freighter')
    );
    expect(byMessage?.kind).toBe('user_rejected');
  });

  it('explains unauthorized / not-connected wallet access errors', () => {
    const byCode = explainWalletPermissionError({ code: 'WALLET_NOT_CONNECTED' });
    expect(byCode?.kind).toBe('not_connected');
    expect(byCode?.title).toBe('Wallet Access Not Granted');
    expect(byCode?.recoverySteps.length).toBeGreaterThanOrEqual(2);

    const byString = explainWalletPermissionError('Site not authorized to access account');
    expect(byString?.kind).toBe('not_connected');
  });

  it('explains locked wallet errors', () => {
    const result = explainWalletPermissionError({
      code: 'WALLET_LOCKED',
      message: 'Please unlock your wallet',
    });
    expect(result?.kind).toBe('wallet_locked');
    expect(result?.title).toBe('Wallet Locked');
    expect(result?.recoverySteps.some((step) => step.toLowerCase().includes('unlock'))).toBe(true);
  });

  it('explains missing wallet extension errors', () => {
    const result = explainWalletPermissionError(
      new Error('Freighter is not installed in this browser')
    );
    expect(result?.kind).toBe('wallet_not_installed');
    expect(result?.title).toBe('Wallet Extension Not Found');
    expect(result?.recoverySteps.some((step) => step.toLowerCase().includes('install'))).toBe(true);
  });

  it('explains network mismatch errors', () => {
    const result = explainWalletPermissionError({ code: 'NETWORK_MISMATCH' });
    expect(result?.kind).toBe('network_mismatch');
    expect(result?.title).toBe('Wallet Network Mismatch');
    expect(result?.recoverySteps.some((step) => step.toLowerCase().includes('switch'))).toBe(true);
  });

  it('explains transaction bad auth errors with actionable recovery steps', () => {
    const result = explainWalletPermissionError({ code: 'TX_BAD_AUTH' });
    expect(result?.kind).toBe('bad_auth');
    expect(result?.title).toBe('Transaction Authorization Failed');
    expect(result?.recoverySteps.length).toBeGreaterThanOrEqual(2);
  });

  it('returns null for non-wallet errors and invalid/empty inputs', () => {
    expect(explainWalletPermissionError(null)).toBeNull();
    expect(explainWalletPermissionError(undefined)).toBeNull();
    expect(explainWalletPermissionError('')).toBeNull();
    expect(explainWalletPermissionError('   ')).toBeNull();
    expect(explainWalletPermissionError(42)).toBeNull();
    expect(explainWalletPermissionError({})).toBeNull();
    expect(explainWalletPermissionError({ code: 'OP_UNDERFUNDED' })).toBeNull();
    expect(
      explainWalletPermissionError(new Error('Network timeout while fetching ledger'))
    ).toBeNull();
  });

  it('correctly identifies wallet permission errors via isWalletPermissionError', () => {
    expect(isWalletPermissionError({ code: 'USER_DECLINED' })).toBe(true);
    expect(isWalletPermissionError({ code: 'INSUFFICIENT_LIQUIDITY' })).toBe(false);
    expect(isWalletPermissionError(null)).toBe(false);
  });
});
