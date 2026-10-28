import { useTransactionsStore } from '../transactionsStore';
import { getDatabase } from '../../../../data/db/connection';
import { rowToTransaction } from '../../../../data/mappers/transaction.mapper';
import { rowToAccount } from '../../../../data/mappers/account.mapper';
import { createFakeDb, FakeCall, FakeDb } from '../../../../test/fakeDb';
import { CreateTransactionInput } from '../../../../data/repositories/transaction.repository';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const SMS_PREVIEW = 'debited ... QA-PREVIEW-SECRET';
const SMS_SENDER = 'AD-QASENDR';

const ACCOUNT_ROW = {
  id: 'acc-qa',
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

const PENDING_ROW = {
  id: 'txn-qa',
  type: 'expense',
  status: 'pending',
  amount_minor: 5000,
  currency: 'INR',
  merchant_name: 'QA-Merchant-07',
  category_id: 'cat-food',
  account_id: 'acc-qa',
  payment_method: 'upi',
  occurred_at: '2026-10-28T10:00:00.000Z',
  detected_at: '2026-10-28T10:00:00.000Z',
  approved_at: null,
  note: null,
  source_type: 'sms',
  source_reference_hash: 'sms:1:1700000000000',
  sanitized_preview: SMS_PREVIEW,
  confidence_score: 90,
  parser_version: 'sms-heuristic-v1',
  bulk_batch_id: null,
  created_at: '2026-10-28T10:00:00.000Z',
  updated_at: '2026-10-28T10:00:00.000Z',
};

let db: FakeDb;

function seed(rows: { transactions?: Record<string, unknown>[] } = {}) {
  const transactions = rows.transactions ?? [PENDING_ROW];
  db = createFakeDb({ accounts: [ACCOUNT_ROW], transactions });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    transactions: transactions.map(rowToTransaction),
    accounts: [rowToAccount(ACCOUNT_ROW)],
    categories: [],
    approvalMode: 'manual',
    autoApproveThreshold: 90,
    userName: 'QA User',
  });
}

function onlyAudit() {
  const audits = db.auditInserts();
  expect(audits).toHaveLength(1);
  return audits[0];
}

/** The audit row shares a db.transaction with at least one data write. */
function expectSameTransaction(call: FakeCall, dataSql: RegExp) {
  expect(call.inTransaction).toBe(true);
  const data = db.calls.filter(c => dataSql.test(c.sql));
  expect(data.length).toBeGreaterThan(0);
  expect(data.some(c => c.transactionNo === call.transactionNo)).toBe(true);
}

function expectNoSmsText() {
  for (const { row } of db.auditInserts()) {
    const json = String(row.metadata_json ?? '');
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain(SMS_SENDER);
    expect(json).not.toContain('sanitizedPreview');
    expect(json).not.toContain('QA User');
  }
}

beforeEach(() => seed());
afterEach(() => mockGetDatabase.mockReset());

function smsInput(): CreateTransactionInput {
  return {
    ...rowToTransaction({ ...PENDING_ROW, id: 'ignored' }),
    sanitizedPreview: SMS_PREVIEW,
  };
}

describe('store actions write exactly one audit event each, in the same db.transaction', () => {
  it('manual Add Record → created by user', async () => {
    const created = await useTransactionsStore.getState().addTransaction({
      ...smsInput(),
      sourceType: 'manual',
      sourceReferenceHash: null,
      sanitizedPreview: null,
      confidenceScore: null,
      parserVersion: null,
    });
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({
      event_type: 'created',
      actor: 'user',
      transaction_id: created.id,
      account_id: 'acc-qa',
      metadata_json: null,
    });
    expectSameTransaction(call, /^INSERT INTO transactions/);
  });

  it('SMS insert → detected by system with confidence only', async () => {
    const created = await useTransactionsStore.getState().addTransaction(smsInput());
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'detected', actor: 'system', transaction_id: created.id });
    expect(JSON.parse(String(row.metadata_json))).toEqual({ kind: 'detected', confidence: 90 });
    expectSameTransaction(call, /^INSERT INTO transactions/);
    expectNoSmsText();
  });

  it('approve (Pending / Detail / Home fast-approve) → approved by user', async () => {
    await useTransactionsStore.getState().approve('txn-qa');
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'approved', actor: 'user', transaction_id: 'txn-qa' });
    expectSameTransaction(call, /^UPDATE transactions/);
  });

  it('auto approve → auto_approved by system with confidence + threshold', async () => {
    await useTransactionsStore.getState().approve('txn-qa', { confidence: 90, threshold: 85 });
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'auto_approved', actor: 'system' });
    expect(JSON.parse(String(row.metadata_json))).toEqual({
      kind: 'auto_approved',
      confidence: 90,
      threshold: 85,
    });
    expectSameTransaction(call, /^UPDATE transactions/);
    expectNoSmsText();
  });

  it('approve of a non-pending item writes nothing', async () => {
    seed({ transactions: [{ ...PENDING_ROW, status: 'approved' }] });
    await useTransactionsStore.getState().approve('txn-qa');
    expect(db.auditInserts()).toHaveLength(0);
  });

  it('reject → rejected by user', async () => {
    await useTransactionsStore.getState().reject('txn-qa');
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'rejected', actor: 'user', transaction_id: 'txn-qa' });
    expectSameTransaction(call, /^UPDATE transactions/);
  });

  it('edit → edited with changed field names only', async () => {
    await useTransactionsStore.getState().updateTransaction('txn-qa', {
      note: 'QA note',
      merchantName: 'QA-Merchant-07',
      amountMinor: 5000,
    });
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'edited', actor: 'user', transaction_id: 'txn-qa' });
    expect(JSON.parse(String(row.metadata_json))).toEqual({ kind: 'edited', fields: ['note'] });
    expect(String(row.metadata_json)).not.toContain('QA note');
    expectSameTransaction(call, /^UPDATE transactions/);
  });

  it('a save that changes nothing writes no audit event', async () => {
    await useTransactionsStore.getState().updateTransaction('txn-qa', { amountMinor: 5000 });
    expect(db.auditInserts()).toHaveLength(0);
  });

  it('delete → deleted with a minimal snapshot (no SMS text)', async () => {
    seed({ transactions: [{ ...PENDING_ROW, status: 'approved' }] });
    await useTransactionsStore.getState().deleteTransaction('txn-qa');
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'deleted', actor: 'user', transaction_id: 'txn-qa' });
    expect(JSON.parse(String(row.metadata_json))).toEqual({
      kind: 'deleted',
      merchantName: 'QA-Merchant-07',
      amountMinor: 5000,
      type: 'expense',
      status: 'approved',
    });
    expectSameTransaction(call, /^DELETE FROM transactions/);
    expectNoSmsText();
    expect(db.tables.get('transactions')?.has('txn-qa')).toBe(false);
  });

  it('add account → account_created', async () => {
    await useTransactionsStore.getState().addAccount({
      name: 'QA Bank',
      type: 'bank',
      lastFour: '1234',
      openingBalanceMinor: 0,
      currency: 'INR',
      isActive: true,
    });
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'account_created', actor: 'user', transaction_id: null });
    expect(row.account_id).toMatch(/^acc-/);
    expectSameTransaction(call, /^INSERT INTO accounts/);
  });

  it('update account → account_updated with field names', async () => {
    await useTransactionsStore.getState().updateAccount('acc-qa', { name: 'QA Renamed' });
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'account_updated', account_id: 'acc-qa' });
    expect(JSON.parse(String(row.metadata_json))).toEqual({ kind: 'account_updated', fields: ['name'] });
    expectSameTransaction(call, /^UPDATE accounts/);
  });

  it('remove account → account_removed in the soft-delete transaction', async () => {
    await useTransactionsStore.getState().removeAccount('acc-qa');
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'account_removed', actor: 'user', account_id: 'acc-qa' });
    expectSameTransaction(call, /^UPDATE accounts SET deleted_at = \?/);
  });

  it('restore account → account_restored in the restore transaction', async () => {
    await useTransactionsStore.getState().restoreAccount('acc-qa');
    const { row, call } = onlyAudit();
    expect(row).toMatchObject({ event_type: 'account_restored', actor: 'user', account_id: 'acc-qa' });
    expectSameTransaction(call, /^UPDATE accounts SET deleted_at = NULL/);
  });

  it('approval settings save → one settings_changed per changed key, never user_name', async () => {
    await useTransactionsStore.getState().updateProfile({
      userName: 'QA Renamed User',
      approvalMode: 'auto',
      autoApproveThreshold: 85,
    });
    const audits = db.auditInserts();
    expect(audits).toHaveLength(2);
    expect(audits.map(a => JSON.parse(String(a.row.metadata_json)))).toEqual([
      { kind: 'settings_changed', key: 'approval_mode', from: 'manual', to: 'auto' },
      { kind: 'settings_changed', key: 'auto_approve_threshold', from: '90', to: '85' },
    ]);
    for (const { call } of audits) {
      expectSameTransaction(call, /^INSERT OR REPLACE INTO app_settings/);
      expect(JSON.stringify(call.params)).not.toContain('QA Renamed User');
    }
  });

  it('a name-only save writes no audit event', async () => {
    await useTransactionsStore.getState().updateProfile({
      userName: 'Someone Else',
      approvalMode: 'manual',
      autoApproveThreshold: 90,
    });
    expect(db.auditInserts()).toHaveLength(0);
  });

  it('all audit SQL is parameterized', async () => {
    await useTransactionsStore.getState().approve('txn-qa');
    for (const { call } of db.auditInserts()) {
      expect(call.sql).not.toContain('txn-qa');
      expect(call.sql).not.toContain('approved');
    }
  });
});
