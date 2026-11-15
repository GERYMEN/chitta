/**
 * R5h — every SMS sync lands in Pending, in BOTH approval modes: Sync now /
 * first sync (window sync), the auto-read receiver path (kind 'auto'), a
 * re-scan, and a stored meaning rule. Only a user tap (Pending "Auto-approve"
 * in Automatic mode, or an approve on the row) approves. SYNTHETIC inbox only
 * (QA names, XX1234 / XX9999, refs 000000000xxx).
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';
import { useNewAccountsStore } from '../newAccountsStore';
import { SMS_IDENTITY_SALT_KEY } from '../smsIdentitySalt';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { MeaningRule } from '../../../domain/meaning/meaning.types';
import { incomeExpenseTotals } from '../../../domain/transactions/transaction.rules';
import { autoApproveEligible } from '../../pending/pendingGroups';
import { selectApproved, selectPending } from '../../transactions/state/transactionsStore';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

jest.mock('../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => true),
  requestSmsPermission: jest.fn(async () => 'granted'),
}));

let mockInbox: Array<{ id: string; address: string; body: string; date: number }> = [];
jest.mock('../../../native/android/sms/smsReader', () =>
  jest.requireActual('../../../test/helpers/fakeInbox').fakeInboxModule(() => mockInbox),
);

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const DAY = 86_400_000;
const T0 = 1_762_300_000_000;
const RESCAN = { window: { sinceMs: 0, beforeMs: T0 + 10 * DAY }, kind: 'rescan' as const };
const BANK_SENDER = 'AD-AXISBK-S';
const CARD_SENDER = 'AD-AXISCC-S';

const BODY = {
  cardPayment: 'Rs.5,000.00 debited from A/c XX1234 on 05-11-26 towards Axis Bank Credit Card XX9999 payment. Avl bal Rs 62,000.00',
  paymentReceived: 'Payment of INR 5,000.00 has been received on your Axis Bank Credit Card no. XX9999 on 05-11-26',
  atm: 'Rs.2,000.00 withdrawn at ATM QA0001 from A/c XX1234 on 05-11-26. Avl Bal Rs.8,000.00',
  wallet: 'Rs.500.00 debited from A/c XX1234 on 05-11-26 and added to your Paytm Wallet. Ref 000000000501',
  transfer: 'Rs 3,000.00 transferred from A/c XX1234 to your own A/c XX5678 on 05-11-26. Ref 000000000505',
  emi: 'Rs 12,500.00 debited from A/c XX1234 on 05-11-26 towards EMI for Loan A/c XX0099. Avl bal Rs 49,500.00',
  interest: 'Interest of Rs 312.00 credited to your A/c XX1234 on 01-11-26.',
  refund: 'Rs.250.00 debited on 03-11-26 for UPI Ref 000000000101 has been reversed to your A/c XX1234 on 05-11-26.',
};

const acc = (id: string, name: string, type: string, lastFour: string | null) => ({
  id,
  name,
  type,
  last_four: lastFour,
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
});
const BANK = acc('acc-bank', 'QA Axis Bank', 'bank', '1234');
const CARD = acc('acc-card', 'QA Axis Credit Card', 'credit_card', '9999');

const CATEGORIES = [
  { id: 'cat-uncategorised', name: 'Uncategorised', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
  { id: 'cat-transfer', name: 'Transfer', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
  { id: 'cat-emi', name: 'EMI & Loans', parentId: null, type: 'expense', icon: 'x', isSystem: true, archivedAt: null, color: null },
  { id: 'cat-interest', name: 'Interest', parentId: null, type: 'income', icon: 'x', isSystem: true, archivedAt: null, color: null },
] as const;

let db: FakeDb;
function setup(options: {
  accounts: Array<ReturnType<typeof acc>>;
  mode?: 'auto' | 'manual';
  rules?: MeaningRule[];
  transactions?: Transaction[];
}) {
  mockInbox = [];
  db = createFakeDb({
    accounts: options.accounts,
    app_settings: [{ key: SMS_IDENTITY_SALT_KEY, value: '5a'.repeat(32) }],
    money_meaning_rules: (options.rules ?? []).map(r => ({
      id: r.id,
      bank_canonical: r.bankCanonical,
      kind: r.kind,
      counterparty_key: r.counterpartyKey,
      target_account_id: r.targetAccountId,
      created_at: r.createdAt,
    })),
  });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    accounts: options.accounts.map(row => rowToAccount(row as never)),
    transactions: options.transactions ?? [],
    smsSyncStartAt: new Date(T0 - 30 * DAY).toISOString(),
    smsLastSyncedAt: null,
    categories: CATEGORIES.map(c => ({ ...c })) as never,
    merchantRules: {},
    approvalMode: options.mode ?? 'auto',
    autoApproveThreshold: 70,
    transferDismissals: [],
    duplicateDismissals: [],
    meaningRules: options.rules ?? [],
    meaningSuggestions: [],
  });
  useSuggestionSession.getState().clear();
  useNewAccountsStore.setState({ rows: [] });
}

function inbox(...entries: Array<[string, string, string]>) {
  mockInbox = entries.map(([id, address, body], i) => ({ id, address, body, date: T0 + i * 60_000 }));
}

afterEach(() => mockGetDatabase.mockReset());

const state = () => useTransactionsStore.getState();
const rowBy = (amountMinor: number, type?: Transaction['type']) =>
  state().transactions.find(t => t.amountMinor === amountMinor && (type == null || t.type === type))!;
const auditRows = (eventType: string) => db.auditInserts().filter(a => a.row.event_type === eventType);

const NOW = () => T0 + DAY;
const WINDOW = { now: NOW };

const RULE: MeaningRule = {
  id: 'mrule-qa-h',
  bankCanonical: 'axis',
  kind: 'card_payment',
  counterpartyKey: '9999',
  targetAccountId: 'acc-card',
  createdAt: '2026-11-01T00:00:00.000Z',
};

const SHOP = 'Rs 250.00 debited from A/c XX1234 on 05-11-26 to QA-Shop. Ref 000000000601. Avl bal Rs 9,750.00';
const SALARY = 'Rs 40,000.00 credited to A/c XX1234 on 05-11-26 by QA Employer. Ref 000000000602. Avl bal Rs 49,750.00';

const RUNS: Array<[string, () => ReturnType<typeof syncSms>]> = [
  ['Sync now / first sync', () => syncSms(WINDOW)],
  ['re-scan', () => syncSms(RESCAN)],
  ['auto-read receiver', () => syncSms({ kind: 'auto', requestPermission: false, now: NOW })],
];

describe.each(['auto', 'manual'] as const)('R5h — approval mode %s', mode => {
  it.each(RUNS)('%s: creates only pending rows, approves nothing', async (_name, run) => {
    setup({ accounts: [BANK], mode });
    useTransactionsStore.setState({ autoApproveThreshold: 70 });
    inbox(['1', BANK_SENDER, SHOP], ['2', BANK_SENDER, SALARY]);
    const result = await run();
    expect(result.created).toBe(2);
    expect(result.autoApproved).toBe(0);
    expect(state().transactions).toHaveLength(2);
    for (const t of state().transactions) expect(t.status).toBe('pending');
    expect(auditRows('auto_approved')).toHaveLength(0);
    expect(auditRows('approved')).toHaveLength(0);
    // Totals only follow approved rows.
    expect(incomeExpenseTotals(selectApproved(state()))).toEqual({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
  });

  it('a stored meaning rule produces a pending transfer; its twin stays hidden; approve + Undo are exact', async () => {
    setup({ accounts: [BANK, CARD], mode, rules: [RULE] });
    useTransactionsStore.setState({ autoApproveThreshold: 70 });
    inbox(['1', BANK_SENDER, BODY.cardPayment], ['2', CARD_SENDER, BODY.paymentReceived]);
    const result = await syncSms(WINDOW);
    expect(result.autoApproved).toBe(0);
    const transfer = rowBy(500000, 'transfer');
    const twin = rowBy(500000, 'income');
    expect(transfer).toMatchObject({ status: 'pending', accountId: 'acc-bank', transferAccountId: 'acc-card', categoryId: 'cat-transfer' });
    expect(twin).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: transfer.id });
    expect(auditRows('auto_approved')).toHaveLength(0);

    await state().approve(transfer.id);
    expect(rowBy(500000, 'transfer').status).toBe('approved');
    expect(rowBy(500000, 'income').status).toBe('rejected');

    expect(await state().undoMeaning(transfer.id)).toBe(true);
    expect(state().transactions.find(t => t.id === transfer.id)).toMatchObject({ type: 'expense', status: 'pending', categoryId: 'cat-uncategorised' });
    expect(state().transactions.find(t => t.id === twin.id)).toMatchObject({ type: 'income', status: 'pending', linkKind: null });
  });

  it('held-reason counts are still reported (pairs stay pending either way)', async () => {
    setup({ accounts: [BANK, CARD], mode });
    useTransactionsStore.setState({ autoApproveThreshold: 70 });
    inbox(['1', BANK_SENDER, BODY.cardPayment]);
    const result = await syncSms(WINDOW);
    expect(result.autoApproved).toBe(0);
    expect(rowBy(500000).status).toBe('pending');
    expect(result.heldForCardPayment).toBe(mode === 'auto' ? 1 : 0);
  });
});

describe('R5h — Pending one-tap approve in Automatic mode', () => {
  it('approves the eligible items only when tapped; totals move only then', async () => {
    setup({ accounts: [BANK], mode: 'auto' });
    useTransactionsStore.setState({ autoApproveThreshold: 70 });
    inbox(['1', BANK_SENDER, SHOP], ['2', BANK_SENDER, SALARY]);
    await syncSms(WINDOW);
    expect(selectApproved(state())).toHaveLength(0);
    const pending = selectPending(state());
    const targets = autoApproveEligible(pending, 'auto', 70);
    expect(targets).toHaveLength(2);
    for (const t of targets) {
      await state().approve(t.id, { confidence: t.confidenceScore ?? 0, threshold: 70 });
    }
    expect(selectPending(state())).toHaveLength(0);
    expect(incomeExpenseTotals(selectApproved(state()))).toEqual({ incomeMinor: 4000000, expenseMinor: 25000, netMinor: 3975000 });
  });

  it('manual mode shows no one-tap approve at all', () => {
    expect(autoApproveEligible([], 'manual', 70)).toEqual([]);
  });
});
