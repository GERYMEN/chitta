/**
 * R10 — IOU store + repositories over a REAL in-memory SQLite (migrated to the
 * current schema). SYNTHETIC ids / names / amounts only.
 */
import { getDatabase } from '../../../../data/db/connection';
import { rowToTransaction } from '../../../../data/mappers/transaction.mapper';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';
import { useIouStore } from '../iouStore';
import { migrateTo, openTestSqlite, sqliteAvailable, TestSqlite } from '../../../../test/sqliteDb';
import { CURRENT_SCHEMA_VERSION } from '../../../../data/db/restoreUpgrade';
import { incomeExpenseTotals } from '../../../../domain/transactions/transaction.rules';
import { Transaction } from '../../../../domain/transactions/transaction.types';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const describeSql = sqliteAvailable() ? describe : describe.skip;

function txRow(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amount_minor: 100000,
    currency: 'INR',
    merchant_name: `QA-${id}`,
    category_id: 'cat-food',
    account_id: 'acc-qa',
    payment_method: 'other',
    occurred_at: '2026-10-20T10:00:00.000Z',
    detected_at: '2026-10-20T10:00:00.000Z',
    approved_at: '2026-10-20T10:01:00.000Z',
    note: null,
    source_type: 'manual',
    source_reference_hash: null,
    sanitized_preview: null,
    confidence_score: null,
    parser_version: null,
    bulk_batch_id: null,
    transfer_account_id: null,
    linked_transaction_id: null,
    link_kind: null,
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
    ...patch,
  };
}

describeSql('useIouStore', () => {
  let t: TestSqlite;
  const seed = (rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      const cols = Object.keys(row);
      t.raw
        .prepare(`INSERT INTO transactions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...(Object.values(row) as unknown[]));
    }
    useTransactionsStore.setState({ transactions: rows.map(r => rowToTransaction(r as never)) });
  };
  const tx = (id: string): Transaction =>
    useTransactionsStore.getState().transactions.find(x => x.id === id) as Transaction;
  const audits = (type: string) => t.rows('audit_events').filter(r => r.event_type === type);

  beforeEach(async () => {
    t = openTestSqlite();
    migrateTo(t, CURRENT_SCHEMA_VERSION);
    (getDatabase as jest.Mock).mockReturnValue(t.db);
    useIouStore.setState({ people: [], shares: [] });
    seed([txRow('exp-1'), txRow('cr-1', { type: 'income', amount_minor: 75000 }), txRow('cr-2', { type: 'income', amount_minor: 1000 })]);
  });
  afterEach(() => t.close());

  const names = (inputs: Array<[string, number]>) =>
    inputs.map(([newName, amountMinor]) => ({ personId: null, newName, amountMinor }));

  it('Split: creates people + lent shares tied to the expense, audits ids only; expense amount unchanged', async () => {
    const err = await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA Person One', 25000], ['QA Person Two', 50000]]));
    expect(err).toBeNull();
    expect(t.rows('people')).toHaveLength(2);
    const shares = t.rows('iou_shares');
    expect(shares).toHaveLength(2);
    expect(shares.every(s => s.direction === 'lent' && s.source_transaction_id === 'exp-1' && s.settled_at === null)).toBe(true);
    expect(audits('iou_person_added')).toHaveLength(2);
    expect(audits('iou_share_added')).toHaveLength(2);
    expect(JSON.stringify(t.rows('audit_events'))).not.toMatch(/QA Person/);
    // Parallel ledger: the expense row is untouched, spend stays the full 1000.
    expect(t.rows('transactions').find(r => r.id === 'exp-1')?.amount_minor).toBe(100000);
    expect(incomeExpenseTotals([tx('exp-1')]).expenseMinor).toBe(100000);
    expect(useIouStore.getState().shares).toHaveLength(2);
  });

  it('Split: reuses an existing person (by id or same typed name) instead of duplicating', async () => {
    await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA Person One', 1000]]));
    const personId = useIouStore.getState().people[0].id;
    await useIouStore.getState().splitExpense(tx('exp-1'), [
      { personId, newName: null, amountMinor: 1000 },
      { personId: null, newName: '  qa person one ', amountMinor: 1000 },
    ]);
    expect(t.rows('people')).toHaveLength(1);
    expect(t.rows('iou_shares')).toHaveLength(3);
  });

  it('Split validation: over the expense (incl. earlier shares), zero, no name, non-expense -> nothing written', async () => {
    const s = useIouStore.getState();
    expect(await s.splitExpense(tx('exp-1'), names([['QA A', 100001]]))).toBe('over-expense');
    expect(await s.splitExpense(tx('exp-1'), names([['QA A', 0]]))).toBe('amount-not-positive');
    expect(await s.splitExpense(tx('exp-1'), names([['  ', 5]]))).toBe('no-person');
    expect(await s.splitExpense(tx('cr-1'), names([['QA A', 5]]))).toBe('not-approved-expense');
    expect(t.rows('iou_shares')).toHaveLength(0);
    expect(t.rows('people')).toHaveLength(0);
    await s.splitExpense(tx('exp-1'), names([['QA A', 90000]]));
    expect(await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA B', 10001]]))).toBe('over-expense');
    expect(t.rows('iou_shares')).toHaveLength(1);
  });

  it('Settle with a linked credit: share settled, credit becomes iou_repayment (not income), spend unchanged; Undo restores both', async () => {
    await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA Person One', 75000]]));
    const share = useIouStore.getState().shares[0];
    const prior = await useIouStore.getState().settle(share, 'cr-1');
    expect(typeof prior).toBe('object');
    const row = t.rows('iou_shares')[0];
    expect(row.settled_at).not.toBeNull();
    expect(row.repayment_transaction_id).toBe('cr-1');
    expect(t.rows('transactions').find(r => r.id === 'cr-1')).toMatchObject({ link_kind: 'iou_repayment', linked_transaction_id: 'exp-1', amount_minor: 75000 });
    expect(tx('cr-1').linkKind).toBe('iou_repayment');
    expect(incomeExpenseTotals([tx('exp-1'), tx('cr-1')])).toMatchObject({ incomeMinor: 0, expenseMinor: 100000 });
    expect(audits('iou_repayment_recorded')).toHaveLength(1);

    await useIouStore.getState().undoSettle(prior as never);
    expect(t.rows('iou_shares')[0]).toMatchObject({ settled_at: null, repayment_transaction_id: null });
    expect(t.rows('transactions').find(r => r.id === 'cr-1')).toMatchObject({ link_kind: null, linked_transaction_id: null });
    expect(incomeExpenseTotals([tx('exp-1'), tx('cr-1')]).incomeMinor).toBe(75000);
    expect(audits('iou_repayment_undone')).toHaveLength(1);
  });

  it('Settle without a transaction: only the share changes', async () => {
    await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA Person One', 5000]]));
    await useIouStore.getState().settle(useIouStore.getState().shares[0], null);
    expect(t.rows('iou_shares')[0].settled_at).not.toBeNull();
    expect(t.rows('iou_shares')[0].repayment_transaction_id).toBeNull();
    expect(t.rows('transactions').every(r => r.link_kind === null)).toBe(true);
  });

  it('Settle refuses a credit that is already linked / not a credit / reused', async () => {
    await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA P', 1000], ['QA Q', 1000], ['QA R', 1000]]));
    const [a, b, c] = useIouStore.getState().shares;
    expect(await useIouStore.getState().settle(a, 'exp-1')).toBe('not-linkable');
    expect(await useIouStore.getState().settle(a, 'nope')).toBe('missing');
    expect(typeof (await useIouStore.getState().settle(a, 'cr-2'))).toBe('object');
    expect(await useIouStore.getState().settle(b, 'cr-2')).toBe('not-linkable');
    expect(c.settledAt).toBeNull();
  });

  it('Borrowed: manual add, settle with an outgoing expense leaves that expense plain spend', async () => {
    const err = await useIouStore.getState().addManual({ direction: 'borrowed', personId: null, newName: 'QA Person Three', amountMinor: 4000, note: 'QA note' });
    expect(err).toBeNull();
    expect(t.rows('iou_shares')[0]).toMatchObject({ direction: 'borrowed', source_transaction_id: null, note: 'QA note' });
    expect(await useIouStore.getState().addManual({ direction: 'borrowed', personId: null, newName: 'X', amountMinor: 0, note: null })).toBe('amount-not-positive');
    await useIouStore.getState().settle(useIouStore.getState().shares[0], 'exp-1');
    expect(t.rows('iou_shares')[0].repayment_transaction_id).toBe('exp-1');
    expect(t.rows('transactions').find(r => r.id === 'exp-1')?.link_kind).toBeNull();
    expect(incomeExpenseTotals([tx('exp-1')]).expenseMinor).toBe(100000);
  });

  it('Delete unlinks a repayment credit (income again); Undo restores the share and the link', async () => {
    await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA Person One', 75000]]));
    const share = useIouStore.getState().shares[0];
    await useIouStore.getState().settle(share, 'cr-1');
    const settled = useIouStore.getState().shares[0];
    await useIouStore.getState().remove(settled);
    expect(t.rows('iou_shares')).toHaveLength(0);
    expect(tx('cr-1').linkKind).toBeNull();
    expect(audits('iou_share_deleted')).toHaveLength(1);
    await useIouStore.getState().restore(settled);
    expect(t.rows('iou_shares')).toHaveLength(1);
    expect(tx('cr-1').linkKind).toBe('iou_repayment');
  });

  it('a backup-sized round trip: refresh after "restart" restores people + shares', async () => {
    await useIouStore.getState().splitExpense(tx('exp-1'), names([['QA Person One', 1000]]));
    useIouStore.setState({ people: [], shares: [] });
    await useIouStore.getState().refresh();
    expect(useIouStore.getState().people).toHaveLength(1);
    expect(useIouStore.getState().shares).toHaveLength(1);
  });
});
