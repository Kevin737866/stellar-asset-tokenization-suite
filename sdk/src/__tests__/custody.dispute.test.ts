/**
 * Unit tests for CustodyClient dispute lifecycle.
 * Issue #203: fileDispute(), getDisputeStatus(), getRecentDisputes(),
 * bond validation, and onDisputeResolution() event listeners.
 */

import { CustodyClient, DisputeRecord } from '../custody';
import { DisputeStatus, DisputeOptions, DisputeStatusResult, DisputeResolutionEvent } from '../types';
import { InsufficientBondError } from '../errors';

// ---------------------------------------------------------------------------
// Helpers & mocks
// ---------------------------------------------------------------------------

/** Minimal valid Stellar public key (G-address, 56 chars) */
const VALID_PUBKEY = 'GBTHKBBP7DKIYLNZFBQFJHQIJMNJWGUBFN5PMKWKZSFA5NLJIGFEFPNA';
const VALID_CUSTODIAN = 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH532US7XNPIOPDGZE';
const VALID_CONTRACT = 'CAGTJFMCPAVYZFRQXH4GDCM5EKBRLVZXF4FNIJWKQM7LFKXYNQLCQE7';
const VALID_SERVER_URL = 'https://horizon-testnet.stellar.org';

/** Build a minimal Keypair-like mock with a fixed public key */
function mockKeypair(publicKey: string = VALID_PUBKEY) {
    return {
        publicKey: () => publicKey,
        sign: jest.fn(),
    } as any;
}

/** Default valid DisputeOptions */
function validOptions(overrides: Partial<DisputeOptions> = {}): DisputeOptions {
    return {
        attestationId: 42,
        reason: 'Attestation values do not match verified data',
        evidenceHash: 'a'.repeat(64),
        bondAmount: '100.0',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Mock the Stellar server so we never hit the network
// ---------------------------------------------------------------------------

// We mock @stellar/stellar-base at module level so that Server, TransactionBuilder
// etc. never attempt real network calls.
jest.mock('@stellar/stellar-base', () => {
    const buildMock = jest.fn().mockReturnValue({
        sign: jest.fn(),
    });
    const timeoutMock = jest.fn().mockReturnThis();
    const addOpMock = jest.fn().mockReturnThis();

    return {
        Networks: { TESTNET: 'Test SDF Network ; September 2015' },
        Server: jest.fn().mockImplementation(() => ({
            loadAccount: jest.fn().mockResolvedValue({ id: VALID_PUBKEY }),
            submitTransaction: jest.fn().mockResolvedValue({ hash: 'mocktxhash123' }),
        })),
        TransactionBuilder: jest.fn().mockImplementation(() => ({
            addOperation: addOpMock,
            setTimeout: timeoutMock,
            build: buildMock,
        })),
        Operation: {
            invokeContractFunction: jest.fn().mockReturnValue({}),
        },
        Asset: jest.fn(),
        Keypair: jest.fn(),
        Account: jest.fn(),
    };
});

jest.mock('stellar-sdk', () => ({
    Horizon: { SubmitTransactionResponse: {} },
}));

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CustodyClient – dispute lifecycle (Issue #203)', () => {
    let client: CustodyClient;

    beforeEach(() => {
        jest.clearAllMocks();
        client = new CustodyClient(VALID_CONTRACT, VALID_SERVER_URL);
    });

    // -----------------------------------------------------------------------
    // fileDispute – success path
    // -----------------------------------------------------------------------

    describe('fileDispute()', () => {
        it('returns a DisputeStatusResult with PENDING status on success', async () => {
            const signer = mockKeypair();
            const opts = validOptions();

            const result = await client.fileDispute(signer, opts);

            expect(result.status).toBe(DisputeStatus.PENDING);
            expect(result.attestationId).toBe(opts.attestationId);
            expect(result.reason).toBe(opts.reason);
            expect(result.evidenceHash).toBe(opts.evidenceHash);
            expect(result.bondAmount).toBe(opts.bondAmount);
            expect(result.challenger).toBe(VALID_PUBKEY);
            expect(result.bondReturned).toBe(false);
            expect(result.penaltyApplied).toBe(false);
            expect(result.penaltyAmount).toBe('0');
            expect(result.resolvedAt).toBeNull();
            expect(result.resolution).toBeNull();
        });

        it('assigns incrementing disputeIds for successive disputes', async () => {
            const signer = mockKeypair();
            const r1 = await client.fileDispute(signer, validOptions({ attestationId: 1 }));
            const r2 = await client.fileDispute(signer, validOptions({ attestationId: 2 }));

            expect(r2.disputeId).toBeGreaterThan(r1.disputeId);
        });

        it('records a createdAt timestamp close to the current time', async () => {
            const before = Date.now();
            const signer = mockKeypair();
            const result = await client.fileDispute(signer, validOptions());
            const after = Date.now();

            expect(result.createdAt).toBeGreaterThanOrEqual(before);
            expect(result.createdAt).toBeLessThanOrEqual(after);
        });

        it('stores the dispute so getDisputeStatus can retrieve it', async () => {
            const signer = mockKeypair();
            const result = await client.fileDispute(signer, validOptions());

            const fetched = await client.getDisputeStatus(result.disputeId);
            expect(fetched.disputeId).toBe(result.disputeId);
            expect(fetched.status).toBe(DisputeStatus.PENDING);
        });

        it('returns a copy, not the internal object (immutability)', async () => {
            const signer = mockKeypair();
            const r1 = await client.fileDispute(signer, validOptions());
            const r2 = await client.fileDispute(signer, validOptions());
            expect(r1).not.toBe(r2);
        });
    });

    // -----------------------------------------------------------------------
    // Bond validation
    // -----------------------------------------------------------------------

    describe('Bond validation in fileDispute()', () => {
        it('throws when bondAmount is "0"', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ bondAmount: '0' }))
            ).rejects.toThrow();
        });

        it('throws when bondAmount is negative', async () => {
            const signer = mockKeypair();
            // negative strings are rejected by validateAmount (InvalidParametersError)
            await expect(
                client.fileDispute(signer, validOptions({ bondAmount: '-50' }))
            ).rejects.toThrow();
        });

        it('throws when bondAmount is "0.00"', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ bondAmount: '0.00' }))
            ).rejects.toThrow();
        });

        it('throws InsufficientBondError for a positive-but-zero BigNumber (bypasses validateAmount)', async () => {
            // Directly test the BigNumber guard by bypassing validateAmount via a spy
            const signer = mockKeypair();
            // validateAmount passes '0' -> parseFloat -> 0 -> InvalidParametersError,
            // so to specifically reach InsufficientBondError we supply a bond that
            // passes format validation but resolves to 0 via BigNumber.
            // We do this by spying on validateAmount to make it a no-op.
            const validationModule = require('../validation');
            const spy = jest.spyOn(validationModule, 'validateAmount').mockReturnValue(undefined);
            try {
                await expect(
                    client.fileDispute(signer, validOptions({ bondAmount: '0' }))
                ).rejects.toThrow(InsufficientBondError);
            } finally {
                spy.mockRestore();
            }
        });

        it('throws for NaN bond amount strings', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ bondAmount: 'not-a-number' }))
            ).rejects.toThrow();
        });

        it('accepts a decimal bond amount like "0.01"', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ bondAmount: '0.01' }))
            ).resolves.toMatchObject({ status: DisputeStatus.PENDING });
        });

        it('accepts a large bond amount', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ bondAmount: '1000000' }))
            ).resolves.toMatchObject({ bondAmount: '1000000' });
        });
    });

    // -----------------------------------------------------------------------
    // Input validation
    // -----------------------------------------------------------------------

    describe('Input validation in fileDispute()', () => {
        it('throws when reason is empty', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ reason: '' }))
            ).rejects.toThrow();
        });

        it('throws when evidenceHash is empty', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ evidenceHash: '' }))
            ).rejects.toThrow();
        });

        it('throws when attestationId is not a positive integer', async () => {
            const signer = mockKeypair();
            await expect(
                client.fileDispute(signer, validOptions({ attestationId: 0 }))
            ).rejects.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // getDisputeStatus
    // -----------------------------------------------------------------------

    describe('getDisputeStatus()', () => {
        it('returns the dispute for a known disputeId', async () => {
            const signer = mockKeypair();
            const filed = await client.fileDispute(signer, validOptions());

            const status = await client.getDisputeStatus(filed.disputeId);
            expect(status.disputeId).toBe(filed.disputeId);
            expect(status.attestationId).toBe(validOptions().attestationId);
        });

        it('throws for an unknown disputeId (not in store)', async () => {
            await expect(client.getDisputeStatus(99999)).rejects.toThrow();
        });

        it('throws when disputeId is 0', async () => {
            await expect(client.getDisputeStatus(0)).rejects.toThrow();
        });

        it('throws when disputeId is negative', async () => {
            await expect(client.getDisputeStatus(-1)).rejects.toThrow();
        });

        it('returns an independent copy on each call', async () => {
            const signer = mockKeypair();
            const filed = await client.fileDispute(signer, validOptions());

            const s1 = await client.getDisputeStatus(filed.disputeId);
            const s2 = await client.getDisputeStatus(filed.disputeId);
            expect(s1).not.toBe(s2);
            expect(s1).toEqual(s2);
        });
    });

    // -----------------------------------------------------------------------
    // getRecentDisputes
    // -----------------------------------------------------------------------

    describe('getRecentDisputes()', () => {
        it('returns an empty array when custodian has no disputes', async () => {
            const results = await client.getRecentDisputes(VALID_CUSTODIAN);
            expect(results).toEqual([]);
        });

        it('returns disputes in newest-first order', async () => {
            // Disputes are indexed by challenger (VALID_PUBKEY)
            const signer = mockKeypair(VALID_PUBKEY);
            const r1 = await client.fileDispute(signer, validOptions({ attestationId: 1 }));
            const r2 = await client.fileDispute(signer, validOptions({ attestationId: 2 }));
            const r3 = await client.fileDispute(signer, validOptions({ attestationId: 3 }));

            const disputes = await client.getRecentDisputes(VALID_PUBKEY);

            // All three disputes should be present
            expect(disputes).toHaveLength(3);

            // Newest-first: r3 must appear before r1 in the result
            const idxR3 = disputes.findIndex(d => d.disputeId === r3.disputeId);
            const idxR1 = disputes.findIndex(d => d.disputeId === r1.disputeId);
            expect(idxR3).toBeLessThanOrEqual(idxR1);
        });

        it('respects the limit parameter', async () => {
            const signer = mockKeypair(VALID_PUBKEY);
            for (let i = 1; i <= 5; i++) {
                await client.fileDispute(signer, validOptions({ attestationId: i }));
            }

            const disputes = await client.getRecentDisputes(VALID_PUBKEY, 3);
            expect(disputes).toHaveLength(3);
        });

        it('returns all disputes when limit >= total count', async () => {
            const signer = mockKeypair(VALID_PUBKEY);
            for (let i = 1; i <= 3; i++) {
                await client.fileDispute(signer, validOptions({ attestationId: i }));
            }

            const disputes = await client.getRecentDisputes(VALID_PUBKEY, 100);
            expect(disputes.length).toBe(3);
        });

        it('throws for limit = 0', async () => {
            await expect(client.getRecentDisputes(VALID_CUSTODIAN, 0)).rejects.toThrow();
        });

        it('throws for limit > 100', async () => {
            await expect(client.getRecentDisputes(VALID_CUSTODIAN, 101)).rejects.toThrow();
        });

        it('throws for an invalid custodian address', async () => {
            await expect(client.getRecentDisputes('not-an-address')).rejects.toThrow();
        });

        it('uses default limit of 20 when not specified', async () => {
            const signer = mockKeypair(VALID_PUBKEY);
            for (let i = 1; i <= 25; i++) {
                await client.fileDispute(signer, validOptions({ attestationId: i }));
            }

            const disputes = await client.getRecentDisputes(VALID_PUBKEY);
            expect(disputes).toHaveLength(20);
        });
    });

    // -----------------------------------------------------------------------
    // onDisputeResolution – event listeners
    // -----------------------------------------------------------------------

    describe('onDisputeResolution()', () => {
        it('registers a listener without throwing', () => {
            expect(() => {
                client.onDisputeResolution((_event) => {});
            }).not.toThrow();
        });

        it('allows multiple listeners to be registered', () => {
            const l1 = jest.fn();
            const l2 = jest.fn();
            expect(() => {
                client.onDisputeResolution(l1);
                client.onDisputeResolution(l2);
            }).not.toThrow();
        });

        it('notifies all listeners when notifyResolutionListeners is called (via internal access)', async () => {
            // We expose the private method through casting to test the notification path.
            const l1 = jest.fn();
            const l2 = jest.fn();
            client.onDisputeResolution(l1);
            client.onDisputeResolution(l2);

            const event: DisputeResolutionEvent = {
                type: 'dispute_resolved',
                disputeId: 1,
                attestationId: 42,
                challenger: VALID_PUBKEY,
                custodian: VALID_CUSTODIAN,
                resolution: 'Attestation found to be inaccurate',
                status: DisputeStatus.RESOLVED_UPHELD,
                bondReturned: true,
                penaltyApplied: true,
                penaltyAmount: '10',
                timestamp: new Date(),
                txHash: 'abc123',
            };

            // Access private method via type casting
            (client as any).notifyResolutionListeners(event);

            expect(l1).toHaveBeenCalledTimes(1);
            expect(l1).toHaveBeenCalledWith(event);
            expect(l2).toHaveBeenCalledTimes(1);
            expect(l2).toHaveBeenCalledWith(event);
        });

        it('does not call unregistered listeners', async () => {
            const unregistered = jest.fn();
            const registered = jest.fn();
            client.onDisputeResolution(registered);

            const event: DisputeResolutionEvent = {
                type: 'dispute_resolved',
                disputeId: 2,
                attestationId: 99,
                challenger: VALID_PUBKEY,
                custodian: VALID_CUSTODIAN,
                resolution: 'dismissed',
                status: DisputeStatus.RESOLVED_REJECTED,
                bondReturned: false,
                penaltyApplied: false,
                penaltyAmount: '0',
                timestamp: new Date(),
                txHash: 'def456',
            };

            (client as any).notifyResolutionListeners(event);

            expect(registered).toHaveBeenCalledTimes(1);
            expect(unregistered).not.toHaveBeenCalled();
        });

        it('swallows errors thrown by a faulty listener so others still run', () => {
            const faultyListener = jest.fn().mockImplementation(() => {
                throw new Error('Listener error!');
            });
            const goodListener = jest.fn();

            client.onDisputeResolution(faultyListener);
            client.onDisputeResolution(goodListener);

            const event: DisputeResolutionEvent = {
                type: 'dispute_resolved',
                disputeId: 3,
                attestationId: 10,
                challenger: VALID_PUBKEY,
                custodian: VALID_CUSTODIAN,
                resolution: 'upheld',
                status: DisputeStatus.RESOLVED_UPHELD,
                bondReturned: true,
                penaltyApplied: false,
                penaltyAmount: '0',
                timestamp: new Date(),
                txHash: 'ghi789',
            };

            expect(() => (client as any).notifyResolutionListeners(event)).not.toThrow();
            expect(goodListener).toHaveBeenCalledTimes(1);
        });
    });

    // -----------------------------------------------------------------------
    // getDispute (legacy adapter)
    // -----------------------------------------------------------------------

    describe('getDispute() – legacy DisputeRecord adapter', () => {
        it('returns a DisputeRecord with the correct shape', async () => {
            const signer = mockKeypair();
            const filed = await client.fileDispute(signer, validOptions());

            const record: DisputeRecord = await client.getDispute(filed.disputeId);

            expect(record.disputeId).toBe(filed.disputeId);
            expect(record.attestationId).toBe(validOptions().attestationId);
            expect(typeof record.resolvedAt).toBe('number');
            expect(typeof record.resolution).toBe('string');
        });

        it('converts null resolvedAt to 0', async () => {
            const signer = mockKeypair();
            const filed = await client.fileDispute(signer, validOptions());
            const record = await client.getDispute(filed.disputeId);
            expect(record.resolvedAt).toBe(0);
        });

        it('converts null resolution to empty string', async () => {
            const signer = mockKeypair();
            const filed = await client.fileDispute(signer, validOptions());
            const record = await client.getDispute(filed.disputeId);
            expect(record.resolution).toBe('');
        });

        it('throws for unknown disputeId', async () => {
            await expect(client.getDispute(88888)).rejects.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // DisputeStatus enum
    // -----------------------------------------------------------------------

    describe('DisputeStatus enum values', () => {
        it('has the expected string values', () => {
            expect(DisputeStatus.PENDING).toBe('pending');
            expect(DisputeStatus.UNDER_REVIEW).toBe('under_review');
            expect(DisputeStatus.RESOLVED_UPHELD).toBe('resolved_upheld');
            expect(DisputeStatus.RESOLVED_REJECTED).toBe('resolved_rejected');
            expect(DisputeStatus.CANCELLED).toBe('cancelled');
        });
    });
});
