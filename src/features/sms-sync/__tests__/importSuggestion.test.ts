import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { Category } from '../../../domain/categories/category.types';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { ParsedSmsTransaction } from '../smsParser';
import { groupUnmatchedCandidates } from '../suggestionGroups';
import { useSuggestionSession } from '../suggestionSession';
import {
  addSuggestedAccount,
  ignoreSuggestionGroup,
  importSnackbarMessage,
  linkSuggestion,
  preparePendingRows,
} from '../importSuggestion';
import { useSnackbarStore } from '../../../shared/ui/Snackbar';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const PREVIEW_A = 'Debited ₹250 — QA-Shop';
const PREVIEW_B = 'Credited ₹500 — QA-Payer';

const parsed = (
  hash: string,
  overrides: Partial<ParsedSmsTransaction> = {},
): ParsedSmsTransaction => ({
  type: 'expense',
  amountMinor: 25000,
  merchantName: 'QA-Shop',
  occurredAt: '2026-10-25T10:00:00.000Z',
  confidenceScore: 90,
  sanitizedPreview: PREVIEW_A,
  sourceReferenceHash: hash,
  bankName: 'HDFC',
  bankCanonical: 'hdfc',
  accountKind: 'bank',
  lastFour: '4242',
  ...overrides,
});

const category = (id: string, type: Category['type']): Category => ({
  id,
  name: id,
  parentId: null,
  type,
  icon: 'x',
  isSystem: true,
  archivedAt: null,
  color: null,
});

const CATEGORIES = [
  category('cat-food', 'expense'),
  category('cat-uncategorised', 'both'),
];

const ITEMS = [
  parsed('sms-1-1700000000001'),
  parsed('sms-2-1700000000002', {
    type: 'income',
    amountMinor: 50000,
    merchantName: 'QA-Payer',
    sanitizedPreview: PREVIEW_B,
    confidenceScore: 60,
  }),
  parsed('sms-3-1700000000003', { merchantName: 'QA-Cafe', confidenceScore: 90 }),
];

const EXISTING_ACCOUNT_ROW = {
  id: 'acc-cash',
  name: 'QA Wallet',
  type: 'bank',
  last_four: null,
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

let db: FakeDb;
let runId: string;
const KEY = 'bank:HDFC:4242';

function existingTxn(hash: string): Transaction {
  return {
    id: 'txn-old',
    type: 'expense',
    status: 'pending',
    amountMinor: 1,
    currency: 'INR',
    merchantName: 'QA-Old',
    categoryId: 'cat-uncategorised',
    accountId: 'acc-cash',
    paymentMethod: 'other',
    occurredAt: '2026-10-01T00:00:00.000Z',
    detectedAt: '2026-10-01T00:00:00.000Z',
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: hash,
    sanitizedPreview: null,
    confidenceScore: 90,
    parserVersion: 'sms-heuristic-v1',
    bulkBatchId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  db = createFakeDb({ accounts: [EXISTING_ACCOUNT_ROW] });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    transactions: [],
    accounts: [],
    categories: CATEGORIES,
    merchantRules: { 'qa cafe': 'cat-food' },
    approvalMode: 'manual',
    autoApproveThreshold: 90,
  });
  runId = useSuggestionSession.getState().start(groupUnmatchedCandidates(ITEMS));
});

afterEach(() => {
  mockGetDatabase.mockReset();
  useSnackbarStore.getState().dismiss();
});

const ACCOUNT_INPUT = {
  name: 'HDFC Bank',
  type: 'bank' as const,
  lastFour: '4242',
  openingBalanceMinor: 0,
  currency: 'INR' as const,
  isActive: true,
};

function inserts(table: string) {
  return db.calls.filter(c => c.sql.startsWith(`INSERT INTO ${table} `));
}

function expectNoSmsTextInAudit() {
  for (const { row } of db.auditInserts()) {
    const json = String(row.metadata_json ?? '');
    for (const text of [PREVIEW_A, PREVIEW_B, 'QA-Shop', 'QA-Payer', 'QA-Cafe', 'Debited', 'Credited']) {
      expect(json).not.toContain(text);
    }
  }
}

describe('preparePendingRows', () => {
  it('dedups by sourceReferenceHash and resolves category: rule, else Uncategorised', () => {
    const { rows, uncategorised } = preparePendingRows(
      [...ITEMS, ITEMS[0]],
      CATEGORIES,
      { 'qa cafe': 'cat-food' },
      new Set(['sms-2-1700000000002']),
      '2026-10-30T00:00:00.000Z',
    );
    expect(rows.map(r => r.sourceReferenceHash)).toEqual([
      'sms-1-1700000000001',
      'sms-3-1700000000003',
    ]);
    expect(rows.map(r => r.categoryId)).toEqual(['cat-uncategorised', 'cat-food']);
    expect(uncategorised).toBe(1);
    for (const row of rows) {
      expect(row.status).toBe('pending');
      expect(row.sourceType).toBe('sms');
      expect(row).not.toHaveProperty('accountId');
    }
  });
});

describe('addSuggestedAccount (R2b T2 insert-on-add)', () => {
  it('manual mode: account + decision + pending items in ONE db.transaction, audited', async () => {
    const outcome = await addSuggestedAccount(runId, KEY, ACCOUNT_INPUT);

    expect(outcome).not.toBeNull();
    expect(outcome!.created).toBe(3);
    expect(outcome!.autoApproved).toBe(0);
    expect(db.transactionCount()).toBe(1);

    const accountInsert = inserts('accounts');
    expect(accountInsert).toHaveLength(1);
    const txnInserts = inserts('transactions');
    expect(txnInserts).toHaveLength(3);
    for (const call of [...accountInsert, ...txnInserts]) {
      expect(call.inTransaction).toBe(true);
      expect(call.transactionNo).toBe(1);
    }

    const decision = Array.from(db.tables.get('account_suggestion_decisions')!.values());
    expect(decision).toHaveLength(1);
    expect(decision[0]).toMatchObject({
      bank_canonical: 'hdfc',
      account_kind: 'bank',
      last_four: '4242',
      decision: 'added',
      account_id: outcome!.accountId,
    });

    const audits = db.auditInserts();
    expect(audits.map(a => a.row.event_type)).toEqual([
      'account_created',
      'detected',
      'detected',
      'detected',
    ]);
    expect(audits[0].row.actor).toBe('user');
    expect(audits[0].row.account_id).toBe(outcome!.accountId);
    for (const a of audits.slice(1)) {
      expect(a.row.actor).toBe('system');
      expect(a.row.account_id).toBe(outcome!.accountId);
      expect(a.call.transactionNo).toBe(1);
    }
    expectNoSmsTextInAudit();

    const state = useTransactionsStore.getState();
    expect(state.accounts.map(a => a.id)).toEqual([outcome!.accountId]);
    const added = state.transactions.filter(t => t.accountId === outcome!.accountId);
    expect(added).toHaveLength(3);
    expect(added.every(t => t.status === 'pending')).toBe(true);
    expect(added.find(t => t.merchantName === 'QA-Cafe')!.categoryId).toBe('cat-food');
    expect(added.find(t => t.merchantName === 'QA-Shop')!.categoryId).toBe('cat-uncategorised');
    expect(added.find(t => t.merchantName === 'QA-Shop')!.sanitizedPreview).toBe(PREVIEW_A);

    // The card leaves the session.
    expect(useSuggestionSession.getState().groups.map(g => g.key)).not.toContain(KEY);
  });

  it('skips items whose hash already exists (dedup unchanged)', async () => {
    useTransactionsStore.setState({ transactions: [existingTxn('sms-1-1700000000001')] });
    const outcome = await addSuggestedAccount(runId, KEY, ACCOUNT_INPUT);
    expect(outcome!.created).toBe(2);
    expect(inserts('transactions')).toHaveLength(2);
    expect(
      inserts('transactions').map(c => c.params).flat(),
    ).not.toContain('sms-1-1700000000001');
  });

  it('auto mode: the Sync SMS rule approves only items ≥ threshold (system actor)', async () => {
    useTransactionsStore.setState({ approvalMode: 'auto', autoApproveThreshold: 90 });
    const outcome = await addSuggestedAccount(runId, KEY, ACCOUNT_INPUT);

    expect(outcome!.created).toBe(3);
    expect(outcome!.autoApproved).toBe(2);
    const autos = db.auditInserts().filter(a => a.row.event_type === 'auto_approved');
    expect(autos).toHaveLength(2);
    for (const { row } of autos) {
      expect(row.actor).toBe('system');
      expect(JSON.parse(String(row.metadata_json))).toEqual({
        kind: 'auto_approved',
        confidence: 90,
        threshold: 90,
      });
    }
    const statuses = useTransactionsStore
      .getState()
      .transactions.filter(t => t.accountId === outcome!.accountId)
      .map(t => [t.merchantName, t.status]);
    expect(statuses).toEqual(
      expect.arrayContaining([
        ['QA-Shop', 'approved'],
        ['QA-Cafe', 'approved'],
        ['QA-Payer', 'pending'],
      ]),
    );
    expect(importSnackbarMessage(outcome!, false)).toBe(
      '1 transaction added to Pending, 2 auto-approved',
    );
    expectNoSmsTextInAudit();
  });

  it('stale run id → null, nothing written', async () => {
    const outcome = await addSuggestedAccount('run-old', KEY, ACCOUNT_INPUT);
    expect(outcome).toBeNull();
    expect(db.calls).toHaveLength(0);
  });
});

describe('linkSuggestion', () => {
  it("no account insert; 'linked' decision; items pending on the chosen account", async () => {
    const outcome = await linkSuggestion(runId, KEY, 'acc-cash');
    expect(outcome!.accountId).toBe('acc-cash');
    expect(inserts('accounts')).toHaveLength(0);
    expect(db.transactionCount()).toBe(1);
    const decision = Array.from(db.tables.get('account_suggestion_decisions')!.values());
    expect(decision[0]).toMatchObject({ decision: 'linked', account_id: 'acc-cash' });
    expect(db.auditInserts().map(a => a.row.event_type)).toEqual([
      'detected',
      'detected',
      'detected',
    ]);
    expect(
      useTransactionsStore.getState().transactions.every(t => t.accountId === 'acc-cash'),
    ).toBe(true);
    expect(importSnackbarMessage(outcome!, true)).toBe('3 transactions added to Pending');
  });
});

describe('ignoreSuggestionGroup', () => {
  it("records an 'ignored' decision, inserts nothing, drops the card", async () => {
    expect(await ignoreSuggestionGroup(runId, KEY)).toBe(true);
    const decision = Array.from(db.tables.get('account_suggestion_decisions')!.values());
    expect(decision).toEqual([
      expect.objectContaining({
        bank_canonical: 'hdfc',
        account_kind: 'bank',
        last_four: '4242',
        decision: 'ignored',
        account_id: null,
      }),
    ]);
    expect(inserts('transactions')).toHaveLength(0);
    expect(db.auditInserts()).toHaveLength(0);
    expect(useSuggestionSession.getState().groups).toHaveLength(0);
  });
});

describe('importSnackbarMessage', () => {
  it('nothing new', () => {
    expect(
      importSnackbarMessage({ accountId: 'a', created: 0, autoApproved: 0, uncategorised: 0 }, false),
    ).toBe('Account added — nothing new to add');
  });
});
