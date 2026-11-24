import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WALLET_REJECTION_MESSAGE,
  WALLET_REJECTION_TITLE,
  isWalletRejection,
  runWalletRequest,
} from './walletRequest.ts';

const rejectionCases: Array<[string, unknown]> = [
  ['EIP-1193 numeric code', { code: 4001, message: 'User rejected' }],
  ['EIP-1193 string code', { code: '4001', message: 'Request rejected' }],
  ['explicit rejection code', { code: 'USER_REJECTED' }],
  ['wallet rejection code', { code: 'WALLET_REJECTED' }],
  ['named rejection error', { name: 'UserRejectedRequestError', message: 'declined' }],
  ['Freighter "User Rejected"', new Error('User Rejected')],
  ['Freighter "The user rejected this request."', new Error('The user rejected this request.')],
  ['"You rejected the signing request."', new Error('You rejected the signing request.')],
  ['Freighter result error field', { error: { message: 'The user rejected this request.' } }],
  ['"User rejected the request."', new Error('User rejected the request.')],
  ['"User denied transaction signature"', new Error('User denied transaction signature')],
  ['"Request rejected by user"', new Error('Request rejected by user')],
  ['"Wallet request cancelled"', new Error('Wallet request cancelled')],
  ['"Signature request was declined"', new Error('Signature request was declined')],
  ['nested cause', { message: 'signing failed', cause: { code: 4001 } }],
  ['nested error', { message: 'signing failed', error: { message: 'User rejected the request' } }],
];

for (const [label, error] of rejectionCases) {
  test(`isWalletRejection detects ${label}`, () => {
    assert.equal(isWalletRejection(error), true);
  });
}

const nonRejectionCases: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['string error', 'something went wrong'],
  ['generic error', new Error('Operation failed')],
  ['network error', { code: 'NETWORK_ERROR', message: 'fetch failed' }],
  [
    'Horizon bad auth',
    { code: 'TX_BAD_AUTH', message: 'The transaction was rejected due to invalid signatures.' },
  ],
  ['network rejection', new Error('Batch rejected by network')],
  ['insufficient balance', { code: 'INSUFFICIENT_BALANCE' }],
];

for (const [label, error] of nonRejectionCases) {
  test(`isWalletRejection does not classify ${label}`, () => {
    assert.equal(isWalletRejection(error), false);
  });
}

test('runWalletRequest reports success with the resolved value', async () => {
  const outcome = await runWalletRequest(async () => ({ txHash: 'abc' }));

  assert.deepEqual(outcome, { status: 'success', value: { txHash: 'abc' } });
});

test('runWalletRequest distinguishes rejection from failure and keeps the original error', async () => {
  const rejection = Object.assign(new Error('User rejected the request'), { code: 4001 });
  const failure = new Error('Network Error');

  const rejected = await runWalletRequest(async () => {
    throw rejection;
  });
  const failed = await runWalletRequest(async () => {
    throw failure;
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal(failed.status, 'failed');
  if (rejected.status === 'rejected') assert.equal(rejected.error, rejection);
  if (failed.status === 'failed') assert.equal(failed.error, failure);
});

test('runWalletRequest handles boundary throw values without mutating them', async () => {
  const thrown = { code: 'USER_REJECTED', details: ['declined'] };
  const before = JSON.stringify(thrown);

  const outcome = await runWalletRequest(async () => {
    throw thrown;
  });

  assert.equal(outcome.status, 'rejected');
  assert.equal(JSON.stringify(thrown), before);
});

test('a rejected request leaves validated form inputs untouched', async () => {
  const validatedInputs = {
    name: 'Manhattan Office Tower',
    symbol: 'MOT',
    totalSupply: '1000000',
    metadata: { jurisdiction: 'US' },
  };
  const snapshot = structuredClone(validatedInputs);

  const outcome = await runWalletRequest(async () => {
    throw { code: 4001, message: 'User Rejected' };
  });

  assert.equal(outcome.status, 'rejected');
  assert.deepEqual(validatedInputs, snapshot);
  assert.equal(WALLET_REJECTION_TITLE, 'Wallet Request Rejected');
  assert.match(WALLET_REJECTION_MESSAGE, /preserved/i);
});
