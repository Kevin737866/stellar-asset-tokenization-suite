/**
 * Unit tests for error classes and Horizon error parsing.
 * Issue #220: SDK unit tests achieving 80%+ code coverage.
 */

import {
  RWASDKError,
  NetworkError,
  TransactionError,
  InsufficientBalanceError,
  ComplianceError,
  UnauthorizedError,
  InvalidParametersError,
  TimeoutError,
  ContractError,
  OracleError,
  AssetNotFoundError,
  OrderNotFoundError,
  DistributionNotFoundError,
  ProofNotFoundError,
  KYCNotVerifiedError,
  AssetFrozenError,
  TransferPausedError,
  CustodyError,
  VerificationFailedError,
  InsufficientBondError,
  HorizonError,
  parseHorizonError,
  describeHorizonError,
  describeContractError,
  contractErrorToCode,
  fromContractError,
  ERROR_DESCRIPTIONS
} from '../errors';
import { ErrorCode } from '../types';

describe('RWASDKError base class', () => {
  it('constructs with code and message', () => {
    const err = new RWASDKError(ErrorCode.NETWORK_ERROR, 'test message');
    expect(err.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(err.message).toBe('test message');
    expect(err.name).toBe('RWASDKError');
  });

  it('constructs with details', () => {
    const details = { foo: 'bar' };
    const err = new RWASDKError(ErrorCode.TIMEOUT, 'msg', details);
    expect(err.details).toEqual(details);
  });

  it('toJSON returns expected shape', () => {
    const err = new RWASDKError(ErrorCode.NETWORK_ERROR, 'test');
    const json = err.toJSON();
    expect(json.name).toBe('RWASDKError');
    expect(json.code).toBe(ErrorCode.NETWORK_ERROR);
    expect(json.message).toBe('test');
  });
});

describe('Specialized error classes', () => {
  it('NetworkError has correct code', () => {
    const err = new NetworkError();
    expect(err.code).toBe(ErrorCode.NETWORK_ERROR);
  });

  it('TransactionError has correct code', () => {
    const err = new TransactionError();
    expect(err.code).toBe(ErrorCode.TRANSACTION_FAILED);
  });

  it('InsufficientBalanceError has correct code', () => {
    const err = new InsufficientBalanceError();
    expect(err.code).toBe(ErrorCode.INSUFFICIENT_BALANCE);
  });

  it('ComplianceError has correct code', () => {
    const err = new ComplianceError();
    expect(err.code).toBe(ErrorCode.COMPLIANCE_FAILED);
  });

  it('UnauthorizedError has correct code', () => {
    const err = new UnauthorizedError();
    expect(err.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('InvalidParametersError has correct code', () => {
    const err = new InvalidParametersError();
    expect(err.code).toBe(ErrorCode.INVALID_PARAMETERS);
  });

  it('TimeoutError has correct code', () => {
    const err = new TimeoutError();
    expect(err.code).toBe(ErrorCode.TIMEOUT);
  });

  it('ContractError has correct code', () => {
    const err = new ContractError();
    expect(err.code).toBe(ErrorCode.CONTRACT_ERROR);
  });

  it('OracleError has correct code', () => {
    const err = new OracleError();
    expect(err.code).toBe(ErrorCode.ORACLE_ERROR);
  });

  it('AssetNotFoundError has correct code', () => {
    const err = new AssetNotFoundError();
    expect(err.code).toBe(ErrorCode.ASSET_NOT_FOUND);
  });

  it('OrderNotFoundError has correct code', () => {
    const err = new OrderNotFoundError();
    expect(err.code).toBe(ErrorCode.ORDER_NOT_FOUND);
  });

  it('DistributionNotFoundError has correct code', () => {
    const err = new DistributionNotFoundError();
    expect(err.code).toBe(ErrorCode.DISTRIBUTION_NOT_FOUND);
  });

  it('ProofNotFoundError has correct code', () => {
    const err = new ProofNotFoundError();
    expect(err.code).toBe(ErrorCode.PROOF_NOT_FOUND);
  });

  it('KYCNotVerifiedError has correct code', () => {
    const err = new KYCNotVerifiedError();
    expect(err.code).toBe(ErrorCode.KYC_NOT_VERIFIED);
  });

  it('AssetFrozenError has correct code', () => {
    const err = new AssetFrozenError();
    expect(err.code).toBe(ErrorCode.ASSET_FROZEN);
  });

  it('TransferPausedError has correct code', () => {
    const err = new TransferPausedError();
    expect(err.code).toBe(ErrorCode.TRANSFER_PAUSED);
  });

  it('CustodyError has correct code', () => {
    const err = new CustodyError();
    expect(err.code).toBe(ErrorCode.CONTRACT_ERROR);
  });

  it('VerificationFailedError has correct code', () => {
    const err = new VerificationFailedError();
    expect(err.code).toBe(ErrorCode.VERIFICATION_FAILED);
  });

  it('InsufficientBondError has correct code', () => {
    const err = new InsufficientBondError();
    expect(err.code).toBe(ErrorCode.INSUFFICIENT_BOND);
  });

  it('all errors accept custom messages', () => {
    expect(new NetworkError('custom').message).toBe('custom');
    expect(new TransactionError('custom').message).toBe('custom');
    expect(new InvalidParametersError('custom').message).toBe('custom');
    expect(new UnauthorizedError('custom').message).toBe('custom');
    expect(new TimeoutError('custom').message).toBe('custom');
  });
});

describe('HorizonError', () => {
  it('constructs with basic params', () => {
    const err = new HorizonError(ErrorCode.TRANSACTION_FAILED, 'Horizon error');
    expect(err.code).toBe(ErrorCode.TRANSACTION_FAILED);
    expect(err.message).toBe('Horizon error');
  });

  it('constructs with optional fields', () => {
    const err = new HorizonError(ErrorCode.TX_BAD_AUTH, 'Bad auth', {
      failedOperationIndex: 2,
      rawXDR: 'AAAA...',
      stellarResultCode: 'tx_bad_auth',
    });
    expect(err.failedOperationIndex).toBe(2);
    expect(err.rawXDR).toBe('AAAA...');
    expect(err.stellarResultCode).toBe('tx_bad_auth');
  });

  it('fromHorizonResponse maps 400-level errors with [Request Error] prefix', () => {
    const body = {
      title: 'Transaction Failed',
      detail: 'op_underfunded',
      extras: {
        result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] }
      }
    };
    const err = HorizonError.fromHorizonResponse(400, body);
    expect(err.message).toContain('[Request Error]');
  });

  it('fromHorizonResponse maps 500-level errors with [Server Error] prefix', () => {
    const body = {
      title: 'Internal Error',
      detail: 'Server error',
      extras: { result_codes: { transaction: 'tx_failed', operations: [] } }
    };
    const err = HorizonError.fromHorizonResponse(500, body);
    expect(err.message).toContain('[Server Error]');
  });

  it('fromHorizonResponse maps op_underfunded', () => {
    const body = {
      title: 'Transaction Failed',
      detail: '',
      extras: {
        result_codes: { transaction: 'tx_failed', operations: ['op_underfunded'] }
      }
    };
    const err = HorizonError.fromHorizonResponse(400, body);
    expect(err.code).toBe(ErrorCode.OP_UNDERFUNDED);
  });
});

describe('parseHorizonError', () => {
  it('parses transaction-level result codes', () => {
    const body = {
      title: 'Transaction Failed',
      detail: 'Insufficient fee',
      extras: {
        result_codes: { transaction: 'tx_insufficient_fee', operations: [] }
      }
    };
    const parsed = parseHorizonError(body);
    expect(parsed.errorCode).toBe(ErrorCode.TX_INSUFFICIENT_FEE);
  });

  it('parses operation-level result codes', () => {
    const body = {
      title: 'Op Failed',
      detail: '',
      extras: {
        result_codes: { transaction: 'tx_failed', operations: ['op_success', 'op_underfunded'] }
      }
    };
    const parsed = parseHorizonError(body);
    expect(parsed.errorCode).toBe(ErrorCode.OP_UNDERFUNDED);
    expect(parsed.failedOperationIndex).toBe(1);
  });

  it('skips op_success and op_inner when finding first failure', () => {
    const body = {
      extras: {
        result_codes: {
          transaction: 'tx_failed',
          operations: ['op_success', 'op_inner', 'op_no_trust']
        }
      }
    };
    const parsed = parseHorizonError(body);
    expect(parsed.errorCode).toBe(ErrorCode.OP_NO_TRUST);
    expect(parsed.failedOperationIndex).toBe(2);
  });

  it('handles empty body gracefully', () => {
    const parsed = parseHorizonError({});
    expect(parsed.errorCode).toBe(ErrorCode.TRANSACTION_FAILED);
    expect(parsed.message).toBeDefined();
  });

  it('handles null body gracefully', () => {
    const parsed = parseHorizonError(null);
    expect(parsed.errorCode).toBe(ErrorCode.TRANSACTION_FAILED);
  });

  it('extracts resultXDR when present', () => {
    const body = {
      extras: {
        result_xdr: 'AAAAA...',
        result_codes: { transaction: 'tx_failed', operations: [] }
      }
    };
    const parsed = parseHorizonError(body);
    expect(parsed.rawXDR).toBe('AAAAA...');
  });

  it('extracts stellarResultCode', () => {
    const body = {
      extras: {
        result_codes: { transaction: 'tx_too_late', operations: [] }
      }
    };
    const parsed = parseHorizonError(body);
    expect(parsed.stellarResultCode).toBe('tx_too_late');
  });

  it('falls back to first op code for stellarResultCode when no tx code', () => {
    const body = {
      extras: {
        result_codes: { operations: ['op_line_full'] }
      }
    };
    const parsed = parseHorizonError(body);
    expect(parsed.stellarResultCode).toBe('op_line_full');
  });
});

describe('describeHorizonError', () => {
  it('returns human-readable error with operation index', () => {
    const body = {
      extras: {
        result_codes: { transaction: 'tx_failed', operations: ['op_success', 'op_underfunded'] }
      }
    };
    const desc = describeHorizonError(body);
    expect(desc).toContain('operation #1');
  });

  it('returns base message without operation index when none', () => {
    const body = {
      extras: {
        result_codes: { transaction: 'tx_insufficient_fee', operations: [] }
      }
    };
    const desc = describeHorizonError(body);
    expect(desc).toBeDefined();
    expect(desc).not.toContain('operation');
  });
});

describe('contractErrorToCode', () => {
  it('maps RWATokenError numbers correctly', () => {
    expect(contractErrorToCode(1)).toBe(ErrorCode.TOKEN_ALREADY_INITIALIZED);
    expect(contractErrorToCode(4)).toBe(ErrorCode.TRANSFER_PAUSED);
    expect(contractErrorToCode(6)).toBe(ErrorCode.KYC_NOT_VERIFIED);
  });

  it('maps AssetFactoryError numbers correctly', () => {
    expect(contractErrorToCode(201)).toBe(ErrorCode.FACTORY_ALREADY_INITIALIZED);
    expect(contractErrorToCode(204)).toBe(ErrorCode.ASSET_NOT_FOUND);
    expect(contractErrorToCode(209)).toBe(ErrorCode.GOVERNANCE_THRESHOLD_NOT_MET);
  });

  it('maps ComplianceRegistryError numbers correctly', () => {
    expect(contractErrorToCode(301)).toBe(ErrorCode.REGISTRY_ALREADY_INITIALIZED);
    expect(contractErrorToCode(305)).toBe(ErrorCode.BLACKLISTED);
    expect(contractErrorToCode(308)).toBe(ErrorCode.TRANSFER_LIMIT_EXCEEDED);
  });

  it('maps DividendError numbers correctly', () => {
    expect(contractErrorToCode(401)).toBe(ErrorCode.DIVIDEND_ALREADY_INITIALIZED);
    expect(contractErrorToCode(407)).toBe(ErrorCode.ALREADY_CLAIMED);
    expect(contractErrorToCode(414)).toBe(ErrorCode.NO_DIVIDEND_AVAILABLE);
  });

  it('maps MarketError numbers correctly', () => {
    expect(contractErrorToCode(501)).toBe(ErrorCode.MARKET_ALREADY_INITIALIZED);
    expect(contractErrorToCode(503)).toBe(ErrorCode.ORDER_NOT_FOUND);
    expect(contractErrorToCode(507)).toBe(ErrorCode.CIRCUIT_BREAKER_TRIPPED);
  });

  it('maps CustodyError numbers correctly', () => {
    expect(contractErrorToCode(601)).toBe(ErrorCode.CUSTODY_ALREADY_INITIALIZED);
    expect(contractErrorToCode(603)).toBe(ErrorCode.INVALID_PROOF);
    expect(contractErrorToCode(622)).toBe(ErrorCode.ORACLE_NOT_FOUND);
  });

  it('maps AuthError numbers correctly', () => {
    expect(contractErrorToCode(101)).toBe(ErrorCode.UNAUTHORIZED);
  });

  it('maps AssetClassHandler errors correctly', () => {
    expect(contractErrorToCode(701)).toBe(ErrorCode.INVALID_LOCATION);
    expect(contractErrorToCode(704)).toBe(ErrorCode.INVALID_CREDIT_RATING);
  });

  it('defaults to CONTRACT_ERROR for unknown numbers', () => {
    expect(contractErrorToCode(9999)).toBe(ErrorCode.CONTRACT_ERROR);
    expect(contractErrorToCode(0)).toBe(ErrorCode.CONTRACT_ERROR);
  });
});

describe('describeContractError', () => {
  it('returns description for known error numbers', () => {
    const desc = describeContractError(1);
    expect(desc).toBeDefined();
    expect(typeof desc).toBe('string');
  });

  it('returns fallback for unknown error numbers', () => {
    const desc = describeContractError(99999);
    expect(desc).toBe('Unknown contract error');
  });
});

describe('fromContractError', () => {
  it('creates RWASDKError with correct code for known error', () => {
    const err = fromContractError(305); // BLACKLISTED
    expect(err.code).toBe(ErrorCode.BLACKLISTED);
    expect(err).toBeInstanceOf(RWASDKError);
  });

  it('creates RWASDKError for unknown error', () => {
    const err = fromContractError(99999);
    expect(err.code).toBe(ErrorCode.CONTRACT_ERROR);
    expect(err).toBeInstanceOf(RWASDKError);
  });

  it('accepts details parameter', () => {
    const details = { extra: 'data' };
    const err = fromContractError(1, details);
    expect(err.details).toEqual(details);
  });
});

describe('ERROR_DESCRIPTIONS', () => {
  it('has descriptions for all common error codes', () => {
    expect(ERROR_DESCRIPTIONS[ErrorCode.NETWORK_ERROR]).toBeDefined();
    expect(ERROR_DESCRIPTIONS[ErrorCode.TIMEOUT]).toBeDefined();
    expect(ERROR_DESCRIPTIONS[ErrorCode.TRANSACTION_FAILED]).toBeDefined();
    expect(ERROR_DESCRIPTIONS[ErrorCode.UNAUTHORIZED]).toBeDefined();
  });
});

describe('Error inheritance chain', () => {
  it('all errors extend RWASDKError', () => {
    expect(new NetworkError()).toBeInstanceOf(RWASDKError);
    expect(new TransactionError()).toBeInstanceOf(RWASDKError);
    expect(new InvalidParametersError()).toBeInstanceOf(RWASDKError);
    expect(new ContractError()).toBeInstanceOf(RWASDKError);
    expect(new HorizonError(ErrorCode.TIMEOUT, 'test')).toBeInstanceOf(RWASDKError);
  });

  it('all errors extend Error', () => {
    expect(new NetworkError()).toBeInstanceOf(Error);
    expect(new TransactionError()).toBeInstanceOf(Error);
    expect(new HorizonError(ErrorCode.TIMEOUT, 'test')).toBeInstanceOf(Error);
  });
});
