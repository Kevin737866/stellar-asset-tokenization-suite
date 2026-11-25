/**
 * Regression tests for typed contract invocation results (Issue #390).
 */

import {
  ContractError,
  InvalidParametersError,
  NetworkError,
  RWASDKError,
  TransactionError,
  UnauthorizedError,
} from '../errors';
import {
  contractInvocationFailureFromError,
  extractContractErrorNumber,
  invocationFailure,
  invocationSuccess,
  isInvocationFailure,
  isInvocationSuccess,
  toInvocationResult,
  toInvocationResultSync,
  unwrapInvocationResult,
} from '../invocationResult';
import { ErrorCode } from '../types';

describe('invocation result constructors and guards', () => {
  it('success carries the value and passes the success guard', () => {
    const result = invocationSuccess({ hash: 'abc' });
    expect(result).toEqual({ success: true, value: { hash: 'abc' } });
    expect(isInvocationSuccess(result)).toBe(true);
    expect(isInvocationFailure(result)).toBe(false);
  });

  it('failure carries a typed error and passes the failure guard', () => {
    const result = invocationFailure(new UnauthorizedError(), { contractId: 'CABC', functionName: 'mint' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(result.error.kind).toBe('authorization');
    expect(result.error.contractId).toBe('CABC');
    expect(result.error.functionName).toBe('mint');
    expect(isInvocationFailure(result)).toBe(true);
  });
});

describe('contractInvocationFailureFromError', () => {
  it('categorises validation failures', () => {
    const failure = contractInvocationFailureFromError(new InvalidParametersError('bad amount'));
    expect(failure.kind).toBe('validation');
    expect(failure.code).toBe(ErrorCode.INVALID_PARAMETERS);
    expect(failure.message).toBe('bad amount');
    expect(failure.suggestion.length).toBeGreaterThan(0);
  });

  it('categorises authorization failures', () => {
    expect(contractInvocationFailureFromError(new UnauthorizedError()).kind).toBe('authorization');
  });

  it('categorises contract failures and extracts the contract error number', () => {
    const failure = contractInvocationFailureFromError(
      new ContractError('frozen', { contractErrorNumber: 5 })
    );
    expect(failure.kind).toBe('contract');
    expect(failure.contractErrorNumber).toBe(5);
    expect(failure.code).toBe(ErrorCode.ASSET_FROZEN);
  });

  it('extracts a contract error number from an error message', () => {
    expect(extractContractErrorNumber(new Error('ContractError(305)'))).toBe(305);
    expect(contractInvocationFailureFromError(new Error('ContractError(305)')).code)
      .toBe(ErrorCode.BLACKLISTED);
  });

  it('categorises transaction and network failures', () => {
    expect(contractInvocationFailureFromError(new TransactionError()).kind).toBe('transaction');
    expect(contractInvocationFailureFromError(new NetworkError()).kind).toBe('network');
  });

  it('accepts plain objects that carry an ErrorCode', () => {
    const failure = contractInvocationFailureFromError(
      { code: ErrorCode.TIMEOUT, message: 'timed out' },
      { transactionHash: 'hash-1' }
    );
    expect(failure.kind).toBe('network');
    expect(failure.code).toBe(ErrorCode.TIMEOUT);
    expect(failure.transactionHash).toBe('hash-1');
  });

  it('falls back to an unknown failure for unrecognised thrown values', () => {
    const failure = contractInvocationFailureFromError('something went wrong');
    expect(failure.kind).toBe('unknown');
    expect(failure.code).toBe(ErrorCode.CONTRACT_ERROR);
    expect(failure.message).toBe('something went wrong');
  });

  it('preserves operation details on a failed batch', () => {
    const operationResults = [{ label: 'mint', success: false, errorMessage: 'reverted' }];
    const failure = contractInvocationFailureFromError(
      new TransactionError('batch failed', { operationResults })
    );
    expect(failure.details).toEqual({ operationResults });
  });
});

describe('toInvocationResult', () => {
  it('returns a success value without throwing', async () => {
    const result = await toInvocationResult(async () => 42);
    expect(result).toEqual({ success: true, value: 42 });
  });

  it('converts a rejected invocation into a typed failure', async () => {
    const result = await toInvocationResult(
      async () => { throw new UnauthorizedError('not admin'); },
      { functionName: 'freeze' }
    );
    expect(isInvocationFailure(result)).toBe(true);
    if (result.success) throw new Error('expected failure');
    expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    expect(result.error.functionName).toBe('freeze');
  });

  it('supports synchronous operations', () => {
    expect(toInvocationResultSync(() => 7)).toEqual({ success: true, value: 7 });
    const failed = toInvocationResultSync(() => { throw new InvalidParametersError('bad'); });
    expect(isInvocationFailure(failed)).toBe(true);
  });
});

describe('unwrapInvocationResult', () => {
  it('returns the value on success', () => {
    expect(unwrapInvocationResult(invocationSuccess('ok'))).toBe('ok');
  });

  it('rethrows the failure as an RWASDKError', () => {
    const result = invocationFailure(new UnauthorizedError('denied'));
    expect(() => unwrapInvocationResult(result)).toThrow(RWASDKError);
    try {
      unwrapInvocationResult(result);
    } catch (error: any) {
      expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(error.message).toBe('denied');
    }
  });
});
