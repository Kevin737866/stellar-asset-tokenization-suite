/**
 * Unit tests for compliance report generation, CSV export and pagination.
 * Issue #202: SDK methods for regulatory report generation and export.
 *
 * The report pipeline is exercised through the public ComplianceClient
 * methods with getAuditTrail stubbed: the audit trail is the only event
 * source in this SDK, so tests feed it synthetic entries and assert the
 * mapping, filtering, pagination and CSV serialisation on top of it.
 */

jest.mock('stellar-sdk', () => ({
  Server: jest.fn(),
  TransactionBuilder: jest.fn(),
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  Account: jest.fn(),
  Address: jest.fn(),
  Contract: jest.fn(),
  xdr: { ScVal: jest.fn() },
  ScInt: jest.fn(),
}));

import { ComplianceClient } from '../complianceClient';
import {
  ComplianceReportType,
  type AuditLogEntry,
} from '../types';

const ADMIN = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const USER1 = 'G' + 'B'.repeat(55);
const USER2 = 'G' + 'C'.repeat(55);

const START = new Date('2026-01-01T00:00:00Z');
const END = new Date('2026-01-31T23:59:59Z');

function makeClient(): ComplianceClient {
  return new ComplianceClient({
    stellar: {
      serverUrl: 'https://horizon-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
    },
    contracts: { complianceRegistry: ADMIN },
  } as any);
}

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '1',
    eventType: 'kyc_updated',
    admin: ADMIN as any,
    target: USER1 as any,
    details: {},
    timestamp: new Date('2026-01-15T10:00:00Z'),
    txHash: 'a'.repeat(64),
    ...overrides,
  };
}

function stubTrail(client: ComplianceClient, entries: AuditLogEntry[]): jest.Mock {
  const mock = jest.fn().mockResolvedValue({ entries, hasMore: false });
  (client as any).getAuditTrail = mock;
  return mock;
}

describe('generateComplianceReport validation', () => {
  it('rejects an unknown report type', async () => {
    const client = makeClient();
    await expect(
      client.generateComplianceReport('NOPE' as any, START, END)
    ).rejects.toThrow('type');
  });

  it('rejects an invalid startDate', async () => {
    const client = makeClient();
    await expect(
      client.generateComplianceReport(ComplianceReportType.KYC_VERIFICATIONS, new Date('bad'), END)
    ).rejects.toThrow('startDate');
  });

  it('rejects an invalid endDate', async () => {
    const client = makeClient();
    await expect(
      client.generateComplianceReport(ComplianceReportType.KYC_VERIFICATIONS, START, new Date('bad'))
    ).rejects.toThrow('endDate');
  });

  it('rejects a reversed date window', async () => {
    const client = makeClient();
    await expect(
      client.generateComplianceReport(ComplianceReportType.KYC_VERIFICATIONS, END, START)
    ).rejects.toThrow('startDate must not be after endDate');
  });

  it('rejects limit 0 and limit above 100', async () => {
    const client = makeClient();
    await expect(
      client.generateComplianceReport(ComplianceReportType.KYC_VERIFICATIONS, START, END, { limit: 0 })
    ).rejects.toThrow('limit');
    await expect(
      client.generateComplianceReport(ComplianceReportType.KYC_VERIFICATIONS, START, END, { limit: 101 })
    ).rejects.toThrow('limit');
  });

  it('rejects a malformed cursor', async () => {
    const client = makeClient();
    await expect(
      client.generateComplianceReport(ComplianceReportType.KYC_VERIFICATIONS, START, END, { cursor: '!!!not-a-cursor' })
    ).rejects.toThrow('cursor');
  });

  it('defaults to limit 50 and accepts limit 100', async () => {
    const client = makeClient();
    stubTrail(client, []);
    const d = await client.generateComplianceReport(ComplianceReportType.KYC_VERIFICATIONS, START, END);
    expect(d.limit).toBe(50);
    const capped = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END, { limit: 100 }
    );
    expect(capped.limit).toBe(100);
  });
});

describe('generateComplianceReport record mapping', () => {
  it('maps kyc_updated entries to KYC records and skips other event types', async () => {
    const client = makeClient();
    const trail = stubTrail(client, [
      entry({ id: '1', details: { newStatus: 'verified' } }),
      entry({ id: '2', eventType: 'blacklisted', target: USER2 as any }),
      entry({ id: '3', details: { status: 'pending' }, target: USER2 as any }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END
    );
    expect(report.totalRecords).toBe(2);
    expect(report.records[0]).toMatchObject({
      user: USER1, status: 'verified', verifiedBy: ADMIN, txHash: 'a'.repeat(64),
    });
    expect(report.records[1]).toMatchObject({ user: USER2, status: 'pending' });
    expect(trail).toHaveBeenCalledWith(expect.objectContaining({
      eventTypes: ['kyc_updated'],
      fromTimestamp: START,
      toTimestamp: END,
    }));
  });

  it('excludes entries outside the date window', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({ id: '1', timestamp: new Date('2025-12-31T23:59:59Z') }),
      entry({ id: '2', timestamp: new Date('2026-01-15T10:00:00Z') }),
      entry({ id: '3', timestamp: new Date('2026-02-01T00:00:00Z') }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END
    );
    expect(report.totalRecords).toBe(1);
    expect((report.records[0] as any).user).toBe(USER1);
  });

  it('maps transfer events with compliant flag and amount', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({
        id: '1', eventType: 'compliance_check',
        details: { from: USER1, to: USER2, amount: '250', compliant: true },
      }),
      entry({
        id: '2', eventType: 'transfer_limits_set',
        details: { from: USER1, to: USER2, amount: '0', compliant: false },
      }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.TRANSFER_ACTIVITY, START, END
    );
    expect(report.totalRecords).toBe(2);
    expect(report.records[0]).toMatchObject({
      from: USER1, to: USER2, amount: '250', compliant: true,
    });
    expect(report.records[1]).toMatchObject({ compliant: false });
  });

  it('maps blacklist adds and removals to added/removed actions', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({ id: '1', eventType: 'blacklisted', details: { reason: 'sanctions' } }),
      entry({ id: '2', eventType: 'unblacklisted', target: USER2 as any, details: { reason: 'appeal upheld' } }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.BLACKLIST_CHANGES, START, END
    );
    expect(report.records[0]).toMatchObject({ address: USER1, action: 'added', reason: 'sanctions' });
    expect(report.records[1]).toMatchObject({ address: USER2, action: 'removed', reason: 'appeal upheld' });
  });

  it('maps suspicious-activity entries with riskLevel fallback', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({
        id: '1', eventType: 'suspicious_activity',
        details: { reason: 'unusual volume', riskLevel: 'high' },
      }),
      entry({ id: '2', eventType: 'suspicious_activity', details: {} }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.SUSPICIOUS_ACTIVITY, START, END
    );
    expect(report.records[0]).toMatchObject({
      address: USER1, reason: 'unusual volume', riskLevel: 'high',
    });
    expect(report.records[1]).toMatchObject({ riskLevel: 'unknown', reason: '' });
  });

  it('returns an empty report when the audit trail is empty', async () => {
    const client = makeClient();
    stubTrail(client, []);
    const report = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END
    );
    expect(report.totalRecords).toBe(0);
    expect(report.records).toEqual([]);
    expect(report.hasMore).toBe(false);
    expect(report.nextCursor).toBeUndefined();
  });

  it('pages through getAuditTrail until hasMore is false', async () => {
    const client = makeClient();
    const mock = jest.fn()
      .mockResolvedValueOnce({
        entries: [entry({ id: '1' }), entry({ id: '2' })],
        hasMore: true, nextCursor: 'trail-cursor-1',
      })
      .mockResolvedValueOnce({
        entries: [entry({ id: '3' })],
        hasMore: false,
      });
    (client as any).getAuditTrail = mock;
    const report = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END
    );
    expect(report.totalRecords).toBe(3);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'trail-cursor-1' }));
  });
});

describe('generateComplianceReport filtering and pagination', () => {
  const fiveKyc = [
    entry({ id: '1' }),
    entry({ id: '2', target: USER2 as any }),
    entry({ id: '3' }),
    entry({ id: '4', target: USER2 as any }),
    entry({ id: '5' }),
  ];

  it('paginates with limit, hasMore and an opaque cursor', async () => {
    const client = makeClient();
    stubTrail(client, fiveKyc);
    const page1 = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END, { limit: 2 }
    );
    expect(page1.records).toHaveLength(2);
    expect(page1.totalRecords).toBe(5);
    expect(page1.hasMore).toBe(true);
    expect(typeof page1.nextCursor).toBe('string');

    const page2 = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END, { limit: 2, cursor: page1.nextCursor }
    );
    expect(page2.records).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END, { limit: 2, cursor: page2.nextCursor }
    );
    expect(page3.records).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeUndefined();
  });

  it('filters by address across target, admin and transfer parties', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({ id: '1', target: USER1 as any }),
      entry({ id: '2', target: USER2 as any }),
      entry({ id: '3', target: USER1 as any, admin: USER2 as any }),
    ]);
    const byTarget = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END, { address: USER2 }
    );
    expect(byTarget.totalRecords).toBe(2);
  });

  it('filters by jurisdiction from entry details', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({ id: '1', details: { jurisdiction: 'ID' } }),
      entry({ id: '2', details: { jurisdiction: 'SG' } }),
      entry({ id: '3', details: {} }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END, { jurisdiction: 'ID' }
    );
    expect(report.totalRecords).toBe(1);
  });
});

describe('exportComplianceReportToCSV', () => {
  it('emits the KYC header and one row per record', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({ id: '1', details: { newStatus: 'verified' } }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END
    );
    const csv = client.exportComplianceReportToCSV(report);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp,user,status,verifiedBy,txHash');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(USER1);
    expect(lines[1]).toContain('verified');
    expect(lines[1]).toContain('2026-01-15T10:00:00.000Z');
  });

  it('emits the transfer header with compliant as true/false', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({
        id: '1', eventType: 'compliance_check',
        details: { from: USER1, to: USER2, amount: '250', compliant: true },
      }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.TRANSFER_ACTIVITY, START, END
    );
    const csv = client.exportComplianceReportToCSV(report);
    expect(csv.split('\n')[0]).toBe('timestamp,from,to,amount,compliant,txHash');
    expect(csv).toContain(',250,true,');
  });

  it('escapes commas, quotes and newlines per RFC 4180', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({
        id: '1', eventType: 'blacklisted',
        details: { reason: 'sanctions, "high" risk\nreview' },
      }),
    ]);
    const report = await client.generateComplianceReport(
      ComplianceReportType.BLACKLIST_CHANGES, START, END
    );
    const csv = client.exportComplianceReportToCSV(report);
    expect(csv).toContain('"sanctions, ""high"" risk\nreview"');
  });

  it('returns only the header for an empty report', async () => {
    const client = makeClient();
    stubTrail(client, []);
    const report = await client.generateComplianceReport(
      ComplianceReportType.KYC_VERIFICATIONS, START, END
    );
    expect(client.exportComplianceReportToCSV(report)).toBe('timestamp,user,status,verifiedBy,txHash');
  });

  it('rejects a null report and an unknown report type', () => {
    const client = makeClient();
    expect(() => client.exportComplianceReportToCSV(null as any)).toThrow('records array');
    expect(() => client.exportComplianceReportToCSV({ type: 'NOPE', records: [] } as any)).toThrow('report.type');
  });
});

describe('getAllComplianceReportPages', () => {
  it('accumulates all pages into a single report', async () => {
    const client = makeClient();
    stubTrail(client, [
      entry({ id: '1' }),
      entry({ id: '2', target: USER2 as any }),
      entry({ id: '3' }),
      entry({ id: '4', target: USER2 as any }),
      entry({ id: '5' }),
    ]);
    const report = await client.getAllComplianceReportPages(
      ComplianceReportType.KYC_VERIFICATIONS, START, END, { limit: 2 }
    );
    expect(report.totalRecords).toBe(5);
    expect(report.records).toHaveLength(5);
    expect(report.hasMore).toBe(false);
    expect(report.nextCursor).toBeUndefined();
  });

  it('passes a single page through unchanged', async () => {
    const client = makeClient();
    stubTrail(client, [entry({ id: '1' })]);
    const report = await client.getAllComplianceReportPages(
      ComplianceReportType.KYC_VERIFICATIONS, START, END
    );
    expect(report.totalRecords).toBe(1);
    expect(report.records).toHaveLength(1);
    expect(report.hasMore).toBe(false);
  });
});
