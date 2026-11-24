import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalAccount,
  isAccountSwitch,
  isDisconnect,
  runWalletDisconnect,
  shouldClearAccountViews,
} from './walletSession.ts';

test('canonicalAccount treats blank addresses as disconnected and preserves valid ones', () => {
  assert.equal(canonicalAccount(null), null);
  assert.equal(canonicalAccount(undefined), null);
  assert.equal(canonicalAccount(''), null);
  assert.equal(canonicalAccount('   '), null);
  assert.equal(canonicalAccount('  GABC123  '), 'GABC123');
  assert.equal(canonicalAccount('gabc123'), 'gabc123');
});

test('disconnect and account switch are distinguished from connect and no-op', () => {
  assert.equal(isDisconnect('GOLD', null), true);
  assert.equal(isDisconnect('GOLD', '   '), true);
  assert.equal(isDisconnect(null, 'GOLD'), false);
  assert.equal(isDisconnect('GOLD', 'GOLD'), false);

  assert.equal(isAccountSwitch('GOLD', 'GNEW'), true);
  assert.equal(isAccountSwitch('GOLD', 'GOLD'), false);
  assert.equal(isAccountSwitch(null, 'GOLD'), false);

  assert.equal(shouldClearAccountViews('GOLD', null), true);
  assert.equal(shouldClearAccountViews('GOLD', 'GNEW'), true);
  assert.equal(shouldClearAccountViews(null, 'GOLD'), false);
  assert.equal(shouldClearAccountViews(null, null), false);
  assert.equal(shouldClearAccountViews('GOLD', 'GOLD'), false);
});

test('runWalletDisconnect skips the wallet call without a connected account', async () => {
  let calls = 0;
  const outcome = await runWalletDisconnect({
    account: '   ',
    inFlight: false,
    disconnect: () => {
      calls += 1;
    },
  });

  assert.deepEqual(outcome, { status: 'skipped', reason: 'no-account' });
  assert.equal(calls, 0);
});

test('runWalletDisconnect skips duplicate in-flight requests', async () => {
  let calls = 0;
  const outcome = await runWalletDisconnect({
    account: 'GOLD',
    inFlight: true,
    disconnect: () => {
      calls += 1;
    },
  });

  assert.deepEqual(outcome, { status: 'skipped', reason: 'already-disconnecting' });
  assert.equal(calls, 0);
});

test('runWalletDisconnect reports success and preserves the original error on failure', async () => {
  const success = await runWalletDisconnect({
    account: 'GOLD',
    inFlight: false,
    disconnect: () => undefined,
  });
  assert.deepEqual(success, { status: 'success' });

  const failure = new Error('wallet adapter unavailable');
  const failed = await runWalletDisconnect({
    account: 'GOLD',
    inFlight: false,
    disconnect: async () => {
      throw failure;
    },
  });

  assert.equal(failed.status, 'failed');
  if (failed.status === 'failed') assert.equal(failed.error, failure);
});

test('runWalletDisconnect handles boundary throw values without touching account state', async () => {
  const account = { address: 'GOLD' };
  const snapshot = JSON.stringify(account);
  const thrown = 'declined';

  const outcome = await runWalletDisconnect({
    account: 'GOLD',
    inFlight: false,
    disconnect: () => {
      throw thrown;
    },
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status === 'failed') assert.equal(outcome.error, thrown);
  assert.equal(JSON.stringify(account), snapshot);
});
