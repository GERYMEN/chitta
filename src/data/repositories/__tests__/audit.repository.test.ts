import { auditRepository } from '../audit.repository';
import { getDatabase } from '../../db/connection';
import { AuditMetadata } from '../../../domain/audit/audit.types';

jest.mock('../../db/connection', () => ({
  getDatabase: jest.fn(),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

describe('auditRepository', () => {
  let calls: Array<{ sql: string; params: unknown[] }>;
  let rows: Record<string, unknown>[];

  beforeEach(() => {
    calls = [];
    rows = [];
    mockGetDatabase.mockReturnValue({
      execute: jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows };
      }),
    } as never);
  });

  afterEach(() => mockGetDatabase.mockReset());

  it('insert runs on the executor it is given (e.g. a tx) with bound params', async () => {
    const tx = { execute: jest.fn(async () => ({ rows: [] })) };
    const event = await auditRepository.insert(tx as never, {
      eventType: 'approved',
      actor: 'user',
      transactionId: 'txn-1',
      accountId: 'acc-1',
      eventAt: '2026-10-28T10:00:00.000Z',
    });

    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0); // never bypasses the tx
    const [sql, params] = tx.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toBe(
      'INSERT INTO audit_events (id, transaction_id, account_id, event_type, event_at, actor, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    expect(params.slice(1)).toEqual([
      'txn-1',
      'acc-1',
      'approved',
      '2026-10-28T10:00:00.000Z',
      'user',
      null,
    ]);
    expect(event.id).toMatch(/^aud-/);
  });

  it('insert strips any non-whitelisted metadata field (no SMS text can ride along)', async () => {
    const tx = { execute: jest.fn(async () => ({ rows: [] })) };
    const sneaky = {
      kind: 'detected',
      confidence: 90,
      sanitizedPreview: 'Rs.50 debited SECRET',
      body: 'SECRET body',
      address: 'AD-SENDER',
    } as unknown as AuditMetadata;

    await auditRepository.insert(tx as never, {
      eventType: 'detected',
      actor: 'system',
      metadata: sneaky,
    });

    const params = (tx.execute.mock.calls[0] as unknown as [string, unknown[]])[1];
    expect(JSON.parse(String(params[6]))).toEqual({ kind: 'detected', confidence: 90 });
  });

  it('listRecent without a cursor orders newest first with a bound limit', async () => {
    await auditRepository.listRecent(30);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/ORDER BY a\.event_at DESC, a\.rowid DESC LIMIT \?$/);
    expect(calls[0].sql).not.toMatch(/WHERE \(a\.event_at/);
    expect(calls[0].params).toEqual([30]);
  });

  it('listRecent with a cursor pages strictly older than (eventAt, seq)', async () => {
    await auditRepository.listRecent(30, { eventAt: '2026-10-28T10:00:00.000Z', seq: 41 });
    expect(calls[0].sql).toContain('(a.event_at < ? OR (a.event_at = ? AND a.rowid < ?))');
    expect(calls[0].params).toEqual([
      '2026-10-28T10:00:00.000Z',
      '2026-10-28T10:00:00.000Z',
      41,
      30,
    ]);
  });

  it('listRecent clamps the limit', async () => {
    await auditRepository.listRecent(10_000);
    expect(calls[0].params).toEqual([200]);
  });

  it('listRecent maps rows, the deleted snapshot, and tolerates bad metadata', async () => {
    rows = [
      {
        seq: 2,
        id: 'aud-2',
        transaction_id: 'txn-1',
        account_id: 'acc-1',
        event_type: 'approved',
        event_at: '2026-10-28T10:00:00.000Z',
        actor: 'user',
        metadata_json: '{not json',
        deleted_metadata_json: JSON.stringify({
          kind: 'deleted',
          merchantName: 'QA-Merchant-07',
          amountMinor: 5000,
          type: 'expense',
          status: 'approved',
        }),
      },
    ];
    const [event] = await auditRepository.listRecent(30);
    expect(event).toMatchObject({
      id: 'aud-2',
      seq: 2,
      transactionId: 'txn-1',
      accountId: 'acc-1',
      eventType: 'approved',
      actor: 'user',
      metadata: null,
    });
    expect(event.deletedSnapshot?.merchantName).toBe('QA-Merchant-07');
  });
});
