import { useTransactionsStore, selectApproved } from '../transactionsStore';
import { getDatabase } from '../../../../data/db/connection';
import { rowToTransaction } from '../../../../data/mappers/transaction.mapper';
import { rowToAccount } from '../../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../../test/fakeDb';
import { calculateBalance } from '../../../../domain/accounts/account.rules';
import { incomeExpenseTotals } from '../../../../domain/transactions/transaction.rules';
import { findDuplicatePairs } from '../../../../domain/duplicates/duplicate.rules';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const SECRET_PREVIEW = 'Rs.300 debited QA-SECRET-PREVIEW';

const BANK = {
  id: 'acc-bank',
  name: 'QA Delete Bank 9999',
  type: 'bank',
  last_four: '9999',
  opening_balance_minor: 100000,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

function txRow(id: string, patch: Record<string, unknown>) {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amount_minor: 30000,
    currency: 'INR',
    merchant_name: `QA-${id}`,
    category_id: 'cat-shopping',
    account_id: 'acc-bank',
    payment_method: 'other',
    occurred_at: '2026-10-20T10:00:00.000Z',
    detected_at: '2026-10-20T10:00:00.000Z',
    approved_at: '2026-10-20T10:01:00.000Z',
    note: null,
    source_type: 'sms',
    source_reference_hash: `sms:${id}`,
    sanitized_preview: SECRET_PREVIEW,
    confidence_score: 90,
    parser_version: 'sms-heuristic-v1',
    bulk_batch_id: null,
    transfer_account_id: null,
    linked_transaction_id: null,
    link_kind: null,
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
    ...patch,
  };
}

const EXPENSE = txRow('e1', {});
const REFUND = txRow('r1', {
  type: 'income',
  amount_minor: 10000,
  category_id: 'cat-uncategorised',
  occurred_at: '2026-10-22T10:00:00.000Z',
});
const REFUND_BIG = txRow('r2', {
  type: 'income',
  amount_minor: 25000,
  category_id: 'cat-uncategorised',
  occurred_at: '2026-10-23T10:00:00.000Z',
});
const DUP_A = txRow('d1', { amount_minor: 5000, occurred_at: '2026-10-25T10:00:00.000Z' });
const DUP_B = txRow('d2', {
  amount_minor: 5000,
  status: 'pending',
  approved_at: null,
  occurred_at: '2026-10-25T10:03:00.000Z',
});

let db: FakeDb;

function seed(rows: Record<string, unknown>[]) {
  db = createFakeDb({ accounts: [BANK], transactions: rows.map(r => ({ ...r })) });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    transactions: rows.map(rowToTransaction),
    accounts: [rowToAccount(BANK)],
    categories: [],
    transferDismissals: [],
    duplicateDismissals: [],
  });
}

const state = () => useTransactionsStore.getState();
const totals = () => incomeExpenseTotals(selectApproved(state()));
const balance = () => calculateBalance(rowToAccount(BANK), state().transactions, 'acc-bank');
const dbRow = (id: string) => db.tables.get('transactions')!.get(id)!;
const find = (id: string) => state().transactions.find(t => t.id === id)!;

function expectNoSmsTextOrAmountsInAudit() {
  for (const { row } of db.auditInserts()) {
    const json = String(row.metadata_json ?? '');
    expect(json).not.toMatch(/SECRET|debited|QA-|30000|10000|25000|5000/);
  }
}

afterEach(() => mockGetDatabase.mockReset());

describe('linkRefund / unlinkRefund', () => {
  beforeEach(() => seed([EXPENSE, REFUND, REFUND_BIG]));

  it('links in ONE db.transaction with one refund_linked audit (ids only); income −100, spend −100, balance same', async () => {
    const before = totals();
    const balanceBefore = balance();
    expect(await state().linkRefund('r1', 'e1')).toBeNull();

    expect(find('r1')).toMatchObject({
      linkKind: 'refund',
      linkedTransactionId: 'e1',
      categoryId: 'cat-shopping',
      status: 'approved',
      accountId: 'acc-bank',
      occurredAt: '2026-10-22T10:00:00.000Z',
    });
    expect(dbRow('r1')).toMatchObject({ link_kind: 'refund', linked_transaction_id: 'e1', category_id: 'cat-shopping' });
    expect(totals().incomeMinor - before.incomeMinor).toBe(-10000);
    expect(totals().expenseMinor - before.expenseMinor).toBe(-10000);
    expect(balance()).toBe(balanceBefore);

    const audits = db.auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0].row).toMatchObject({ event_type: 'refund_linked', actor: 'user', transaction_id: 'r1' });
    expect(JSON.parse(String(audits[0].row.metadata_json))).toEqual({
      kind: 'refund_linked',
      refund_id: 'r1',
      expense_id: 'e1',
      previous_category_id: 'cat-uncategorised',
      category_id: 'cat-shopping',
    });
    const update = db.calls.find(c => /^UPDATE transactions/.test(c.sql))!;
    expect(update.inTransaction).toBe(true);
    expect(audits[0].call.transactionNo).toBe(update.transactionNo);
    expectNoSmsTextOrAmountsInAudit();
  });

  it('refuses an over-refund with no writes; partial + multiple are fine', async () => {
    expect(await state().linkRefund('r2', 'e1')).toBeNull(); // 250 of 300
    const writes = db.calls.length;
    expect(await state().linkRefund('r1', 'e1')).toBe('over-refund'); // 250 + 100 > 300
    expect(db.calls.length).toBe(writes);
    expect(find('r1').linkKind).toBeNull();
  });

  it('unlink restores totals and the previous category; audits refund_unlinked', async () => {
    const before = totals();
    await state().linkRefund('r1', 'e1');
    expect(await state().unlinkRefund('r1')).toBe(true);
    expect(totals()).toEqual(before);
    expect(find('r1')).toMatchObject({ linkKind: null, linkedTransactionId: null, categoryId: 'cat-uncategorised' });
    const audits = db.auditInserts();
    expect(audits.map(a => a.row.event_type)).toEqual(['refund_linked', 'refund_unlinked']);
    expect(JSON.parse(String(audits[1].row.metadata_json))).toEqual({
      kind: 'refund_unlinked',
      refund_id: 'r1',
      expense_id: 'e1',
    });
    expect(audits[1].call.inTransaction).toBe(true);
    expectNoSmsTextOrAmountsInAudit();
    expect(await state().unlinkRefund('r1')).toBe(false);
  });
});

describe('markDuplicate / restoreDuplicate / dismissDuplicatePair', () => {
  beforeEach(() => seed([DUP_A, DUP_B]));

  it('hides the duplicate (rejected + link, hash kept) with one duplicate_marked audit; restore is EXACT', async () => {
    // Approve the pending one first so both count (like device D2).
    await state().approve('d2');
    const original = { ...find('d2') };
    const before = totals();
    const balanceBefore = balance();

    expect(await state().markDuplicate('d1', 'd2')).toBe(true);
    expect(find('d2')).toMatchObject({
      status: 'rejected',
      linkKind: 'duplicate',
      linkedTransactionId: 'd1',
      sourceReferenceHash: 'sms:d2',
    });
    expect(dbRow('d2')).toMatchObject({ status: 'rejected', link_kind: 'duplicate', linked_transaction_id: 'd1' });
    expect(totals().expenseMinor - before.expenseMinor).toBe(-5000);
    expect(balance() - balanceBefore).toBe(5000);
    expect(findDuplicatePairs(state().transactions, [])).toEqual([]);

    const marked = db.auditInserts().filter(a => a.row.event_type === 'duplicate_marked');
    expect(marked).toHaveLength(1);
    const metadata = JSON.parse(String(marked[0].row.metadata_json));
    expect(metadata).toMatchObject({ kind: 'duplicate_marked', kept_id: 'd1', duplicate_id: 'd2' });
    expect(metadata.previous).toEqual({
      type: 'expense',
      status: 'approved',
      categoryId: 'cat-shopping',
      approvedAt: original.approvedAt,
      transferAccountId: null,
      linkedTransactionId: null,
      linkKind: null,
    });
    expect(marked[0].call.inTransaction).toBe(true);

    expect(await state().restoreDuplicate('d2')).toBe(true);
    const restored = find('d2');
    expect({ ...restored, updatedAt: original.updatedAt }).toEqual(original);
    expect(totals()).toEqual(before);
    expect(balance()).toBe(balanceBefore);
    const restoredAudit = db.auditInserts().filter(a => a.row.event_type === 'duplicate_restored');
    expect(JSON.parse(String(restoredAudit[0].row.metadata_json))).toEqual({
      kind: 'duplicate_restored',
      kept_id: 'd1',
      duplicate_id: 'd2',
    });
    expectNoSmsTextOrAmountsInAudit();
  });

  it('a pending duplicate goes back to pending', async () => {
    expect(await state().markDuplicate('d1', 'd2')).toBe(true);
    expect(await state().restoreDuplicate('d2')).toBe(true);
    expect(find('d2')).toMatchObject({ status: 'pending', approvedAt: null, linkKind: null });
  });

  it('refuses a stale/invalid pair with no writes', async () => {
    expect(await state().markDuplicate('d1', 'd1')).toBe(false);
    expect(await state().markDuplicate('d1', 'missing')).toBe(false);
    expect(await state().restoreDuplicate('d1')).toBe(false);
    expect(db.calls).toHaveLength(0);
  });

  it('"Not duplicates" stores an ordered dismissal, writes NO audit row, and the pair disappears', async () => {
    expect(findDuplicatePairs(state().transactions, state().duplicateDismissals)).toHaveLength(1);
    await state().dismissDuplicatePair('d2', 'd1');
    await state().dismissDuplicatePair('d1', 'd2'); // repeat tap is harmless
    expect(Array.from(db.tables.get('duplicate_pair_dismissals')!.values())).toEqual([
      expect.objectContaining({ a_id: 'd1', b_id: 'd2' }),
    ]);
    const insert = db.calls.find(c => /duplicate_pair_dismissals/.test(c.sql))!;
    expect(insert.sql).toBe(
      'INSERT OR IGNORE INTO duplicate_pair_dismissals (a_id, b_id, dismissed_at) VALUES (?, ?, ?)',
    );
    expect(db.auditInserts()).toHaveLength(0);
    expect(findDuplicatePairs(state().transactions, state().duplicateDismissals)).toEqual([]);
  });
});

describe('R3b.1 F1: the store refuses edits that break a link', () => {
  beforeEach(() => seed([EXPENSE, REFUND, DUP_A, DUP_B]));

  it('a linked refund cannot become an expense; an expense cannot drop below its refunds or become a transfer', async () => {
    await state().linkRefund('r1', 'e1');
    const writes = db.calls.length;

    expect(await state().updateTransaction('r1', { type: 'expense' })).toBe(false);
    expect(await state().updateTransaction('e1', { amountMinor: 9999 })).toBe(false);
    expect(await state().updateTransaction('e1', { type: 'income' })).toBe(false);
    expect(await state().markAsTransfer('e1', 'acc-wallet')).toBe(false);
    expect(db.calls.length).toBe(writes);
    expect(find('r1')).toMatchObject({ type: 'income', linkKind: 'refund' });
    expect(find('e1')).toMatchObject({ type: 'expense', amountMinor: 30000 });

    // Allowed edits still go through.
    expect(await state().updateTransaction('e1', { amountMinor: 10000 })).toBe(true);
    expect(await state().updateTransaction('r1', { note: 'QA note' })).toBe(true);
  });

  it('a hidden duplicate is never edited', async () => {
    await state().markDuplicate('d1', 'd2');
    const writes = db.calls.length;
    expect(await state().updateTransaction('d2', { categoryId: 'cat-food' })).toBe(false);
    expect(db.calls.length).toBe(writes);
  });
});
