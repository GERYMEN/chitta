import { billRepository } from '../bill.repository';
import { getDatabase } from '../../db/connection';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';

jest.mock('../../db/connection', () => ({ getDatabase: jest.fn() }));
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb();
  mockGetDatabase.mockReturnValue(db as never);
});
afterEach(() => mockGetDatabase.mockReset());

function rows(): Record<string, unknown>[] {
  return Array.from(db.tables.get('bills')?.values() ?? []);
}
function audits(): Record<string, unknown>[] {
  return Array.from(db.tables.get('audit_events')?.values() ?? []);
}

describe('billRepository.create', () => {
  it('writes one bill row + one bill_created audit, both in a transaction', async () => {
    await billRepository.create({
      accountId: 'acc-1',
      kind: 'manual',
      payee: 'QA Biller',
      amountDueMinor: 100000,
      minDueMinor: null,
      statementDate: null,
      dueDate: '2026-11-20T06:30:00.000Z',
      source: 'manual',
      sourceHash: null,
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].status).toBe('open');
    const created = audits().filter(a => a.event_type === 'bill_created');
    expect(created).toHaveLength(1);
    expect(db.transactionCount()).toBe(1);
  });
});

describe('billRepository.markPaid', () => {
  it('force marks paid + writes bill_paid; a monthly manual bill rolls over', async () => {
    const bill = await billRepository.create({
      accountId: null,
      kind: 'manual',
      payee: 'QA Rent',
      amountDueMinor: 500000,
      minDueMinor: null,
      statementDate: null,
      dueDate: '2026-11-20T06:30:00.000Z',
      source: 'manual',
      sourceHash: null,
      repeat: 'monthly',
    });
    await billRepository.markPaid(bill, { addMinor: 500000, transactionId: null, force: true });
    const all = rows();
    // original paid + a new open bill for next month
    expect(all.filter(r => r.status === 'paid')).toHaveLength(1);
    expect(all.filter(r => r.status === 'open')).toHaveLength(1);
    expect(audits().filter(a => a.event_type === 'bill_paid')).toHaveLength(1);
  });

  it('a partial payment keeps the bill open', async () => {
    const bill = await billRepository.create({
      accountId: 'acc-card',
      kind: 'card_statement',
      payee: 'QA Bank',
      amountDueMinor: 100000,
      minDueMinor: 20000,
      statementDate: null,
      dueDate: '2026-11-20T06:30:00.000Z',
      source: 'manual',
      sourceHash: null,
    });
    await billRepository.markPaid(bill, { addMinor: 30000, transactionId: 'txn-1', force: false });
    const row = rows().find(r => r.id === bill.id)!;
    expect(row.status).toBe('open');
    expect(row.paid_minor).toBe(30000);
    expect(row.paid_transaction_id).toBe('txn-1');
  });
});

describe('billRepository.ingestSmsBill (D-d)', () => {
  const base = {
    accountId: 'acc-card',
    kind: 'card_statement' as const,
    payee: 'QA Bank',
    amountDueMinor: 1200000,
    minDueMinor: 60000,
    statementDate: '2026-11-01T06:30:00.000Z',
    dueDate: '2026-11-20T06:30:00.000Z',
    sourceHash: 'hash-aaaa',
  };

  it('creates an open bill from an SMS', async () => {
    expect(await billRepository.ingestSmsBill(base)).toBe('created');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].source).toBe('sms');
  });

  it('the same SMS content hash is one bill (dedupe)', async () => {
    await billRepository.ingestSmsBill(base);
    expect(await billRepository.ingestSmsBill(base)).toBe('duplicate');
    expect(rows()).toHaveLength(1);
  });

  it('a newer statement for the same account + period updates, never adds', async () => {
    await billRepository.ingestSmsBill(base);
    const outcome = await billRepository.ingestSmsBill({
      ...base,
      sourceHash: 'hash-bbbb',
      amountDueMinor: 1300000,
      dueDate: '2026-11-22T06:30:00.000Z',
    });
    expect(outcome).toBe('updated');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].amount_due_minor).toBe(1300000);
  });
});

describe('billRepository.reopenByPaidTransaction (D-e)', () => {
  it('clears the link, subtracts the contribution, reopens + audits', async () => {
    const bill = await billRepository.create({
      accountId: 'acc-card',
      kind: 'card_statement',
      payee: 'QA Bank',
      amountDueMinor: 100000,
      minDueMinor: null,
      statementDate: null,
      dueDate: '2026-11-20T06:30:00.000Z',
      source: 'manual',
      sourceHash: null,
    });
    await billRepository.markPaid(bill, { addMinor: 100000, transactionId: 'txn-9', force: false });
    await billRepository.reopenByPaidTransaction('txn-9', 100000);
    const row = rows().find(r => r.id === bill.id)!;
    expect(row.status).toBe('open');
    expect(row.paid_transaction_id).toBeNull();
    expect(row.paid_minor).toBe(0);
    expect(audits().filter(a => a.event_type === 'bill_reopened')).toHaveLength(1);
  });
});
