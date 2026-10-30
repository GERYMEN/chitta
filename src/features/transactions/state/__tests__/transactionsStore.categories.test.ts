import { useTransactionsStore } from '../transactionsStore';
import { getDatabase } from '../../../../data/db/connection';
import { rowToTransaction } from '../../../../data/mappers/transaction.mapper';
import { rowToAccount } from '../../../../data/mappers/account.mapper';
import { rowToCategory } from '../../../../data/mappers/category.mapper';
import { createFakeDb, FakeDb } from '../../../../test/fakeDb';
import { categoryLabel, pickableCategories, UNCATEGORISED_ID } from '../../../../domain/categories/category.rules';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const ACCOUNT_ROW = {
  id: 'acc-qa',
  name: 'QA Delete Bank 9999',
  type: 'bank',
  last_four: '9999',
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const categoryRow = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  parent_id: null,
  type: 'expense',
  icon: 'shape-outline',
  is_system: 1,
  archived_at: null,
  color: null,
  ...extra,
});

const CATEGORY_ROWS = [
  categoryRow('cat-food', 'Food & Dining'),
  categoryRow('cat-shopping', 'Shopping'),
  categoryRow(UNCATEGORISED_ID, 'Uncategorised', { type: 'both' }),
];

const txRow = (id: string, merchant: string, categoryId: string, status = 'pending') => ({
  id,
  type: 'expense',
  status,
  amount_minor: 1000,
  currency: 'INR',
  merchant_name: merchant,
  category_id: categoryId,
  account_id: 'acc-qa',
  payment_method: 'upi',
  occurred_at: '2026-10-28T10:00:00.000Z',
  detected_at: '2026-10-28T10:00:00.000Z',
  approved_at: null,
  note: null,
  source_type: 'manual',
  source_reference_hash: null,
  sanitized_preview: null,
  confidence_score: null,
  parser_version: null,
  bulk_batch_id: null,
  created_at: '2026-10-28T10:00:00.000Z',
  updated_at: '2026-10-28T10:00:00.000Z',
});

let db: FakeDb;

function seed(transactions: Record<string, unknown>[], extraCategories: Record<string, unknown>[] = []) {
  const categories = [...CATEGORY_ROWS, ...extraCategories];
  db = createFakeDb({ accounts: [ACCOUNT_ROW], transactions, categories });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    transactions: transactions.map(rowToTransaction),
    accounts: [rowToAccount(ACCOUNT_ROW)],
    categories: categories.map(rowToCategory),
    merchantRules: {},
  });
}

afterEach(() => mockGetDatabase.mockReset());

function categoryOf(id: string): string {
  return String(db.tables.get('transactions')!.get(id)!.category_id);
}

describe('merchant rules', () => {
  it('saveMerchantRule upserts the normalized key and audits rule_saved with the category id only', async () => {
    seed([txRow('txn-1', 'QA-Merchant-08', 'cat-food')]);
    await useTransactionsStore.getState().saveMerchantRule('QA-Merchant-08', 'cat-food', 'txn-1');

    expect(useTransactionsStore.getState().merchantRules).toEqual({ 'qa merchant 08': 'cat-food' });
    expect(db.tables.get('merchant_rules')!.get('qa merchant 08')).toMatchObject({
      category_id: 'cat-food',
    });
    const audits = db.auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0].row).toMatchObject({ event_type: 'rule_saved', actor: 'user', transaction_id: 'txn-1' });
    expect(JSON.parse(String(audits[0].row.metadata_json))).toEqual({
      kind: 'rule_saved',
      categoryId: 'cat-food',
    });
    expect(String(audits[0].row.metadata_json)).not.toMatch(/merchant/i);
    // rule + audit in ONE db.transaction
    const ruleCall = db.calls.find(c => /INTO merchant_rules/.test(c.sql))!;
    expect(ruleCall.inTransaction).toBe(true);
    expect(audits[0].call.transactionNo).toBe(ruleCall.transactionNo);
  });

  it('re-pointing a rule keeps created_at; deleting it audits rule_deleted', async () => {
    seed([]);
    const store = useTransactionsStore.getState();
    await store.saveMerchantRule('QA-Merchant-08', 'cat-food');
    const createdAt = db.tables.get('merchant_rules')!.get('qa merchant 08')!.created_at;
    await useTransactionsStore.getState().saveMerchantRule('qa merchant 08', 'cat-shopping');
    const row = db.tables.get('merchant_rules')!.get('qa merchant 08')!;
    expect(row.category_id).toBe('cat-shopping');
    expect(row.created_at).toBe(createdAt);
    expect(db.tables.get('merchant_rules')!.size).toBe(1);

    await useTransactionsStore.getState().deleteMerchantRule('qa merchant 08');
    expect(db.tables.get('merchant_rules')!.size).toBe(0);
    expect(useTransactionsStore.getState().merchantRules).toEqual({});
    expect(db.auditInserts().map(a => a.row.event_type)).toEqual([
      'rule_saved',
      'rule_saved',
      'rule_deleted',
    ]);
  });

  it('never saves a rule for an empty merchant key', async () => {
    seed([]);
    await useTransactionsStore.getState().saveMerchantRule('  @@ ', 'cat-food');
    expect(db.tables.get('merchant_rules')?.size ?? 0).toBe(0);
    expect(db.auditInserts()).toHaveLength(0);
  });
});

describe('apply to past items + undo', () => {
  const rows = [
    txRow('txn-self', 'QA-Merchant-08', 'cat-food'),
    txRow('txn-a', 'QA-Merchant-08', UNCATEGORISED_ID),
    txRow('txn-b', 'qa merchant 08', 'cat-shopping', 'approved'),
    txRow('txn-rejected', 'QA-Merchant-08', 'cat-shopping', 'rejected'),
    txRow('txn-other', 'QA-Merchant-07', UNCATEGORISED_ID),
  ];

  it('counts other pending + approved items of the same merchant (not self/rejected/others)', () => {
    seed(rows);
    const targets = useTransactionsStore.getState().ruleTargets('QA-Merchant-08', 'cat-food', 'txn-self');
    expect(targets.map(t => t.id)).toEqual(['txn-a', 'txn-b']);
  });

  it('applies in ONE db.transaction with one edited audit per item, and Undo restores exact ids', async () => {
    seed(rows);
    const store = useTransactionsStore.getState();
    const targets = store.ruleTargets('QA-Merchant-08', 'cat-food', 'txn-self');
    const applied = await store.applyCategoryChanges(targets);

    expect(applied).toHaveLength(2);
    expect(categoryOf('txn-a')).toBe('cat-food');
    expect(categoryOf('txn-b')).toBe('cat-food');
    expect(categoryOf('txn-rejected')).toBe('cat-shopping');
    expect(categoryOf('txn-other')).toBe(UNCATEGORISED_ID);

    const applyAudits = db.auditInserts();
    expect(applyAudits).toHaveLength(2);
    const txNos = new Set(applyAudits.map(a => a.call.transactionNo));
    expect(txNos.size).toBe(1);
    for (const { row } of applyAudits) {
      expect(row.event_type).toBe('edited');
      expect(JSON.parse(String(row.metadata_json))).toEqual({ kind: 'edited', fields: ['categoryId'] });
    }
    const updates = db.calls.filter(c => /^UPDATE transactions SET category_id/.test(c.sql));
    expect(updates.every(c => c.transactionNo === applyAudits[0].call.transactionNo)).toBe(true);

    // store mirrors the DB
    const byId = new Map(useTransactionsStore.getState().transactions.map(t => [t.id, t.categoryId]));
    expect(byId.get('txn-a')).toBe('cat-food');

    await useTransactionsStore.getState().undoCategoryChanges(applied);
    expect(categoryOf('txn-a')).toBe(UNCATEGORISED_ID);
    expect(categoryOf('txn-b')).toBe('cat-shopping');
    const after = new Map(useTransactionsStore.getState().transactions.map(t => [t.id, t.categoryId]));
    expect(after.get('txn-a')).toBe(UNCATEGORISED_ID);
    expect(after.get('txn-b')).toBe('cat-shopping');
    expect(after.get('txn-self')).toBe('cat-food');
    // undo is audited too, in its own single transaction
    expect(db.auditInserts()).toHaveLength(4);
  });

  it('nothing to apply → no transaction, no audit', async () => {
    seed([txRow('txn-self', 'QA-Merchant-08', 'cat-food')]);
    const applied = await useTransactionsStore.getState().applyCategoryChanges([]);
    expect(applied).toEqual([]);
    expect(db.transactionCount()).toBe(0);
  });
});

describe('category management', () => {
  it('create: custom row + category_created audit in one transaction', async () => {
    seed([]);
    const created = await useTransactionsStore
      .getState()
      .addCategory({ name: ' QA Category ', type: 'expense', icon: 'paw', color: 'amber' });
    expect(created).toMatchObject({ name: 'QA Category', isSystem: false, archivedAt: null, color: 'amber' });
    expect(db.tables.get('categories')!.get(created.id)).toMatchObject({ name: 'QA Category', is_system: 0 });
    const [audit] = db.auditInserts();
    expect(audit.row.event_type).toBe('category_created');
    expect(JSON.parse(String(audit.row.metadata_json))).toEqual({
      kind: 'category_created',
      categoryId: created.id,
    });
    expect(audit.call.inTransaction).toBe(true);
  });

  it('rename audits category_updated with field names; a no-op writes nothing', async () => {
    seed([], [categoryRow('cat-qa', 'QA Category', { is_system: 0, color: 'green' })]);
    await useTransactionsStore.getState().updateCategory('cat-qa', { name: 'QA Category' });
    expect(db.auditInserts()).toHaveLength(0);
    await useTransactionsStore.getState().updateCategory('cat-qa', { name: 'QA Renamed', color: 'red' });
    expect(db.tables.get('categories')!.get('cat-qa')).toMatchObject({ name: 'QA Renamed', color: 'red' });
    expect(JSON.parse(String(db.auditInserts()[0].row.metadata_json))).toEqual({
      kind: 'category_updated',
      categoryId: 'cat-qa',
      fields: ['name', 'color'],
    });
  });

  it('archive keeps items and their label, hides it from pickers, audits category_archived', async () => {
    seed(
      [txRow('txn-1', 'QA-Merchant-08', 'cat-qa', 'approved')],
      [categoryRow('cat-qa', 'QA Category', { is_system: 0 })],
    );
    await useTransactionsStore.getState().archiveCategory('cat-qa');

    expect(db.tables.get('categories')!.get('cat-qa')!.archived_at).toEqual(expect.any(String));
    expect(categoryOf('txn-1')).toBe('cat-qa');
    expect(db.calls.some(c => /UPDATE transactions/.test(c.sql))).toBe(false);
    expect(db.calls.some(c => /DELETE/.test(c.sql))).toBe(false);

    const state = useTransactionsStore.getState();
    const qa = state.categories.find(c => c.id === 'cat-qa');
    expect(categoryLabel(qa)).toBe('QA Category (archived)');
    expect(pickableCategories(state.categories, 'expense').map(c => c.id)).not.toContain('cat-qa');
    expect(db.auditInserts().map(a => a.row.event_type)).toEqual(['category_archived']);
  });

  it('system categories cannot be archived or renamed', async () => {
    seed([]);
    await expect(useTransactionsStore.getState().archiveCategory('cat-food')).rejects.toThrow(/System/);
    await expect(
      useTransactionsStore.getState().updateCategory('cat-food', { name: 'Eats' }),
    ).rejects.toThrow(/System/);
    expect(db.tables.get('categories')!.get('cat-food')).toMatchObject({ name: 'Food & Dining', archived_at: null });
    expect(db.auditInserts()).toHaveLength(0);
  });
});
