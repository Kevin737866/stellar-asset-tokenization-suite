# SDK (TypeScript): CustodyClient

Source: `sdk/src/custody.ts`

## Overview
`CustodyClient` wraps calls to the on-chain `CustodyValidator` contract.

It supports:
- registering custodians
- submitting custody attestations
- verifying asset backing (read-oriented; depends on additional local reads)
- initiating disputes about attestations
- validating proofs (client side logic; on-chain `validate_proof` exists in Rust)
- triggering insurance claim integrations

## Public methods

### `constructor(contractId: string, serverUrl?: string, networkPassphrase?: string)`
Creates the client.

### `registerCustodian(signerKeypair: Keypair, profile: CustodianProfile) -> Promise<Horizon.SubmitTransactionResponse>`
Invokes contract `register_custodian`.

### `submitAttestation(signerKeypair: Keypair, assetId: string, proofData: ProofData, signatures: string[]) -> Promise<Horizon.SubmitTransactionResponse>`
Invokes contract `submit_attestation` (encoding uses JSON payload in this SDK).

### `verifyAssetBacking(tokenAddress: string) -> Promise<{ isValid; latestAttestation?; alerts; insuranceStatus }>`
Client-side verification helper that fetches latest attestation and alerts (some internal methods are placeholders).

### `getCustodyHistory(assetId: string) -> Promise<CustodyAttestation[]>`
Placeholder (returns empty array).

### `initiateDispute(signerKeypair: Keypair, attestationId: number, reason: string, bondAmount: string, evidenceHash: string) -> Promise<Horizon.SubmitTransactionResponse>`
Invokes contract `dispute_attestation`.

### `triggerInsuranceClaim(signerKeypair: Keypair, assetId: string, claimReason: string, evidenceHash: string) -> Promise<Horizon.SubmitTransactionResponse>`
Invokes contract `trigger_insurance_claim`.

## Unimplemented / placeholder methods
- `getDispute`
- `getCustodianInfo`
- `listActiveCustodians`
- `getVerificationConfig`


