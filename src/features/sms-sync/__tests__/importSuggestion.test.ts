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
  undoLinkSuggestion,
  linkSuggestion,
  preparePendingRows,
} from '../importSuggestion';
import { useSnackbarStore } from '../../../shared/ui/Snackbar';
import { accountRepository } from '../../../data/repositories/account.repository';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { partitionCandidates } from '../smsSyncLogic';
import { toSuggestionDecisions } from '../syncSms';

const accountRepositoryForTest = () => accountRepository;

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
  // An hour later, so it is not a possible duplicate of item 1 (R3b hold).
  parsed('sms-3-1700000000003', {
    merchantName: 'QA-Cafe',
    confidenceScore: 90,
    occurredAt: '2026-10-25T11:00:00.000Z',
  }),
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

  it('R3b: auto mode holds new items that form a possible duplicate pair', async () => {
    const twins = [
      ITEMS[0],
      ITEMS[1],
      parsed('sms-3-1700000000003', { merchantName: 'QA-Cafe', confidenceScore: 90 }), // same time + amount as item 1
    ];
    const twinRun = useSuggestionSession.getState().start(groupUnmatchedCandidates(twins));
    useTransactionsStore.setState({ approvalMode: 'auto', autoApproveThreshold: 90 });
    const outcome = await addSuggestedAccount(twinRun, KEY, ACCOUNT_INPUT);

    expect(outcome!.created).toBe(3);
    expect(outcome!.autoApproved).toBe(0);
    expect(useTransactionsStore.getState().transactions.every(t => t.status === 'pending')).toBe(true);
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
        transactionType: 'expense',
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
    // R5: the link itself is audited — bank id, kind, count; no SMS text, no last-4.
    expect(db.auditInserts().map(a => a.row.event_type)).toEqual([
      'account_linked',
      'detected',
      'detected',
      'detected',
    ]);
    const linked = db.auditInserts().find(a => a.row.event_type === 'account_linked')!;
    expect(linked.row).toMatchObject({ actor: 'user', account_id: 'acc-cash' });
    expect(JSON.parse(String(linked.row.metadata_json))).toEqual({
      kind: 'account_linked',
      bankCanonical: 'hdfc',
      accountKind: 'bank',
      items: 3,
    });
    expect(String(linked.row.metadata_json)).not.toContain('4242');
    expectNoSmsTextInAudit();
    expect(
      useTransactionsStore.getState().transactions.every(t => t.accountId === 'acc-cash'),
    ).toBe(true);
    expect(outcome!.transactionIds).toHaveLength(3);
    expect(importSnackbarMessage(outcome!, true)).toBe('3 transactions added to Pending');
  });

  it('R5: the card disappears; another group is untouched', async () => {
    const other = parsed('sms-9-1700000000009', { bankCanonical: 'sbi', bankName: 'SBI', lastFour: '9999' });
    runId = useSuggestionSession.getState().start(groupUnmatchedCandidates([...ITEMS, other]));
    expect(useSuggestionSession.getState().groups).toHaveLength(2);
    await linkSuggestion(runId, KEY, 'acc-cash');
    const left = useSuggestionSession.getState().groups;
    expect(left).toHaveLength(1);
    expect(left[0].items.map(i => i.sourceReferenceHash)).toEqual(['sms-9-1700000000009']);
    // Only the linked group's rows were inserted.
    expect(useTransactionsStore.getState().transactions.map(t => t.sourceReferenceHash)).not.toContain(
      'sms-9-1700000000009',
    );
  });

  it('R5: the mapping persists — the next sync routes that key to the account', async () => {
    await linkSuggestion(runId, KEY, 'acc-cash');
    const rows = await accountRepositoryForTest().listSuggestionDecisions();
    const decisions = toSuggestionDecisions(rows);
    const later = parsed('sms-5-1700000000005');
    const { matched, unmatched } = partitionCandidates(
      [later],
      [rowToAccount(EXISTING_ACCOUNT_ROW)],
      new Set(),
      decisions,
    );
    expect(unmatched).toEqual([]);
    expect(matched).toEqual([{ parsed: later, accountId: 'acc-cash' }]);
  });

  it('R5: Undo removes the decision + the still-pending rows and puts the card back', async () => {
    const group = useSuggestionSession.getState().groups.find(g => g.key === KEY)!;
    const outcome = (await linkSuggestion(runId, KEY, 'acc-cash'))!;
    expect(useSuggestionSession.getState().groups).toHaveLength(0);
    const removed = await undoLinkSuggestion(runId, group, outcome);
    expect(removed).toBe(3);
    expect(useTransactionsStore.getState().transactions).toHaveLength(0);
    expect(useSuggestionSession.getState().groups.map(g => g.key)).toEqual([KEY]);
    const undoCall = db.calls.find(c => c.sql.startsWith('DELETE FROM account_suggestion_decisions'))!;
    expect(undoCall.sql).toContain("decision = 'linked' AND account_id = ?");
    expect(undoCall.params).toEqual(['hdfc', 'bank', '4242', 'acc-cash']);
    const types = db.auditInserts().map(a => a.row.event_type);
    expect(types.filter(t => t === 'deleted')).toHaveLength(3);
    expect(types[types.length - 1]).toBe('account_unlinked');
    // 'deleted' keeps the usual R1 snapshot (merchant + amount, never SMS
    // text); the unlink row itself carries only bank id, kind and a count.
    const unlinked = db.auditInserts().find(a => a.row.event_type === 'account_unlinked')!;
    expect(JSON.parse(String(unlinked.row.metadata_json))).toEqual({
      kind: 'account_unlinked',
      bankCanonical: 'hdfc',
      accountKind: 'bank',
      items: 3,
    });
    for (const { row } of db.auditInserts()) {
      expect(String(row.metadata_json ?? '')).not.toMatch(/Debited|Credited|4242/);
    }
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
      importSnackbarMessage(
        { accountId: 'a', transactionIds: [], created: 0, autoApproved: 0, uncategorised: 0 },
        false,
      ),
    ).toBe('Account added — nothing new to add');
  });
});

describe('R5-fix C7 — salary from New Accounts Found', () => {
  it('a salary credit imported via Add account goes to Salary, not Uncategorised', async () => {
    useTransactionsStore.setState({
      categories: [...CATEGORIES, category('cat-salary', 'income')],
    });
    const salaryItem = parsed('sms-9-1700000000009', {
      type: 'income',
      amountMinor: 5000000,
      merchantName: 'QA EMPLOYER PVT LTD',
      salary: true,
    });
    const id = useSuggestionSession.getState().start(groupUnmatchedCandidates([salaryItem]));
    const outcome = await addSuggestedAccount(id, KEY, ACCOUNT_INPUT);
    const row = useTransactionsStore.getState().transactions.find(t => t.id === outcome!.transactionIds[0])!;
    expect(row.categoryId).toBe('cat-salary');
  });

  it('preparePendingRows applies the salary flag (merchant rule still wins)', () => {
    const cats = [...CATEGORIES, category('cat-salary', 'income')];
    const item = parsed('sms-9-1', { type: 'income', merchantName: 'QA EMPLOYER', salary: true });
    expect(preparePendingRows([item], cats, {}, new Set(), 'now').rows[0].categoryId).toBe('cat-salary');
    expect(
      preparePendingRows([{ ...item, salary: false }], cats, {}, new Set(), 'now').rows[0].categoryId,
    ).toBe('cat-uncategorised');
  });
});

describe('R5-fix C4 — deleted items are not re-imported from a card', () => {
  it('a tombstoned hash is skipped on Add account', async () => {
    db = createFakeDb({
      accounts: [EXISTING_ACCOUNT_ROW],
      sms_deleted_refs: [{ source_reference_hash: 'sms-1-1700000000001', deleted_at: 'x' }],
    });
    mockGetDatabase.mockReturnValue(db as never);
    const outcome = await addSuggestedAccount(runId, KEY, ACCOUNT_INPUT);
    expect(outcome!.created).toBe(2);
  });
});

describe('R5-fix C11 — Link Undo is exact', () => {
  it('auto mode: Undo also removes the rows auto-approved by the link (audited), card restored with every item', async () => {
    useTransactionsStore.setState({ approvalMode: 'auto', autoApproveThreshold: 90 });
    const group = useSuggestionSession.getState().groups.find(g => g.key === KEY)!;
    const outcome = (await linkSuggestion(runId, KEY, 'acc-cash'))!;
    expect(outcome.autoApproved).toBe(2);
    const removed = await undoLinkSuggestion(runId, group, outcome);
    expect(removed).toBe(3);
    expect(useTransactionsStore.getState().transactions).toHaveLength(0);
    expect(db.tables.get('transactions')?.size ?? 0).toBe(0);
    const deleted = db.auditInserts().filter(a => a.row.event_type === 'deleted');
    expect(deleted.map(d => JSON.parse(String(d.row.metadata_json)).status).sort()).toEqual([
      'approved',
      'approved',
      'pending',
    ]);
    const card = useSuggestionSession.getState().groups.find(g => g.key === KEY)!;
    expect(card.items).toHaveLength(3);
    // No tombstones: the restored card must be importable again.
    expect(db.calls.some(c => /sms_deleted_refs/.test(c.sql) && /^INSERT/.test(c.sql))).toBe(false);
  });

  it('Undo after a sync replaced the run / after leaving the screen: the card comes back and Home can reopen it', async () => {
    const group = useSuggestionSession.getState().groups.find(g => g.key === KEY)!;
    const outcome = (await linkSuggestion(runId, KEY, 'acc-cash'))!;
    // Another session took over (e.g. app restart + new sync with other groups).
    const otherRun = useSuggestionSession.getState().start([]);
    await undoLinkSuggestion(runId, group, outcome);
    const session = useSuggestionSession.getState();
    expect(session.runId).toBe(otherRun);
    expect(session.groups.map(g => g.key)).toEqual([KEY]);
    expect(session.groups[0].items).toHaveLength(3);
    // The persisted summary is back, so Home shows "1 new account found".
    const { useNewAccountsStore } = require('../newAccountsStore');
    expect(useNewAccountsStore.getState().rows.map((r: { lastFour: string }) => r.lastFour)).toEqual(['4242']);
    // Re-linking from the restored card imports everything again.
    const again = await linkSuggestion(otherRun, KEY, 'acc-cash');
    expect(again!.created).toBe(3);
  });

  it('Add / Link / Ignore drop the stored summary row in the decision transaction', async () => {
    await ignoreSuggestionGroup(runId, KEY);
    const del = db.calls.find(c => c.sql.startsWith('DELETE FROM account_suggestion_candidates'))!;
    const dec = db.calls.find(c => /INTO account_suggestion_decisions/.test(c.sql))!;
    expect(del.transactionNo).toBe(dec.transactionNo);
    expect(del.params).toEqual(['hdfc', 'bank', '4242']);
  });
});
