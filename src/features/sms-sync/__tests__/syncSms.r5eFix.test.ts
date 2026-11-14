/**
 * R5e-FIX — money meaning never moves money twice:
 *  M1 duplicate alerts are never converted by a rule;
 *  M2 a card "payment received" > 24 h after the bank debit never becomes a
 *     second transfer (chain / counterpart window), the chain hold is kept;
 *  M4 Undo of a Link restores a pre-existing row the link hid as a twin;
 *  M5 an expense with linked refunds is never converted;
 *  M6 a suggestion whose item changed type never converts;
 *  M7 the paired debit keeps its own approvedAt;
 *  M8 an N1-disagreement row is never hidden by a rule;
 *  K1 a late counterpart becomes the existing transfer's twin;
 *  K2 Undo transfer works on a meaning transfer with no twin.
 * SYNTHETIC inbox only (QA names, XX1234 / XX9999, refs 000000000xxx).
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';
import { useNewAccountsStore } from '../newAccountsStore';
import { SMS_IDENTITY_SALT_KEY } from '../smsIdentitySalt';
import { linkSuggestion, undoLinkSuggestion } from '../importSuggestion';
import { useChainSuggestions } from '../rules/chaining';
import { isMeaningHold } from '../smsSyncLogic';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { MeaningRule } from '../../../domain/meaning/meaning.types';
import { findDuplicatePairs } from '../../../domain/duplicates/duplicate.rules';
import { useSnackbarStore } from '../../../shared/ui/Snackbar';

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
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = 1_762_300_000_000;
const RESCAN = { window: { sinceMs: 0, beforeMs: T0 + 10 * DAY }, kind: 'rescan' as const };
const BANK_SENDER = 'AD-AXISBK-S';
const CARD_SENDER = 'AD-AXISCC-S';

const BODY = {
  cardPayment: 'Rs.5,000.00 debited from A/c XX1234 on 05-11-26 towards Axis Bank Credit Card XX9999 payment. Avl bal Rs 62,000.00',
  paymentReceived: 'Payment of INR 5,000.00 has been received on your Axis Bank Credit Card no. XX9999 on 05-11-26',
  atm: 'Rs.2,000.00 withdrawn at ATM QA0001 from A/c XX1234 on 05-11-26. Avl Bal Rs.8,000.00',
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
const CASH = acc('acc-cash', 'Cash', 'cash', null);

const CATEGORIES = [
  { id: 'cat-uncategorised', name: 'Uncategorised', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
  { id: 'cat-transfer', name: 'Transfer', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
] as const;

const OUT_RULE: MeaningRule = {
  id: 'mrule-qa-out',
  bankCanonical: 'axis',
  kind: 'card_payment',
  counterpartyKey: '9999',
  targetAccountId: 'acc-card',
  createdAt: '2026-11-01T00:00:00.000Z',
};
const IN_RULE: MeaningRule = {
  id: 'mrule-qa-in',
  bankCanonical: 'axis',
  kind: 'card_payment',
  counterpartyKey: 'in:',
  targetAccountId: 'acc-bank',
  createdAt: '2026-11-01T00:00:00.000Z',
};

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
  if (!db.tables.get('transactions')) db.tables.set('transactions', new Map());
  for (const t of options.transactions ?? []) {
    db.tables.get('transactions')!.set(t.id, toRow(t));
  }
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
  useChainSuggestions.getState().clear();
  useNewAccountsStore.setState({ rows: [] });
}

function toRow(t: Transaction): Record<string, unknown> {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    amount_minor: t.amountMinor,
    currency: t.currency,
    merchant_name: t.merchantName,
    category_id: t.categoryId,
    account_id: t.accountId,
    transfer_account_id: t.transferAccountId ?? null,
    payment_method: t.paymentMethod,
    occurred_at: t.occurredAt,
    detected_at: t.detectedAt,
    approved_at: t.approvedAt,
    note: t.note,
    source_type: t.sourceType,
    source_reference_hash: t.sourceReferenceHash,
    sanitized_preview: t.sanitizedPreview,
    confidence_score: t.confidenceScore,
    parser_version: t.parserVersion,
    linked_transaction_id: t.linkedTransactionId ?? null,
    link_kind: t.linkKind ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

/** [id, sender, body, ms offset from T0] */
function inbox(...entries: Array<[string, string, string, number]>) {
  mockInbox = entries.map(([id, address, body, offset]) => ({ id, address, body, date: T0 + offset }));
}

afterEach(() => {
  mockGetDatabase.mockReset();
  useSnackbarStore.getState().dismiss();
});

const state = () => useTransactionsStore.getState();
const byId = (id: string) => state().transactions.find(t => t.id === id)!;
const suggestionOf = (id: string) => state().meaningSuggestions.find(s => s.transactionId === id);
const auditRows = (eventType: string) => db.auditInserts().filter(a => a.row.event_type === eventType);

/** Live money that left the bank a/c (approved or pending, never twins / rejected). */
function bankOutflow(): number {
  return state()
    .transactions.filter(t => t.status === 'approved' || t.status === 'pending')
    .reduce((sum, t) => {
      if (t.type === 'expense' && t.accountId === 'acc-bank') return sum + t.amountMinor;
      if (t.type === 'transfer' && t.accountId === 'acc-bank') return sum + t.amountMinor;
      return sum;
    }, 0);
}
const transfers = () => state().transactions.filter(t => t.type === 'transfer');

const cardCredit = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-card-credit',
    type: 'income',
    status: 'pending',
    amountMinor: 500000,
    currency: 'INR',
    merchantName: 'Unknown',
    categoryId: 'cat-uncategorised',
    accountId: 'acc-card',
    paymentMethod: 'other',
    occurredAt: new Date(T0 + 2 * MIN).toISOString(),
    detectedAt: new Date(T0 + 2 * MIN).toISOString(),
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: 'sms-qa-901',
    sanitizedPreview: null,
    confidenceScore: 90,
    parserVersion: 'sms-reader-v2',
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    ...overrides,
  }) as Transaction;

describe('M1 — duplicate alerts are never converted by a stored rule', () => {
  it('auto mode: the same card-bill alert twice stays two held suggestions; nothing approved, the pair is offered', async () => {
    setup({ accounts: [BANK, CARD], mode: 'auto', rules: [OUT_RULE] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0], ['2', BANK_SENDER, BODY.cardPayment, MIN]);
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(2);
    expect(transfers()).toHaveLength(0);
    expect(result.autoApproved).toBe(0);
    expect(findDuplicatePairs(state().transactions, [])).toHaveLength(1);
    for (const t of state().transactions) {
      expect(t).toMatchObject({ type: 'expense', status: 'pending' });
      expect(suggestionOf(t.id)).toMatchObject({ reason: 'rule', resolvedAt: null });
    }
    expect(auditRows('transfer_marked')).toHaveLength(0);
  });
});

describe('M2 — a card "payment received" more than 24 h after the bank debit', () => {
  it('(a) same run, in-side rule, auto mode: never a second transfer; the bank moves once', async () => {
    setup({ accounts: [BANK, CARD], mode: 'auto', rules: [IN_RULE] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0], ['2', CARD_SENDER, BODY.paymentReceived, 30 * HOUR]);
    await syncSms(RESCAN);
    const debit = state().transactions.find(t => t.sourceReferenceHash === `sms-1-${T0}`)!;
    const credit = state().transactions.find(t => t.sourceReferenceHash === `sms-2-${T0 + 30 * HOUR}`)!;
    // The R5g chain names the debit as the credit's transfer_twin parent: the
    // rule converts the move ONCE — the debit is the transfer, the credit its twin.
    expect(useChainSuggestions.getState().suggestions).toEqual([
      expect.objectContaining({ kind: 'transfer_twin', childId: credit.id, parentId: debit.id }),
    ]);
    expect(transfers()).toHaveLength(1);
    expect(byId(debit.id)).toMatchObject({ type: 'transfer', accountId: 'acc-bank', transferAccountId: 'acc-card' });
    expect(byId(credit.id)).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: debit.id });
    // Whatever the user confirms next, the bank moves once.
    const open = state().meaningSuggestions.filter(s => s.resolvedAt == null);
    for (const s of open) {
      const target = s.transactionId === debit.id ? 'acc-card' : 'acc-bank';
      await state().confirmMeaning(s.transactionId, target);
    }
    expect(transfers()).toHaveLength(1);
    expect(bankOutflow()).toBe(500000);
  });

  it('(b) two syncs, manual mode: the debit kept as an expense, then the credit: never converted alone', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [IN_RULE] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const debit = state().transactions[0];
    expect(await state().dismissMeaning(debit.id)).toBe(true);
    await state().approve(debit.id);
    mockInbox.push({ id: '2', address: CARD_SENDER, body: BODY.paymentReceived, date: T0 + 30 * HOUR });
    await syncSms(RESCAN);
    const credit = state().transactions.find(t => t.type === 'income')!;
    expect(credit.status).toBe('pending');
    expect(transfers()).toHaveLength(0);
    expect(suggestionOf(credit.id)).toMatchObject({ resolvedAt: null });
    await state().approve(credit.id);
    expect(bankOutflow()).toBe(500000);
  });

  it('(b2) confirming that credit makes the earlier debit the transfer and hides the credit as its twin', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [IN_RULE] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const debit = state().transactions[0];
    await state().dismissMeaning(debit.id);
    await state().approve(debit.id);
    mockInbox.push({ id: '2', address: CARD_SENDER, body: BODY.paymentReceived, date: T0 + 30 * HOUR });
    await syncSms(RESCAN);
    const credit = state().transactions.find(t => t.type === 'income')!;
    expect(await state().confirmMeaning(credit.id, 'acc-bank')).toBe(true);
    expect(byId(debit.id)).toMatchObject({ type: 'transfer', accountId: 'acc-bank', transferAccountId: 'acc-card' });
    expect(byId(credit.id)).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: debit.id });
    expect(bankOutflow()).toBe(500000);
  });

  it('(b) in auto mode: the lone credit is neither converted nor auto-approved', async () => {
    setup({ accounts: [BANK, CARD], mode: 'auto', rules: [IN_RULE] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const debit = state().transactions[0];
    await state().dismissMeaning(debit.id);
    await state().approve(debit.id);
    mockInbox.push({ id: '2', address: CARD_SENDER, body: BODY.paymentReceived, date: T0 + 30 * HOUR });
    const result = await syncSms(RESCAN);
    const credit = state().transactions.find(t => t.id !== debit.id)!;
    expect(credit).toMatchObject({ type: 'income', status: 'pending', linkKind: null });
    expect(result.autoApproved).toBe(0);
    expect(bankOutflow()).toBe(500000);
  });

  it('only meaning hold reasons are released by a conversion — never chain / N1', () => {
    expect(['transfer', 'atm', 'wallet_load'].every(r => isMeaningHold(r as never))).toBe(true);
    expect(isMeaningHold('chain')).toBe(false);
    expect(isMeaningHold('rule_disagreement')).toBe(false);
    expect(isMeaningHold(undefined)).toBe(false);
  });
});

describe('M4 — Undo of a Link restores the pre-existing counterpart the link hid', () => {
  it('the card credit from an earlier sync comes back exactly; only the linked rows are deleted', async () => {
    const BANK_NO_DIGITS = acc('acc-bank', 'QA Axis Bank', 'bank', null);
    setup({ accounts: [BANK_NO_DIGITS, CARD], mode: 'manual', rules: [OUT_RULE] });
    inbox(['2', CARD_SENDER, BODY.paymentReceived, 2 * MIN], ['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const credit = state().transactions.find(t => t.type === 'income')!;
    expect(credit.status).toBe('pending');
    const session = useSuggestionSession.getState();
    const group = session.groups[0];
    expect(group).toBeDefined();
    const outcome = (await linkSuggestion(session.runId!, group.key, 'acc-bank'))!;
    expect(byId(credit.id)).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin' });
    const removed = await undoLinkSuggestion(session.runId!, group, outcome);
    expect(removed).toBe(1);
    const after = byId(credit.id);
    expect(after).toMatchObject({ type: 'income', status: 'pending', linkKind: null, linkedTransactionId: null, accountId: 'acc-card' });
    expect(state().transactions).toHaveLength(1);
    const stored = db.tables.get('transactions')!.get(credit.id) as Record<string, unknown>;
    expect(stored).toMatchObject({ status: 'pending', link_kind: null, linked_transaction_id: null });
  });
});

describe('M5 — an expense with linked refunds is never converted (R3b.1)', () => {
  it('confirmMeaning refuses with no writes', async () => {
    setup({ accounts: [BANK, CASH], mode: 'manual' });
    inbox(['1', BANK_SENDER, BODY.atm, 0]);
    await syncSms(RESCAN);
    const atm = state().transactions[0];
    await state().approve(atm.id);
    const refund = cardCredit({ id: 'tx-refund', accountId: 'acc-bank', amountMinor: 25000, status: 'approved', linkKind: 'refund', linkedTransactionId: atm.id });
    useTransactionsStore.setState({ transactions: [...state().transactions, refund] });
    const before = byId(atm.id);
    const audits = db.auditInserts().length;
    expect(await state().confirmMeaning(atm.id, 'acc-cash')).toBe(false);
    expect(byId(atm.id)).toEqual(before);
    expect(db.auditInserts()).toHaveLength(audits);
  });
});

describe('M6 — a suggestion whose item changed type never converts', () => {
  it('editing the type closes the open suggestion; a stale one is refused', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual' });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const row = state().transactions[0];
    expect(suggestionOf(row.id)).toMatchObject({ resolvedAt: null, counterpartyKey: '9999' });
    // A stale open suggestion (type changed behind its back) is refused.
    useTransactionsStore.setState({ transactions: state().transactions.map(t => (t.id === row.id ? { ...t, type: 'income' as const } : t)) });
    expect(await state().confirmMeaning(row.id, 'acc-card')).toBe(false);
    expect(byId(row.id).type).toBe('income');
    useTransactionsStore.setState({ transactions: state().transactions.map(t => (t.id === row.id ? { ...t, type: 'expense' as const } : t)) });
    // Editing the type through the store closes it.
    expect(await state().updateTransaction(row.id, { type: 'income' })).toBe(true);
    expect(suggestionOf(row.id)?.resolvedAt).not.toBeNull();
    expect(await state().confirmMeaning(row.id, 'acc-card')).toBe(false);
    expect(transfers()).toHaveLength(0);
  });
});

describe('M7 — confirming the credit side keeps the paired debit\'s approvedAt', () => {
  it('the approved debit becomes the transfer with its own approvedAt', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual' });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0], ['2', CARD_SENDER, BODY.paymentReceived, MIN]);
    await syncSms(RESCAN);
    const debit = state().transactions.find(t => t.type === 'expense')!;
    const credit = state().transactions.find(t => t.type === 'income')!;
    const approvedAt = '2026-11-01T00:00:00.000Z';
    useTransactionsStore.setState({
      transactions: state().transactions.map(t => (t.id === debit.id ? { ...t, status: 'approved' as const, approvedAt } : t)),
    });
    expect(await state().confirmMeaning(credit.id, 'acc-bank')).toBe(true);
    expect(byId(debit.id)).toMatchObject({ type: 'transfer', status: 'approved', approvedAt });
  });
});

describe('M8 — a stored rule never hides an N1-disagreement row', () => {
  it('the debit stays a suggestion and the disagreement credit stays pending for the user', async () => {
    const disagree = cardCredit({ parserVersion: 'sms-reader-v2+rules-v4:disagree:T-AXIS-0004' });
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [OUT_RULE], transactions: [disagree] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const debit = state().transactions.find(t => t.id !== disagree.id)!;
    expect(debit.type).toBe('expense');
    expect(byId(disagree.id)).toMatchObject({ status: 'pending', linkKind: null });
    expect(suggestionOf(debit.id)).toMatchObject({ reason: 'rule', resolvedAt: null });
  });
});

describe('K1 — a late counterpart becomes the existing transfer\'s twin', () => {
  it('next sync: the card credit 30 h later is hidden as the rule-made transfer\'s twin; no second confirm', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [OUT_RULE] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const transfer = state().transactions[0];
    expect(transfer).toMatchObject({ type: 'transfer', transferAccountId: 'acc-card' });
    mockInbox.push({ id: '2', address: CARD_SENDER, body: BODY.paymentReceived, date: T0 + 30 * HOUR });
    await syncSms(RESCAN);
    const credit = state().transactions.find(t => t.id !== transfer.id)!;
    expect(credit).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: transfer.id });
    expect(state().meaningSuggestions.filter(s => s.resolvedAt == null)).toEqual([]);
    expect(transfers()).toHaveLength(1);
    // The twin mark holds ids / enums only.
    const marks = auditRows('transfer_marked');
    expect(marks).toHaveLength(2);
    expect(String(marks[1].row.metadata_json)).not.toMatch(/5,000|500000|Axis|XX\d|9999|1234/i);

    // Undo transfer (Detail) restores BOTH SMS items exactly; the stored rule stays.
    expect(await state().undoTransfer(transfer.id)).toBe(true);
    expect(byId(transfer.id)).toMatchObject({ type: 'expense', accountId: 'acc-bank', transferAccountId: null });
    expect(byId(credit.id)).toMatchObject({ type: 'income', status: 'pending', linkKind: null, linkedTransactionId: null });
    expect(state().meaningRules).toHaveLength(1);
  });

  it('a confirm of the late row (Snackbar Undo) only detaches it again', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [OUT_RULE] });
    inbox(['1', BANK_SENDER, BODY.cardPayment, 0]);
    await syncSms(RESCAN);
    const transfer = state().transactions[0];
    // The late credit arrived as a disagreement row (never hidden automatically).
    const late = cardCredit({ id: 'tx-late', occurredAt: new Date(T0 + 30 * HOUR).toISOString(), parserVersion: 'sms-reader-v2+rules-v4:disagree:T-AXIS-0004' });
    useTransactionsStore.setState({
      transactions: [...state().transactions, late],
      meaningSuggestions: [
        ...state().meaningSuggestions,
        { transactionId: late.id, kind: 'card_payment', targetAccountId: 'acc-bank', reason: 'unique', bankCanonical: 'axis', counterpartyKey: 'in:', createdAt: late.createdAt, resolvedAt: null, resolution: null },
      ],
    });
    db.tables.get('transactions')!.set(late.id, toRow(late));
    expect(await state().confirmMeaning(late.id, 'acc-bank')).toBe(true);
    expect(transfers()).toHaveLength(1);
    expect(byId(late.id)).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: transfer.id });
    expect(await state().undoMeaning(transfer.id)).toBe(true);
    expect(byId(late.id)).toMatchObject({ status: 'pending', linkKind: null });
    expect(byId(transfer.id)).toMatchObject({ type: 'transfer' });
    expect(suggestionOf(late.id)?.resolvedAt).toBeNull();
    // A second Undo transfer undoes the original conversion.
    expect(await state().undoTransfer(transfer.id)).toBe(true);
    expect(byId(transfer.id)).toMatchObject({ type: 'expense' });
  });
});

describe('K2 — Undo transfer on a meaning transfer with no twin', () => {
  it('restores the row exactly and removes the rule that confirm created', async () => {
    setup({ accounts: [BANK, CASH], mode: 'manual' });
    inbox(['1', BANK_SENDER, BODY.atm, 0]);
    await syncSms(RESCAN);
    const before = state().transactions[0];
    expect(await state().confirmMeaning(before.id, 'acc-cash', { remember: true })).toBe(true);
    expect(state().meaningRules).toHaveLength(1);
    expect(await state().undoTransfer(before.id)).toBe(true);
    expect({ ...byId(before.id), updatedAt: before.updatedAt }).toEqual(before);
    expect(state().meaningRules).toEqual([]);
    expect(suggestionOf(before.id)).toMatchObject({ resolvedAt: null });
  });
});
