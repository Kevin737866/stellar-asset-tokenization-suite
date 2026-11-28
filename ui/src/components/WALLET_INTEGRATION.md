# Wallet Connection and Signing Behavior for UI Integrators

This document describes how UI components in `ui/src/components` expect Stellar wallet connection, authorization, and transaction signing to behave when integrated into a host application.

## Supported Wallet Provider & Dependencies

The UI package (`ui/package.json`) targets Stellar browser wallets compatible with:

- **`@stellar/freighter-api`** (`^1.4.0`) for browser extension detection, public key retrieval, network inspection, and transaction signing.
- **`stellar-sdk`** (`^12.0.0`) for constructing unsigned Soroban / Stellar transaction XDR envelopes and submitting signed transactions.

Host applications may use Freighter directly or wrap any Stellar wallet adapter (e.g. Stellar Wallets Kit) as long as it adheres to the connection, authorization, and failure semantics below.

## Configuration Requirements

Integrators must configure a single target Stellar network for the session and verify that the connected wallet matches it before requesting signatures:

| Network (`WalletNetwork`) | Expected Network Passphrase |
| --- | --- |
| `PUBLIC` | `Public Global Stellar Network ; September 2015` |
| `TESTNET` | `Test SDF Network ; September 2015` |
| `FUTURENET` | `Test SDF Future Network ; October 2022` |

## Wallet Connection Lifecycle

1. **Detection**
   - Check whether a compatible wallet extension is installed (`isConnected()` in `@stellar/freighter-api`).
   - If unavailable, surface a `WALLET_NOT_INSTALLED` error and keep signing/deployment controls disabled.
2. **Authorization & Public Key Retrieval**
   - Request account access (`setAllowed()` / `getPublicKey()`).
   - A valid connected account must be a 56-character Stellar Ed25519 public key starting with `G` (Base32 `A-Z`, `2-7`).
   - If the user declines access, do not persist partial session state; keep the wallet state disconnected.
3. **Network Verification**
   - Query the wallet's active network (`getNetwork()`).
   - Compare it against the application's configured `WalletNetwork`. If they differ, block signing and report `NETWORK_MISMATCH`.
4. **Disconnection & Account Switching**
   - Clearing the session must reset `connected` to `false`, `publicKey` to `null`, and `network` to `null` (see `createDisconnectedWalletState()`).
   - When the user switches accounts or networks in the wallet extension, re-validate connection state before allowing further signing actions.

## Transaction Signing Semantics

UI components that initiate on-chain writes (such as `AssetDeployer`, `CustodyVerificationPanel`, `DividendPanel`, `SecondaryMarket`, and `ComplianceDashboard`) follow these rules:

1. **Pre-Flight Validation**
   - Before invoking `signTransaction`, validate the connection state and signing request using `validateWalletConnection()` and `validateSigningRequest()` from `./walletIntegration`.
   - Required inputs:
     - Connected wallet with a valid `G...` public key.
     - Wallet network matching the expected application network.
     - Non-empty unsigned transaction XDR string (`xdr`).
     - Non-empty `networkPassphrase` matching the expected network.
2. **Explicit User Confirmation**
   - Destructive or irreversible actions (such as asset deployment) require explicit user review before requesting a wallet signature (e.g. `AssetDeploymentConfirmation` gated by `walletConnected`).
3. **Single-Flight & No Partial State on Failure**
   - Signing requests must not mutate local component state or mark operations as submitted until the wallet returns a signed XDR **and** submission succeeds.
   - If the user cancels signing (`USER_DECLINED` / `4001`), the wallet is locked (`WALLET_LOCKED`), or authorization fails (`TX_BAD_AUTH`), the UI must remain in a clean, retryable state without partial state updates.

## Error Semantics & UI Integration

Wallet and authorization failures should be passed to the existing UI error utilities:

- **`explainWalletPermissionError(error)`** (`./walletPermissionErrors.ts`) classifies raw wallet errors (`user_rejected`, `not_connected`, `wallet_locked`, `wallet_not_installed`, `network_mismatch`, `bad_auth`) into structured, retryable explanations with recovery steps.
- **`WalletPermissionErrorAlert`** (`./WalletPermissionErrorAlert.tsx`) renders inline recovery guidance and optional retry/dismiss actions.
- **`useErrorHandler()`** (`./Toast.tsx`) maps both wallet permission errors and Stellar/Soroban contract errors into user-facing toast notifications.

## Minimal Integration Example

```ts
import {
  createDisconnectedWalletState,
  getExpectedNetworkPassphrase,
  validateSigningRequest,
  WalletConnectionState,
} from './walletIntegration';
import { explainWalletPermissionError } from './walletPermissionErrors';

async function signWithWallet(
  wallet: WalletConnectionState,
  unsignedXdr: string,
  signTransaction: (xdr: string, opts: { networkPassphrase: string }) => Promise<string>
): Promise<string> {
  const expectedNetwork = 'TESTNET';
  const networkPassphrase = getExpectedNetworkPassphrase(expectedNetwork);

  const check = validateSigningRequest(wallet, {
    xdr: unsignedXdr,
    expectedNetwork,
    networkPassphrase,
  });

  if (!check.ok) {
    throw { code: check.code, message: check.message };
  }

  try {
    return await signTransaction(unsignedXdr, { networkPassphrase });
  } catch (err) {
    const explained = explainWalletPermissionError(err);
    if (explained) {
      // Surface via WalletPermissionErrorAlert or useErrorHandler()
      throw err;
    }
    throw err;
  }
}
```
