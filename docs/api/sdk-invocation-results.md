# SDK (TypeScript): Typed invocation results

Source: `sdk/src/invocationResult.ts` (Issue #390)

## Overview

By default SDK clients throw `RWASDKError` subclasses when a contract call
fails. The typed result API lets callers handle the same failures as values,
with a stable discriminated shape that is easy to log, serialise or pass
through an HTTP API.

```ts
type InvocationResult<T> =
  | { success: true; value: T }
  | { success: false; error: ContractInvocationFailure };
```

`ContractInvocationFailure` contains:

| Field | Meaning |
| --- | --- |
| `kind` | `validation`, `authorization`, `contract`, `transaction`, `network`, or `unknown` |
| `code` | The SDK `ErrorCode` (see `types.ts`) |
| `message` | Human-readable failure message |
| `suggestion` | Recommended recovery action from `SUGGESTED_ACTIONS` |
| `contractErrorNumber` | Soroban error number, when present |
| `contractId`, `functionName`, `transactionHash`, `operationIndex` | Invocation context, when supplied |
| `details` | Original error details (e.g. batch `operationResults`) |

## Public API

- `toInvocationResult(operation, context?)` — run async work, returning a
  success value or a typed failure. Never throws.
- `toInvocationResultSync(operation, context?)` — synchronous counterpart.
- `invocationSuccess(value)` / `invocationFailure(error, context?)` — build results.
- `contractInvocationFailureFromError(error, context?)` — convert any thrown value.
- `isInvocationSuccess` / `isInvocationFailure` — type guards.
- `unwrapInvocationResult(result)` — return the value or rethrow as `RWASDKError`.
- `StellarRWASDK.withInvocationResult(operation, context?)` — SDK-level wrapper.
- `BatchTransactionBuilder.submitResult(source, txOptions?)` — non-throwing
  `submit()`; on failure `error.details.operationResults` marks every operation
  as failed.

## Example

```ts
const result = await sdk.withInvocationResult(
  () => sdk.createTokenClient(token).mint(admin, recipient, '1000000000000000000'),
  { contractId: token.toString(), functionName: 'mint' },
);

if (!result.success) {
  console.error(result.error.kind, result.error.code, result.error.suggestion);
  return;
}
console.log('transaction:', result.value);
```

## Failure and state semantics

Input validation and authorization failures keep their existing `ErrorCode`s
(`INVALID_PARAMETERS` → `validation`, `UNAUTHORIZED` → `authorization`).
Unrecognised thrown values become `kind: 'unknown'` with
`code: CONTRACT_ERROR`. The helpers only observe the outcome of an operation,
so they introduce no state changes of their own; Stellar transactions remain
atomic, and a failed batch commits no operations.

## Compatibility

This is an additive API. Existing throwing methods and their error classes are
unchanged, so no consumer needs to migrate.

## Note

Two compile-only prerequisites were needed for the Jest suite to run:
`sdk/src/errors.ts` was missing the imports for `DEFAULT_RETRY_CONFIG` and the
`RETRYABLE_*` lists, and `sdk/src/logger.ts` referenced the DOM `window` global
in a Node-only TypeScript build. Neither changes runtime behaviour. Three
pre-existing test files still import `vitest`, which is not a declared
dependency; they are unrelated to this API and remain excluded.
