import { ErrorCode } from './types';

export class RWASDKError extends Error {
  public code: ErrorCode;
  public details?: any;

  constructor(code: ErrorCode, message: string, details?: any) {
    super(message);
    this.name = 'RWASDKError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

export class NetworkError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.NETWORK_ERROR, message ?? 'Network error occurred', details);
  }
}

export class TransactionError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.TRANSACTION_FAILED, message ?? 'Transaction failed', details);
  }
}

export class InsufficientBalanceError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.INSUFFICIENT_BALANCE, message ?? 'Insufficient balance', details);
  }
}

export class ComplianceError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.COMPLIANCE_FAILED, message ?? 'Compliance check failed', details);
  }
}

export class UnauthorizedError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.UNAUTHORIZED, message ?? 'Unauthorized', details);
  }
}

export class InvalidParametersError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.INVALID_PARAMETERS, message ?? 'Invalid parameters', details);
  }
}

export class TimeoutError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.TIMEOUT, message ?? 'Request timed out', details);
  }
}

export class ContractError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.CONTRACT_ERROR, message ?? 'Contract error', details);
  }
}

export class OracleError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.ORACLE_ERROR, message ?? 'Oracle error', details);
  }
}

export class AssetNotFoundError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.ASSET_NOT_FOUND, message ?? 'Asset not found', details);
  }
}

export class OrderNotFoundError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.ORDER_NOT_FOUND, message ?? 'Order not found', details);
  }
}

export class DistributionNotFoundError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.DISTRIBUTION_NOT_FOUND, message ?? 'Distribution not found', details);
  }
}

export class ProofNotFoundError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.PROOF_NOT_FOUND, message ?? 'Proof not found', details);
  }
}

export class KYCNotVerifiedError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.KYC_NOT_VERIFIED, message ?? 'KYC verification required', details);
  }
}

export class AssetFrozenError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.ASSET_FROZEN, message ?? 'Asset is frozen', details);
  }
}

export class TransferPausedError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.TRANSFER_PAUSED, message ?? 'Transfers are paused', details);
  }
}

export class CustodyError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.CONTRACT_ERROR, message ?? 'Custody error', details);
  }
}

export class VerificationFailedError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.VERIFICATION_FAILED, message ?? 'Verification failed', details);
  }
}

export class InsufficientBondError extends RWASDKError {
  constructor(message?: string, details?: any) {
    super(ErrorCode.INSUFFICIENT_BOND, message ?? 'Insufficient bond amount', details);
  }
}

/**
 * Map of ErrorCode to human-readable descriptions.
 */
export const ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  [ErrorCode.NETWORK_ERROR]: 'A network connectivity error occurred',
  [ErrorCode.TIMEOUT]: 'The request timed out',
  [ErrorCode.TRANSACTION_FAILED]: 'The blockchain transaction failed',
  [ErrorCode.CONTRACT_ERROR]: 'A smart contract error occurred',
  [ErrorCode.INSUFFICIENT_BALANCE]: 'The account has insufficient balance',
  [ErrorCode.UNAUTHORIZED]: 'The operation is not authorized',
  [ErrorCode.INVALID_PARAMETERS]: 'Invalid parameters provided',

  // Factory errors
  [ErrorCode.FACTORY_ALREADY_INITIALIZED]: 'Asset factory has already been initialized',
  [ErrorCode.FACTORY_NOT_INITIALIZED]: 'Asset factory has not been initialized',
  [ErrorCode.ASSET_ALREADY_EXISTS]: 'An asset with the same identifier already exists',
  [ErrorCode.ASSET_NOT_FOUND]: 'The requested asset was not found',
  [ErrorCode.TEMPLATE_NOT_FOUND]: 'The asset template was not found for the given asset class',
  [ErrorCode.TEMPLATE_NOT_ACTIVE]: 'The asset template is not currently active',
  [ErrorCode.COMPLIANCE_CHECK_FAILED]: 'The compliance check failed for the operation',
  [ErrorCode.UPGRADE_NOT_APPROVED]: 'The contract upgrade has not been approved',
  [ErrorCode.GOVERNANCE_THRESHOLD_NOT_MET]: 'The governance voting threshold was not met',

  // Token errors
  [ErrorCode.TOKEN_ALREADY_INITIALIZED]: 'Token contract has already been initialized',
  [ErrorCode.TOKEN_NOT_INITIALIZED]: 'Token contract has not been initialized',
  [ErrorCode.TOKEN_INFO_NOT_FOUND]: 'Token information not found',
  [ErrorCode.TRANSFER_PAUSED]: 'Token transfers are currently paused',
  [ErrorCode.ASSET_FROZEN]: 'The asset is frozen and cannot be transferred',
  [ErrorCode.KYC_REQUIRED]: 'KYC verification is required to perform this operation',
  [ErrorCode.TRANSFER_RESTRICTION]: 'A transfer restriction was applied to the transaction',

  // Compliance / registry errors
  [ErrorCode.COMPLIANCE_FAILED]: 'Compliance validation failed',
  [ErrorCode.REGISTRY_ALREADY_INITIALIZED]: 'Compliance registry has already been initialized',
  [ErrorCode.REGISTRY_NOT_INITIALIZED]: 'Compliance registry has not been initialized',
  [ErrorCode.USER_NOT_FOUND]: 'The user was not found in the compliance registry',
  [ErrorCode.KYC_NOT_VERIFIED]: 'The user has not completed KYC verification',
  [ErrorCode.BLACKLISTED]: 'The user is blacklisted',
  [ErrorCode.INVALID_JURISDICTION]: 'The jurisdiction is not supported',
  [ErrorCode.ACCREDITATION_REQUIRED]: 'Accreditation is required for this operation',
  [ErrorCode.TRANSFER_LIMIT_EXCEEDED]: 'Transfer limit exceeded',

  // Dividend errors
  [ErrorCode.DIVIDEND_ALREADY_INITIALIZED]: 'Dividend distributor has already been initialized',
  [ErrorCode.DIVIDEND_NOT_INITIALIZED]: 'Dividend distributor has not been initialized',
  [ErrorCode.CONFIG_NOT_FOUND]: 'Configuration not found',
  [ErrorCode.INSUFFICIENT_FUNDS]: 'Insufficient funds for the dividend distribution',
  [ErrorCode.INVALID_AMOUNT]: 'The dividend amount is invalid',
  [ErrorCode.DISTRIBUTION_NOT_FOUND]: 'Dividend distribution not found',
  [ErrorCode.ALREADY_CLAIMED]: 'The dividend has already been claimed',
  [ErrorCode.UNSUPPORTED_CURRENCY]: 'The currency is not supported for dividend distribution',
  [ErrorCode.DISTRIBUTION_NOT_ACTIVE]: 'The dividend distribution is not active',
  [ErrorCode.AUTO_DISTRIBUTION_DISABLED]: 'Auto-distribution is disabled',
  [ErrorCode.YIELD_CADENCE_NOT_REACHED]: 'The yield cadence period has not been reached',
  [ErrorCode.ZERO_TOTAL_SUPPLY]: 'Total supply is zero; cannot distribute dividends',
  [ErrorCode.NO_TOKENS_TO_CLAIM]: 'No tokens available to claim',
  [ErrorCode.NO_DIVIDEND_AVAILABLE]: 'No dividend available for distribution',

  // Market errors
  [ErrorCode.MARKET_ALREADY_INITIALIZED]: 'Secondary market has already been initialized',
  [ErrorCode.INVALID_ORDER]: 'The order parameters are invalid',
  [ErrorCode.ORDER_NOT_FOUND]: 'The requested order was not found',
  [ErrorCode.ORDER_EXPIRED]: 'The order has expired',
  [ErrorCode.INSUFFICIENT_LIQUIDITY]: 'Insufficient liquidity in the order book',
  [ErrorCode.TRADING_PAUSED]: 'Trading is currently paused',
  [ErrorCode.CIRCUIT_BREAKER_TRIPPED]: 'Circuit breaker has been triggered; trading halted',
  [ErrorCode.DIVIDEND_HALT]: 'Trading halted due to dividend record date',
  [ErrorCode.MIN_ORDER_SIZE_NOT_MET]: 'The minimum order size has not been met',

  // Custody errors
  [ErrorCode.CUSTODY_ALREADY_INITIALIZED]: 'Custody validator has already been initialized',
  [ErrorCode.CUSTODY_NOT_INITIALIZED]: 'Custody validator has not been initialized',
  [ErrorCode.INVALID_PROOF]: 'The provided proof is invalid',
  [ErrorCode.ORACLE_OFFLINE]: 'The oracle is currently offline',
  [ErrorCode.VERIFICATION_FAILED]: 'Verification of the data failed',
  [ErrorCode.ASSET_NOT_REGISTERED]: 'The asset has not been registered with the custody module',
  [ErrorCode.STALE_DATA]: 'The data is stale and exceeds the allowed freshness threshold',
  [ErrorCode.INVALID_SIGNATURE]: 'The cryptographic signature is invalid',
  [ErrorCode.DISPUTE_ALREADY_EXISTS]: 'A dispute for this attestation already exists',
  [ErrorCode.INSUFFICIENT_BOND]: 'The custodian bond amount is insufficient',
  [ErrorCode.INVALID_DISPUTE_STATUS]: 'The dispute status is invalid for the requested action',
  [ErrorCode.BOND_NOT_REFUNDABLE]: 'The custodian bond is not refundable',
  [ErrorCode.CUSTODIAN_NOT_WHITELISTED]: 'The custodian is not whitelisted',
  [ErrorCode.INVALID_VERIFICATION_TYPE]: 'The verification type is not supported',
  [ErrorCode.PROOF_HASH_MISMATCH]: 'The proof hash does not match the submitted hash',
  [ErrorCode.ATTESTATION_EXPIRED]: 'The attestation has expired',
  [ErrorCode.MULTI_SIG_THRESHOLD_NOT_MET]: 'Multi-signature threshold has not been met',
  [ErrorCode.INVALID_MERKLE_PROOF]: 'The Merkle proof is invalid',
  [ErrorCode.ZK_VERIFICATION_FAILED]: 'Zero-knowledge proof verification failed',
  [ErrorCode.INSURANCE_CLAIM_FAILED]: 'Insurance claim processing failed',
  [ErrorCode.ATTESTATION_NOT_FOUND]: 'The requested attestation was not found',
  [ErrorCode.ORACLE_NOT_FOUND]: 'The requested oracle was not found',

  // Asset class errors
  [ErrorCode.INVALID_LOCATION]: 'The asset location is invalid or not supported',
  [ErrorCode.INVALID_PURITY_GRADE]: 'The purity grade is invalid',
  [ErrorCode.INVALID_DUE_DATE]: 'The due date is invalid or in the past',
  [ErrorCode.INVALID_CREDIT_RATING]: 'The credit rating is invalid',
  [ErrorCode.INVALID_PROVENANCE]: 'The provenance information is invalid',
  [ErrorCode.INVALID_VINTAGE]: 'The vintage year is invalid',
  [ErrorCode.INVALID_REGULATION_FRAMEWORK]: 'The regulation framework is not recognized',
  [ErrorCode.INVALID_VERIFICATION_STANDARD]: 'The verification standard is not recognized',

  // Oracle & Proof
  [ErrorCode.ORACLE_ERROR]: 'An oracle error occurred',
  [ErrorCode.PROOF_NOT_FOUND]: 'The requested proof was not found',
};

/**
 * Parse a Soroban contract error number into its corresponding ErrorCode.
 * Each contract assigns error numbers starting from 1 for its error enum.
 */
export function contractErrorToCode(errorNumber: number): ErrorCode {
  switch (errorNumber) {
    // RWATokenError (1-11)
    case 1: return ErrorCode.TOKEN_ALREADY_INITIALIZED;
    case 2: return ErrorCode.TOKEN_NOT_INITIALIZED;
    case 3: return ErrorCode.TOKEN_INFO_NOT_FOUND;
    case 4: return ErrorCode.TRANSFER_PAUSED;
    case 5: return ErrorCode.ASSET_FROZEN;
    case 6: return ErrorCode.KYC_NOT_VERIFIED;
    case 7: return ErrorCode.TRANSFER_RESTRICTION;

    // AuthError (1-5)
    case 101: return ErrorCode.UNAUTHORIZED;

    // AssetFactoryError (1-11)
    case 201: return ErrorCode.FACTORY_ALREADY_INITIALIZED;
    case 202: return ErrorCode.FACTORY_NOT_INITIALIZED;
    case 203: return ErrorCode.ASSET_ALREADY_EXISTS;
    case 204: return ErrorCode.ASSET_NOT_FOUND;
    case 205: return ErrorCode.TEMPLATE_NOT_FOUND;
    case 206: return ErrorCode.TEMPLATE_NOT_ACTIVE;
    case 207: return ErrorCode.COMPLIANCE_CHECK_FAILED;
    case 208: return ErrorCode.UPGRADE_NOT_APPROVED;
    case 209: return ErrorCode.GOVERNANCE_THRESHOLD_NOT_MET;

    // ComplianceRegistryError (1-9)
    case 301: return ErrorCode.REGISTRY_ALREADY_INITIALIZED;
    case 302: return ErrorCode.REGISTRY_NOT_INITIALIZED;
    case 303: return ErrorCode.USER_NOT_FOUND;
    case 304: return ErrorCode.KYC_NOT_VERIFIED;
    case 305: return ErrorCode.BLACKLISTED;
    case 306: return ErrorCode.INVALID_JURISDICTION;
    case 307: return ErrorCode.ACCREDITATION_REQUIRED;
    case 308: return ErrorCode.TRANSFER_LIMIT_EXCEEDED;

    // DividendError (1-16)
    case 401: return ErrorCode.DIVIDEND_ALREADY_INITIALIZED;
    case 402: return ErrorCode.DIVIDEND_NOT_INITIALIZED;
    case 403: return ErrorCode.CONFIG_NOT_FOUND;
    case 404: return ErrorCode.INSUFFICIENT_FUNDS;
    case 405: return ErrorCode.INVALID_AMOUNT;
    case 406: return ErrorCode.DISTRIBUTION_NOT_FOUND;
    case 407: return ErrorCode.ALREADY_CLAIMED;
    case 408: return ErrorCode.UNSUPPORTED_CURRENCY;
    case 409: return ErrorCode.DISTRIBUTION_NOT_ACTIVE;
    case 410: return ErrorCode.AUTO_DISTRIBUTION_DISABLED;
    case 411: return ErrorCode.YIELD_CADENCE_NOT_REACHED;
    case 412: return ErrorCode.ZERO_TOTAL_SUPPLY;
    case 413: return ErrorCode.NO_TOKENS_TO_CLAIM;
    case 414: return ErrorCode.NO_DIVIDEND_AVAILABLE;

    // MarketError (1-12)
    case 501: return ErrorCode.MARKET_ALREADY_INITIALIZED;
    case 502: return ErrorCode.INVALID_ORDER;
    case 503: return ErrorCode.ORDER_NOT_FOUND;
    case 504: return ErrorCode.ORDER_EXPIRED;
    case 505: return ErrorCode.INSUFFICIENT_LIQUIDITY;
    case 506: return ErrorCode.TRADING_PAUSED;
    case 507: return ErrorCode.CIRCUIT_BREAKER_TRIPPED;
    case 508: return ErrorCode.DIVIDEND_HALT;
    case 509: return ErrorCode.MIN_ORDER_SIZE_NOT_MET;

    // CustodyError (1-25)
    case 601: return ErrorCode.CUSTODY_ALREADY_INITIALIZED;
    case 602: return ErrorCode.CUSTODY_NOT_INITIALIZED;
    case 603: return ErrorCode.INVALID_PROOF;
    case 604: return ErrorCode.ORACLE_OFFLINE;
    case 605: return ErrorCode.VERIFICATION_FAILED;
    case 606: return ErrorCode.ASSET_NOT_REGISTERED;
    case 607: return ErrorCode.STALE_DATA;
    case 608: return ErrorCode.INVALID_SIGNATURE;
    case 609: return ErrorCode.DISPUTE_ALREADY_EXISTS;
    case 610: return ErrorCode.INSUFFICIENT_BOND;
    case 611: return ErrorCode.INVALID_DISPUTE_STATUS;
    case 612: return ErrorCode.BOND_NOT_REFUNDABLE;
    case 613: return ErrorCode.CUSTODIAN_NOT_WHITELISTED;
    case 614: return ErrorCode.INVALID_VERIFICATION_TYPE;
    case 615: return ErrorCode.PROOF_HASH_MISMATCH;
    case 616: return ErrorCode.ATTESTATION_EXPIRED;
    case 617: return ErrorCode.MULTI_SIG_THRESHOLD_NOT_MET;
    case 618: return ErrorCode.INVALID_MERKLE_PROOF;
    case 619: return ErrorCode.ZK_VERIFICATION_FAILED;
    case 620: return ErrorCode.INSURANCE_CLAIM_FAILED;
    case 621: return ErrorCode.ATTESTATION_NOT_FOUND;
    case 622: return ErrorCode.ORACLE_NOT_FOUND;

    // AssetClassHandler errors (1-10)
    case 701: return ErrorCode.INVALID_LOCATION;
    case 702: return ErrorCode.INVALID_PURITY_GRADE;
    case 703: return ErrorCode.INVALID_DUE_DATE;
    case 704: return ErrorCode.INVALID_CREDIT_RATING;
    case 705: return ErrorCode.INVALID_PROVENANCE;
    case 706: return ErrorCode.INVALID_VINTAGE;
    case 707: return ErrorCode.INVALID_REGULATION_FRAMEWORK;
    case 708: return ErrorCode.INVALID_VERIFICATION_STANDARD;

    default: return ErrorCode.CONTRACT_ERROR;
  }
}

/**
 * Get a human-readable description for a contract error number.
 */
export function describeContractError(errorNumber: number): string {
  const code = contractErrorToCode(errorNumber);
  return ERROR_DESCRIPTIONS[code] ?? 'Unknown contract error';
}

/**
 * Build an RWASDKError from a Soroban contract error number.
 */
export function fromContractError(errorNumber: number, details?: any): RWASDKError {
  const code = contractErrorToCode(errorNumber);
  const message = ERROR_DESCRIPTIONS[code] ?? `Unknown contract error (${errorNumber})`;
  return new RWASDKError(code, message, details);
}
