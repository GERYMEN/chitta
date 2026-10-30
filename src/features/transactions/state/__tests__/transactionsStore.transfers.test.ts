import { useTransactionsStore } from '../transactionsStore';
import { getDatabase } from '../../../../data/db/connection';
import { rowToTransaction } from '../../../../data/mappers/transaction.mapper';
import { rowToAccount } from '../../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../../test/fakeDb';
import { calculateBalance } from '../../../../domain/accounts/account.rules';
import { incomeExpenseTotals } from '../../../../domain/transactions/transaction.rules';
import { findTransferPairs } from '../../../../domain/transfers/transfer.rules';
import { uncategorisedItems } from '../../../../domain/categories/category.rules';
import { selectApproved, selectPending } from '../transactionsStore';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const SECRET_PREVIEW = 'Rs.500 debited QA-SECRET-PREVIEW';

function accountRow(id: string, name: string, type: string, opening: number) {
  return {
    id,
    name,
    type,
    last_four: null,
    opening_balance_minor: opening,
    currency: 'INR',
    is_active: 1,
    balance_anchor_minor: null,
    balance_anchor_at: null,
    deleted_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

const BANK = accountRow('acc-bank', 'QA Delete Bank 9999', 'bank', 1000000);
const WALLET = accountRow('acc-wallet', 'QA Wallet 8888', 'cash', 20000);

function txRow(id: string, patch: Record<string, unknown>) {
  return {
    id,
    type: 'expense',
    status: 'pending',
    amount_minor: 50000,
    currency: 'INR',
    merchant_name: `QA-${id}`,
    category_id: 'cat-uncategorised',
    account_id: 'acc-bank',
    payment_method: 'other',
    occurred_at: '2026-10-20T10:00:00.000Z',
    detected_at: '2026-10-20T10:00:00.000Z',
    approved_at: null,
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

const DEBIT = txRow('d1', { category_id: 'cat-food' });
const CREDIT = txRow('c1', {
  type: 'income',
  account_id: 'acc-wallet',
  status: 'approved',
  approved_at: '2026-10-20T12:00:00.000Z',
  occurred_at: '2026-10-20T11:00:00.000Z',
});

let db: FakeDb;

function seed(transactions: Record<string, unknown>[] = [DEBIT, CREDIT]) {
  db = createFakeDb({ accounts: [BANK, WALLET], transactions: transactions.map(r => ({ ...r })) });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    transactions: transactions.map(rowToTransaction),
    accounts: [rowToAccount(BANK), rowToAccount(WALLET)],
    categories: [],
    transferDismissals: [],
    approvalMode: 'manual',
    autoApproveThreshold: 90,
  });
}

const state = () => useTransactionsStore.getState();
const balance = (row: ReturnType<typeof accountRow>) =>
  calculateBalance(rowToAccount(row), state().transactions, row.id);
const dbRow = (id: string) => db.tables.get('transactions')!.get(id)!;
const homeTotals = () => incomeExpenseTotals(selectApproved(state()));
const netWorth = () => balance(BANK) + balance(WALLET);

function expectNoSmsTextInAudit() {
  for (const { row } of db.auditInserts()) {
    const json = String(row.metadata_json ?? '');
    expect(json).not.toMatch(/SECRET|debited|QA-d1|QA-c1/);
  }
}

beforeEach(() => seed());
afterEach(() => mockGetDatabase.mockReset());

describe('addTransfer (Add Record → Transfer)', () => {
  it('records an approved transfer + one created audit in ONE db.transaction', async () => {
    seed([]);
    const totalsBefore = homeTotals();
    const worthBefore = netWorth();
    const created = await state().addTransfer({
      fromAccountId: 'acc-bank',
      toAccountId: 'acc-wallet',
      amountMinor: 50000,
      occurredAt: '2026-10-30T10:00:00.000Z',
      note: 'QA transfer',
    });

    expect(created).toMatchObject({
      type: 'transfer',
      status: 'approved',
      accountId: 'acc-bank',
      transferAccountId: 'acc-wallet',
      categoryId: 'cat-transfer',
      sourceType: 'manual',
    });
    const audits = db.auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0].row).toMatchObject({ event_type: 'created', actor: 'user', metadata_json: null });
    const insert = db.calls.find(c => /^INSERT INTO transactions/.test(c.sql))!;
    expect(insert.inTransaction).toBe(true);
    expect(audits[0].call.transactionNo).toBe(insert.transactionNo);
    expect(dbRow(created.id)).toMatchObject({ type: 'transfer', transfer_account_id: 'acc-wallet' });

    expect(balance(BANK)).toBe(1000000 - 50000);
    expect(balance(WALLET)).toBe(20000 + 50000);
    expect(homeTotals()).toEqual(totalsBefore);
    expect(netWorth()).toBe(worthBefore);
  });
});

describe('confirmTransferPair ("It\'s a transfer")', () => {
  it('converts the debit, keeps the credit as a rejected twin, audits transfer_paired — one db.transaction', async () => {
    expect(findTransferPairs(state().transactions, state().accounts, [])).toHaveLength(1);
    const ok = await state().confirmTransferPair('d1', 'c1');
    expect(ok).toBe(true);

    expect(dbRow('d1')).toMatchObject({
      type: 'transfer',
      status: 'approved',
      transfer_account_id: 'acc-wallet',
      category_id: 'cat-transfer',
    });
    expect(dbRow('c1')).toMatchObject({
      type: 'income',
      status: 'rejected',
      link_kind: 'transfer_twin',
      linked_transaction_id: 'd1',
      source_reference_hash: 'sms:c1',
    });

    const audits = db.auditInserts();
    expect(audits).toHaveLength(1);
    const { row, call } = audits[0];
    expect(row).toMatchObject({ event_type: 'transfer_paired', actor: 'user', transaction_id: 'd1' });
    const metadata = JSON.parse(String(row.metadata_json));
    expect(metadata).toMatchObject({ kind: 'transfer_paired', debit_id: 'd1', credit_id: 'c1' });
    const updates = db.calls.filter(c => /^UPDATE transactions/.test(c.sql));
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u.transactionNo).toBe(call.transactionNo);
    expect(db.transactionCount()).toBe(1);
    expectNoSmsTextInAudit();

    // The twin is in no list, total or balance; the pair is no longer suggested.
    expect(selectPending(state()).map(t => t.id)).not.toContain('c1');
    expect(selectApproved(state()).map(t => t.id)).not.toContain('c1');
    expect(homeTotals()).toEqual({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
    expect(uncategorisedItems(state().transactions)).toHaveLength(0);
    expect(balance(BANK)).toBe(1000000 - 50000);
    expect(balance(WALLET)).toBe(20000 + 50000);
    expect(findTransferPairs(state().transactions, state().accounts, [])).toHaveLength(0);
  });

  it('refuses a pair that is no longer valid (no writes)', async () => {
    seed([DEBIT, { ...CREDIT, amount_minor: 50001 }]);
    expect(await state().confirmTransferPair('d1', 'c1')).toBe(false);
    expect(db.calls.filter(c => /^UPDATE|^INSERT/.test(c.sql))).toHaveLength(0);
  });
});

describe('undoTransfer', () => {
  it('restores both rows EXACTLY (every column but updated_at) and audits transfer_unpaired', async () => {
    const before = { d1: { ...dbRow('d1') }, c1: { ...dbRow('c1') } };
    const storeBefore = state().transactions.map(t => ({ ...t }));
    await state().confirmTransferPair('d1', 'c1');
    const ok = await state().undoTransfer('d1');
    expect(ok).toBe(true);

    const withoutVolatile = (row: Record<string, unknown>) => {
      const copy = { ...row };
      delete copy.updated_at;
      delete copy.rowid;
      return copy;
    };
    for (const id of ['d1', 'c1'] as const) {
      expect(withoutVolatile(dbRow(id))).toEqual(withoutVolatile(before[id]));
    }
    for (const original of storeBefore) {
      const now = state().transactions.find(t => t.id === original.id)!;
      expect({ ...now, updatedAt: original.updatedAt }).toEqual(original);
    }

    const audits = db.auditInserts().map(a => a.row);
    expect(audits.map(a => a.event_type)).toEqual(['transfer_paired', 'transfer_unpaired']);
    expect(JSON.parse(String(audits[1].metadata_json))).toEqual({
      kind: 'transfer_unpaired',
      debit_id: 'd1',
      credit_id: 'c1',
    });
    const unpaired = db.auditInserts()[1].call;
    const restoreUpdates = db.calls.filter(
      c => /^UPDATE transactions/.test(c.sql) && c.transactionNo === unpaired.transactionNo,
    );
    expect(restoreUpdates).toHaveLength(2);
    expectNoSmsTextInAudit();
    // The pair is suggested again.
    expect(findTransferPairs(state().transactions, state().accounts, [])).toHaveLength(1);
  });

  it('does nothing for a transfer that was not paired', async () => {
    seed([]);
    const created = await state().addTransfer({
      fromAccountId: 'acc-bank',
      toAccountId: 'acc-wallet',
      amountMinor: 100,
      occurredAt: '2026-10-30T10:00:00.000Z',
      note: null,
    });
    expect(await state().undoTransfer(created.id)).toBe(false);
  });
});

describe('dismissTransferPair ("Not a transfer")', () => {
  it('stores the dismissal and the suggestion disappears; rows untouched', async () => {
    await state().dismissTransferPair('d1', 'c1');
    expect(Array.from(db.tables.get('transfer_pair_dismissals')!.values())).toEqual([
      expect.objectContaining({ debit_id: 'd1', credit_id: 'c1' }),
    ]);
    const s = state();
    expect(findTransferPairs(s.transactions, s.accounts, s.transferDismissals)).toHaveLength(0);
    expect(db.calls.filter(c => /^UPDATE transactions/.test(c.sql))).toHaveLength(0);
    expect(db.auditInserts()).toHaveLength(0);
  });
});

describe('markAsTransfer / updateTransfer', () => {
  it('approved expense → transfer, audited edited with the changed field names', async () => {
    seed([txRow('e1', { status: 'approved', approved_at: '2026-10-20T10:00:00.000Z', amount_minor: 10000 })]);
    const totalsBefore = homeTotals();
    expect(totalsBefore.expenseMinor).toBe(10000);
    const bankBefore = balance(BANK);
    const ok = await state().markAsTransfer('e1', 'acc-wallet');
    expect(ok).toBe(true);
    const audit = db.auditInserts();
    expect(audit).toHaveLength(1);
    expect(JSON.parse(String(audit[0].row.metadata_json))).toEqual({
      kind: 'edited',
      fields: ['type', 'categoryId', 'transferAccountId'],
    });
    expect(balance(BANK)).toBe(bankBefore);
    expect(balance(WALLET)).toBe(20000 + 10000);
    expect(homeTotals().expenseMinor).toBe(0);
  });

  it('income on B → "from" A moves accountId to A', async () => {
    seed([txRow('i1', { type: 'income', account_id: 'acc-wallet', status: 'approved' })]);
    await state().markAsTransfer('i1', 'acc-bank');
    expect(dbRow('i1')).toMatchObject({ type: 'transfer', account_id: 'acc-bank', transfer_account_id: 'acc-wallet' });
    expect(JSON.parse(String(db.auditInserts()[0].row.metadata_json)).fields).toEqual([
      'type',
      'categoryId',
      'accountId',
      'transferAccountId',
    ]);
  });

  it('refuses pending items and the same account', async () => {
    expect(await state().markAsTransfer('d1', 'acc-wallet')).toBe(false);
    seed([txRow('e1', { status: 'approved' })]);
    expect(await state().markAsTransfer('e1', 'acc-bank')).toBe(false);
    expect(db.auditInserts()).toHaveLength(0);
  });

  it('updateTransfer audits only what changed', async () => {
    seed([]);
    const created = await state().addTransfer({
      fromAccountId: 'acc-bank',
      toAccountId: 'acc-wallet',
      amountMinor: 50000,
      occurredAt: '2026-10-30T10:00:00.000Z',
      note: null,
    });
    await state().updateTransfer(created.id, {
      fromAccountId: 'acc-wallet',
      toAccountId: 'acc-bank',
      amountMinor: 50000,
      occurredAt: '2026-10-30T10:00:00.000Z',
      note: null,
    });
    const last = db.auditInserts().at(-1)!;
    expect(JSON.parse(String(last.row.metadata_json))).toEqual({
      kind: 'edited',
      fields: ['accountId', 'transferAccountId'],
    });
    expect(balance(BANK)).toBe(1000000 + 50000);
  });
});
