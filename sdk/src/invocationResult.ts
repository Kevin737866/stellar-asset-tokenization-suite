/**
 * Typed results for contract invocation failures (Issue #390).
 *
 * The SDK's client methods throw `RWASDKError` subclasses by default. The
 * helpers here give callers an explicit, discriminated result instead, so a
 * failed invocation becomes a value that can be logged, serialised or returned
 * through an API without a `try/catch` at every layer.
 *
 * Nothing in this module performs an invocation itself, so it cannot leave
 * partial state changes: it only observes the outcome of an operation that has
 * already run (Stellar transactions themselves are atomic).
 */

import {
  RWASDKError,
  contractErrorToCode,
  getErrorInfo,
} from './errors';
import {
  ErrorCode,
  type ContractInvocationFailure,
  type InvocationContext,
  type InvocationFailure,
  type InvocationResult,
  type InvocationSuccess,
} from './types';

const VALIDATION_CODES = new Set<ErrorCode>([
  ErrorCode.INVALID_PARAMETERS,
  ErrorCode.INVALID_AMOUNT,
  ErrorCode.INVALID_ORDER,
  ErrorCode.INVALID_PROOF,
  ErrorCode.INVALID_SIGNATURE,
  ErrorCode.INVALID_JURISDICTION,
  ErrorCode.INVALID_LOCATION,
  ErrorCode.INVALID_PURITY_GRADE,
  ErrorCode.INVALID_DUE_DATE,
  ErrorCode.INVALID_CREDIT_RATING,
  ErrorCode.INVALID_PROVENANCE,
  ErrorCode.INVALID_VINTAGE,
  ErrorCode.INVALID_REGULATION_FRAMEWORK,
  ErrorCode.INVALID_VERIFICATION_STANDARD,
  ErrorCode.INVALID_DISPUTE_STATUS,
  ErrorCode.INVALID_VERIFICATION_TYPE,
  ErrorCode.BATCH_EMPTY,
  ErrorCode.BATCH_SIZE_EXCEEDED,
]);

const AUTHORIZATION_CODES = new Set<ErrorCode>([
  ErrorCode.UNAUTHORIZED,
  ErrorCode.KYC_REQUIRED,
  ErrorCode.KYC_NOT_VERIFIED,
  ErrorCode.BLACKLISTED,
  ErrorCode.ACCREDITATION_REQUIRED,
  ErrorCode.CUSTODIAN_NOT_WHITELISTED,
  ErrorCode.OP_NOT_AUTHORIZED,
  ErrorCode.TX_BAD_AUTH,
  ErrorCode.UPGRADE_NOT_APPROVED,
  ErrorCode.GOVERNANCE_THRESHOLD_NOT_MET,
]);

const NETWORK_CODES = new Set<ErrorCode>([
  ErrorCode.NETWORK_ERROR,
  ErrorCode.TIMEOUT,
  ErrorCode.ORACLE_OFFLINE,
  ErrorCode.ORACLE_ERROR,
]);

const TRANSACTION_CODES = new Set<ErrorCode>([
  ErrorCode.TRANSACTION_FAILED,
  ErrorCode.SIMULATION_FAILED,
  ErrorCode.BATCH_PARTIAL_FAILURE,
  ...Object.values(ErrorCode).filter((code) => code.startsWith('TX_') || code.startsWith('OP_')),
]);

const ERROR_CODE_VALUES = new Set<string>(Object.values(ErrorCode));

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_VALUES.has(value);
}

/** Choose the failure category for an SDK error code. */
export function invocationFailureKindForCode(code: ErrorCode): ContractInvocationFailure['kind'] {
  if (VALIDATION_CODES.has(code)) return 'validation';
  if (AUTHORIZATION_CODES.has(code)) return 'authorization';
  if (NETWORK_CODES.has(code)) return 'network';
  if (TRANSACTION_CODES.has(code)) return 'transaction';
  if (code === ErrorCode.CONTRACT_ERROR) return 'contract';
  return 'contract';
}

/** Extract a Soroban contract error number from an error, if present. */
export function extractContractErrorNumber(error: unknown): number | undefined {
  const source = error as any;
  const candidates: unknown[] = [
    source?.contractErrorNumber,
    source?.details?.contractErrorNumber,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return Number(candidate);
  }
  const match = messageOf(error).match(/ContractError\((\d+)\)/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Convert any thrown value into a typed {@link ContractInvocationFailure}.
 * This function never throws.
 */
export function contractInvocationFailureFromError(
  error: unknown,
  context: InvocationContext = {}
): ContractInvocationFailure {
  const message = messageOf(error);

  if (error instanceof RWASDKError) {
    const contractErrorNumber = extractContractErrorNumber(error);
    // A generic ContractError carrying a Soroban error number can be made
    // more specific without losing any information from the original error.
    const code = error.code === ErrorCode.CONTRACT_ERROR && contractErrorNumber !== undefined
      ? contractErrorToCode(contractErrorNumber)
      : error.code;
    const info = getErrorInfo(code, contractErrorNumber);
    return {
      ...context,
      kind: invocationFailureKindForCode(code),
      code,
      message: message || info.message,
      suggestion: info.suggestion,
      ...(contractErrorNumber !== undefined ? { contractErrorNumber } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }

  const source = error as any;
  if (source && typeof source === 'object' && isErrorCode(source.code)) {
    const info = getErrorInfo(source.code, extractContractErrorNumber(error));
    return {
      ...context,
      kind: invocationFailureKindForCode(source.code),
      code: source.code,
      message: message || info.message,
      suggestion: info.suggestion,
      ...(source.details !== undefined ? { details: source.details } : {}),
    };
  }

  const contractErrorNumber = extractContractErrorNumber(error);
  const code = contractErrorNumber !== undefined
    ? contractErrorToCode(contractErrorNumber)
    : ErrorCode.CONTRACT_ERROR;
  const info = getErrorInfo(code, contractErrorNumber);

  return {
    ...context,
    kind: contractErrorNumber === undefined ? 'unknown' : 'contract',
    code,
    message: message || info.message,
    suggestion: info.suggestion,
    ...(contractErrorNumber !== undefined ? { contractErrorNumber } : {}),
  };
}

/** Build a successful invocation result. */
export function invocationSuccess<T>(value: T): InvocationSuccess<T> {
  return { success: true, value };
}

/** Build a failed invocation result from any thrown value. */
export function invocationFailure(
  error: unknown,
  context: InvocationContext = {}
): InvocationFailure {
  return { success: false, error: contractInvocationFailureFromError(error, context) };
}

/** Run an async operation, converting any thrown error into a typed failure. */
export async function toInvocationResult<T>(
  operation: () => Promise<T> | T,
  context: InvocationContext = {}
): Promise<InvocationResult<T>> {
  try {
    return invocationSuccess(await operation());
  } catch (error) {
    return invocationFailure(error, context);
  }
}

/** Synchronous counterpart of {@link toInvocationResult}. */
export function toInvocationResultSync<T>(
  operation: () => T,
  context: InvocationContext = {}
): InvocationResult<T> {
  try {
    return invocationSuccess(operation());
  } catch (error) {
    return invocationFailure(error, context);
  }
}

/** Type guard for the failure branch. */
export function isInvocationFailure<T>(result: InvocationResult<T>): result is InvocationFailure {
  return result.success === false;
}

/** Type guard for the success branch. */
export function isInvocationSuccess<T>(result: InvocationResult<T>): result is InvocationSuccess<T> {
  return result.success === true;
}

/**
 * Return the success value or rethrow the failure as an `RWASDKError`.
 * Useful at the boundary where a typed result must become an exception again.
 */
export function unwrapInvocationResult<T>(result: InvocationResult<T>): T {
  if (result.success) return result.value;
  const { error } = result;
  throw new RWASDKError(error.code, error.message, error.details ?? {
    kind: error.kind,
    contractErrorNumber: error.contractErrorNumber,
  });
}
