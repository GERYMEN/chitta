/**
 * R5e T2 + T5 — money meaning through the real sync path: EMI / interest /
 * template refunds released with their category, card payments / ATM /
 * wallet top-ups / own transfers kept pending + held with a persisted
 * meaning suggestion, a stored meaning rule converting at insert, R3a
 * pairing (both orders), and re-scan suggestions on existing rows.
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
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { MeaningRule } from '../../../domain/meaning/meaning.types';
import { findTransferPairs } from '../../../domain/transfers/transfer.rules';

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
const SAVINGS = acc('acc-sav', 'QA Axis Savings', 'bank', '5678');
const CARD = acc('acc-card', 'QA Axis Credit Card', 'credit_card', '9999');
const PAYTM = acc('acc-paytm', 'QA Paytm Wallet', 'other', null);
const CASH = acc('acc-cash', 'Cash', 'cash', null);

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
const suggestionOf = (id: string) => state().meaningSuggestions.find(s => s.transactionId === id);
const auditRows = (eventType: string) => db.auditInserts().filter(a => a.row.event_type === eventType);

describe('R5e T2 — EMI / interest / template refund: category + released from the hold', () => {
  it('auto mode: EMI → "EMI & Loans", interest → "Interest", refund released — all auto-approved, no suggestion', async () => {
    setup({ accounts: [BANK], mode: 'auto' });
    inbox(['1', BANK_SENDER, BODY.emi], ['2', BANK_SENDER, BODY.interest], ['3', 'AD-HDFCBK-S', BODY.refund]);
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(3);
    const emi = rowBy(1250000);
    const interest = rowBy(31200);
    const refund = rowBy(25000);
    expect(emi.categoryId).toBe('cat-emi');
    expect(emi.type).toBe('expense');
    expect(interest.categoryId).toBe('cat-interest');
    expect(interest.type).toBe('income');
    expect(refund.type).toBe('income');
    for (const t of [emi, interest, refund]) expect(t.status).toBe('approved');
    expect(result.heldByMoneyKind).toEqual({ transfer: 0, atm: 0, wallet_load: 0, emi: 0, refund: 0 });
    expect(state().meaningSuggestions).toEqual([]);
  });

  it('a merchant rule still wins over the EMI category; an archived EMI category falls back', async () => {
    setup({ accounts: [BANK], mode: 'manual' });
    useTransactionsStore.setState({
      categories: CATEGORIES.map(c => (c.id === 'cat-emi' ? { ...c, archivedAt: '2026-11-01T00:00:00.000Z' } : { ...c })) as never,
    });
    inbox(['1', BANK_SENDER, BODY.emi]);
    await syncSms(RESCAN);
    expect(rowBy(1250000).categoryId).toBe('cat-uncategorised');
  });
});

describe('R5e T2 — M1–M4 stay pending + held with a persisted meaning suggestion', () => {
  it('card payment (unique card), ATM (no cash account → missing), wallet (unique), own transfer (unique)', async () => {
    setup({ accounts: [BANK, SAVINGS, CARD, PAYTM], mode: 'auto' });
    inbox(['1', BANK_SENDER, BODY.cardPayment], ['2', BANK_SENDER, BODY.atm], ['3', BANK_SENDER, BODY.wallet], ['4', BANK_SENDER, BODY.transfer]);
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(4);
    const card = rowBy(500000);
    const atm = rowBy(200000);
    const wallet = rowBy(50000);
    const transfer = rowBy(300000);
    for (const t of [card, atm, wallet, transfer]) {
      expect(t.status).toBe('pending');
      expect(t.type).toBe('expense');
    }
    expect(result.autoApproved).toBe(0);
    expect(result.heldForCardPayment).toBe(1);
    expect(result.heldByMoneyKind).toEqual({ transfer: 1, atm: 1, wallet_load: 1, emi: 0, refund: 0 });
    expect(suggestionOf(card.id)).toMatchObject({ kind: 'card_payment', targetAccountId: 'acc-card', reason: 'unique', bankCanonical: 'axis', counterpartyKey: '9999', resolvedAt: null });
    expect(suggestionOf(atm.id)).toMatchObject({ kind: 'atm', targetAccountId: null, reason: 'missing' });
    expect(suggestionOf(wallet.id)).toMatchObject({ kind: 'wallet_load', targetAccountId: 'acc-paytm', reason: 'unique', counterpartyKey: 'paytm' });
    expect(suggestionOf(transfer.id)).toMatchObject({ kind: 'transfer', targetAccountId: 'acc-sav', reason: 'unique', counterpartyKey: '5678' });
    // Persisted (one row per item), ids / enums / last-4 only.
    const stored = Array.from(db.tables.get('money_meaning_suggestions')!.values());
    expect(stored).toHaveLength(4);
    for (const row of stored) {
      expect(Object.keys(row).sort()).toEqual(
        ['bank_canonical', 'counterparty_key', 'created_at', 'kind', 'reason', 'resolution', 'resolved_at', 'rowid', 'target_account_id', 'transaction_id'].sort(),
      );
    }
    // Nothing was converted without the user.
    expect(auditRows('transfer_marked')).toHaveLength(0);
    // A re-scan never adds a second suggestion or a second row.
    expect((await syncSms(RESCAN)).created).toBe(0);
    expect(Array.from(db.tables.get('money_meaning_suggestions')!.values())).toHaveLength(4);
  });
});

describe('R5e T2 — a stored meaning rule converts at insert (R3a one-row transfer)', () => {
  const rule: MeaningRule = {
    id: 'mrule-qa-1',
    bankCanonical: 'axis',
    kind: 'card_payment',
    counterpartyKey: '9999',
    targetAccountId: 'acc-card',
    createdAt: '2026-11-01T00:00:00.000Z',
  };

  it('manual mode: converted but still pending; audit transfer_marked {meaning, rule: true}; re-sync makes 0 rows', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [rule] });
    inbox(['1', BANK_SENDER, BODY.cardPayment]);
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(1);
    const t = state().transactions[0];
    expect(t).toMatchObject({
      type: 'transfer',
      status: 'pending',
      accountId: 'acc-bank',
      transferAccountId: 'acc-card',
      categoryId: 'cat-transfer',
      sourceReferenceHash: `sms-1-${T0}`,
    });
    expect(t.sanitizedPreview).toContain("5,000");
    const marks = auditRows('transfer_marked');
    expect(marks).toHaveLength(1);
    const md = JSON.parse(String(marks[0].row.metadata_json));
    expect(md).toMatchObject({ kind: 'transfer_marked', meaning: 'card_payment', rule: true, transaction_id: t.id, rule_id: 'mrule-qa-1' });
    expect(md.previous.transfer).toMatchObject({ type: 'expense', status: 'pending', accountId: 'acc-bank' });
    // ids / enums / timestamps only — never merchant text, an amount or SMS text.
    expect(String(marks[0].row.metadata_json)).not.toMatch(/5,000|500000|Axis|Unknown|\bpayment\b|XX\d|9999|1234/i);
    expect(suggestionOf(t.id)).toMatchObject({ reason: 'rule', resolution: 'transfer' });
    expect((await syncSms(RESCAN)).created).toBe(0);
  });

  it('auto mode: a converted item at or above the threshold is auto-approved (no hold)', async () => {
    setup({ accounts: [BANK, CARD], mode: 'auto', rules: [rule] });
    inbox(['1', BANK_SENDER, BODY.cardPayment]);
    const result = await syncSms(RESCAN);
    expect(state().transactions[0]).toMatchObject({ type: 'transfer', status: 'approved' });
    expect(result.autoApproved).toBe(1);
    expect(result.heldForCardPayment).toBe(0);
  });

  it('a rule whose target account was removed converts nothing (suggestion only)', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [{ ...rule, targetAccountId: 'acc-gone' }] });
    inbox(['1', BANK_SENDER, BODY.cardPayment]);
    await syncSms(RESCAN);
    const t = state().transactions[0];
    expect(t.type).toBe('expense');
    expect(suggestionOf(t.id)).toMatchObject({ reason: 'unique', targetAccountId: 'acc-card', resolvedAt: null });
  });

  it('with the pending counterpart SMS on the target, the rule hides it as the twin (never counted twice)', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [rule] });
    inbox(['1', BANK_SENDER, BODY.cardPayment], ['2', CARD_SENDER, BODY.paymentReceived]);
    await syncSms(RESCAN);
    const debit = rowBy(500000, 'transfer');
    const credit = rowBy(500000, 'income');
    expect(debit).toMatchObject({ accountId: 'acc-bank', transferAccountId: 'acc-card', status: 'pending' });
    expect(credit).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: debit.id });
    expect(findTransferPairs(state().transactions, state().accounts, [])).toEqual([]);
  });

  it('an APPROVED counterpart is never touched by a rule — the item waits as a suggestion', async () => {
    setup({ accounts: [BANK, CARD], mode: 'manual', rules: [rule] });
    inbox(['2', CARD_SENDER, BODY.paymentReceived]);
    await syncSms(RESCAN);
    const credit = state().transactions[0];
    await state().approve(credit.id);
    mockInbox.push({ id: '1', address: BANK_SENDER, body: BODY.cardPayment, date: T0 + 5 * 60_000 });
    await syncSms(RESCAN);
    const debit = rowBy(500000, 'expense');
    expect(debit.status).toBe('pending');
    expect(rowBy(500000, 'income').status).toBe('approved');
    expect(suggestionOf(debit.id)).toMatchObject({ reason: 'rule', targetAccountId: 'acc-card', resolvedAt: null });
  });
});

describe('R5e T2 — R3a pairing and the meaning suggestion never both act', () => {
  async function pairSetup() {
    setup({ accounts: [BANK, CARD], mode: 'manual' });
    inbox(['1', BANK_SENDER, BODY.cardPayment], ['2', CARD_SENDER, BODY.paymentReceived]);
    await syncSms(RESCAN);
    const debit = rowBy(500000, 'expense');
    const credit = rowBy(500000, 'income');
    expect(findTransferPairs(state().transactions, state().accounts, [])).toHaveLength(1);
    expect(suggestionOf(debit.id)).toMatchObject({ kind: 'card_payment', reason: 'unique', targetAccountId: 'acc-card' });
    // The card's "payment received" is the in side: the bank is picked by the user.
    expect(suggestionOf(credit.id)).toMatchObject({ kind: 'card_payment', reason: 'ambiguous', counterpartyKey: 'in:' });
    return { debit, credit };
  }

  it('order 1: confirming the meaning hides the counterpart as the twin; the pair and both suggestions close', async () => {
    const { debit, credit } = await pairSetup();
    expect(await state().confirmMeaning(debit.id, 'acc-card')).toBe(true);
    expect(rowBy(500000, 'transfer')).toMatchObject({ id: debit.id, status: 'approved', transferAccountId: 'acc-card' });
    expect(state().transactions.find(t => t.id === credit.id)).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin' });
    expect(findTransferPairs(state().transactions, state().accounts, [])).toEqual([]);
    expect(suggestionOf(debit.id)).toMatchObject({ resolution: 'transfer' });
    expect(suggestionOf(credit.id)).toMatchObject({ resolution: 'paired' });
  });

  it('order 1b: confirming the CARD side (from the bank) does the same', async () => {
    const { debit, credit } = await pairSetup();
    expect(await state().confirmMeaning(credit.id, 'acc-bank')).toBe(true);
    expect(state().transactions.find(t => t.id === debit.id)).toMatchObject({ type: 'transfer', accountId: 'acc-bank', transferAccountId: 'acc-card' });
    expect(state().transactions.find(t => t.id === credit.id)).toMatchObject({ status: 'rejected', linkKind: 'transfer_twin' });
    expect(suggestionOf(credit.id)).toMatchObject({ resolution: 'transfer' });
    expect(suggestionOf(debit.id)).toMatchObject({ resolution: 'paired' });
  });

  it('order 2: "It\'s a transfer" on the pair closes both meaning suggestions as paired; Undo reopens them', async () => {
    const { debit, credit } = await pairSetup();
    expect(await state().confirmTransferPair(debit.id, credit.id)).toBe(true);
    expect(suggestionOf(debit.id)).toMatchObject({ resolution: 'paired' });
    expect(suggestionOf(credit.id)).toMatchObject({ resolution: 'paired' });
    // A closed suggestion can no longer convert anything.
    expect(await state().confirmMeaning(debit.id, 'acc-card')).toBe(false);
    expect(await state().undoTransfer(debit.id)).toBe(true);
    expect(suggestionOf(debit.id)?.resolvedAt).toBeNull();
    expect(suggestionOf(credit.id)?.resolvedAt).toBeNull();
  });
});

describe('R5e T2 — confirm / undo / remove (store, audited)', () => {
  it('confirm with "automatically next time" stores a rule; Undo restores the row exactly, reopens the suggestion and removes that rule', async () => {
    setup({ accounts: [BANK, CASH], mode: 'manual' });
    inbox(['1', BANK_SENDER, BODY.atm]);
    await syncSms(RESCAN);
    const before = state().transactions[0];
    expect(suggestionOf(before.id)).toMatchObject({ kind: 'atm', reason: 'unique', targetAccountId: 'acc-cash' });
    expect(await state().confirmMeaning(before.id, 'acc-cash', { remember: true })).toBe(true);
    expect(state().transactions[0]).toMatchObject({ type: 'transfer', accountId: 'acc-bank', transferAccountId: 'acc-cash', status: 'approved', categoryId: 'cat-transfer' });
    expect(state().meaningRules).toEqual([
      expect.objectContaining({ bankCanonical: 'axis', kind: 'atm', counterpartyKey: '', targetAccountId: 'acc-cash' }),
    ]);
    const mark = JSON.parse(String(auditRows('transfer_marked')[0].row.metadata_json));
    expect(mark).toMatchObject({ rule: false, rule_created: true, meaning: 'atm' });

    expect(await state().undoMeaning(before.id)).toBe(true);
    const after = state().transactions[0];
    expect({ ...after, updatedAt: before.updatedAt }).toEqual(before);
    expect(suggestionOf(before.id)).toMatchObject({ resolvedAt: null, resolution: null });
    expect(state().meaningRules).toEqual([]);
    expect(db.tables.get('money_meaning_rules')?.size ?? 0).toBe(0);
    expect(auditRows('transfer_unmarked')).toHaveLength(1);
  });

  it('"It\'s an expense" closes the suggestion with no money change and no audit row', async () => {
    setup({ accounts: [BANK], mode: 'manual' });
    inbox(['1', BANK_SENDER, BODY.atm]);
    await syncSms(RESCAN);
    const t = state().transactions[0];
    const audits = db.auditInserts().length;
    expect(await state().dismissMeaning(t.id)).toBe(true);
    expect(suggestionOf(t.id)).toMatchObject({ resolution: 'expense' });
    expect(state().transactions[0]).toEqual(t);
    expect(db.auditInserts()).toHaveLength(audits);
  });

  it('removing a rule writes meaning_rule_removed (enum + bank id only)', async () => {
    const rule: MeaningRule = { id: 'mrule-qa-2', bankCanonical: 'axis', kind: 'atm', counterpartyKey: '', targetAccountId: 'acc-cash', createdAt: '2026-11-01T00:00:00.000Z' };
    setup({ accounts: [BANK, CASH], mode: 'manual', rules: [rule] });
    await state().removeMeaningRule('mrule-qa-2');
    expect(state().meaningRules).toEqual([]);
    const removed = auditRows('meaning_rule_removed');
    expect(removed).toHaveLength(1);
    expect(JSON.parse(String(removed[0].row.metadata_json))).toEqual({ kind: 'meaning_rule_removed', meaning: 'atm', bankCanonical: 'axis' });
  });

  it('deleting a transaction removes its suggestion; removing the target account removes its rules and sends open suggestions to missing', async () => {
    const rule: MeaningRule = { id: 'mrule-qa-3', bankCanonical: 'axis', kind: 'wallet_load', counterpartyKey: 'paytm', targetAccountId: 'acc-paytm', createdAt: '2026-11-01T00:00:00.000Z' };
    setup({ accounts: [BANK, PAYTM, CASH], mode: 'manual', rules: [] });
    inbox(['1', BANK_SENDER, BODY.wallet], ['2', BANK_SENDER, BODY.atm]);
    await syncSms(RESCAN);
    const wallet = rowBy(50000);
    const atm = rowBy(200000);
    // A rule stored after the sync (so the wallet item above stays a suggestion).
    db.tables.set(
      'money_meaning_rules',
      new Map([[rule.id, { id: rule.id, bank_canonical: 'axis', kind: 'wallet_load', counterparty_key: 'paytm', target_account_id: 'acc-paytm', created_at: rule.createdAt }]]),
    );
    useTransactionsStore.setState({ meaningRules: [rule] });
    expect(suggestionOf(wallet.id)).toMatchObject({ targetAccountId: 'acc-paytm', reason: 'unique' });
    await state().removeAccount('acc-paytm');
    expect(state().meaningRules).toEqual([]);
    expect(suggestionOf(wallet.id)).toMatchObject({ targetAccountId: null, reason: 'missing', resolvedAt: null });
    await state().deleteTransaction(atm.id);
    expect(suggestionOf(atm.id)).toBeUndefined();
  });
});

describe('R5e T5 — a re-scan suggests a meaning for EXISTING plain rows (never changes them)', () => {
  it('an approved expense recorded earlier gets a suggestion; the row is unchanged; the audit counts it', async () => {
    const existing: Transaction = {
      id: 'tx-old',
      type: 'expense',
      status: 'approved',
      amountMinor: 500000,
      currency: 'INR',
      merchantName: 'Unknown',
      categoryId: 'cat-uncategorised',
      accountId: 'acc-bank',
      paymentMethod: 'other',
      occurredAt: new Date(T0).toISOString(),
      detectedAt: new Date(T0).toISOString(),
      approvedAt: new Date(T0).toISOString(),
      note: null,
      sourceType: 'sms',
      sourceReferenceHash: `sms-1-${T0}`,
      sanitizedPreview: 'Debited Rs 5,000.00 — Unknown',
      confidenceScore: 85,
      parserVersion: 'sms-reader-v1',
      createdAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0).toISOString(),
      transferAccountId: null,
      linkedTransactionId: null,
      linkKind: null,
      smsContentHash: null,
      refDigest: null,
    } as Transaction;
    setup({ accounts: [BANK, CARD], mode: 'manual', transactions: [existing] });
    db.tables.get('transactions') ?? db.tables.set('transactions', new Map());
    inbox(['1', BANK_SENDER, BODY.cardPayment]);
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(0);
    expect(result.meaningSuggested).toBe(1);
    expect(state().transactions.find(t => t.id === 'tx-old')).toMatchObject({ type: 'expense', status: 'approved' });
    expect(suggestionOf('tx-old')).toMatchObject({ kind: 'card_payment', targetAccountId: 'acc-card', reason: 'unique', resolvedAt: null });
    const rescan = auditRows('sms_rescan');
    expect(JSON.parse(String(rescan[rescan.length - 1].row.metadata_json)).counts.meaningSuggested).toBe(1);
    // Only on the user's confirm does it convert (approved stays approved).
    expect(await state().confirmMeaning('tx-old', 'acc-card')).toBe(true);
    expect(state().transactions.find(t => t.id === 'tx-old')).toMatchObject({ type: 'transfer', status: 'approved', approvedAt: existing.approvedAt });
    // A second re-scan never suggests it again.
    expect((await syncSms(RESCAN)).meaningSuggested).toBe(0);
  });

  it('a transfer / linked row is never suggested', async () => {
    const base = {
      type: 'transfer', status: 'approved', amountMinor: 500000, currency: 'INR', merchantName: 'Unknown', categoryId: 'cat-transfer',
      accountId: 'acc-bank', transferAccountId: 'acc-card', paymentMethod: 'other', occurredAt: new Date(T0).toISOString(),
      detectedAt: new Date(T0).toISOString(), approvedAt: new Date(T0).toISOString(), note: null, sourceType: 'sms',
      sourceReferenceHash: `sms-1-${T0}`, sanitizedPreview: null, confidenceScore: 85, parserVersion: 'sms-reader-v2',
      createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), linkedTransactionId: null, linkKind: null,
    };
    setup({ accounts: [BANK, CARD], mode: 'manual', transactions: [{ id: 'tx-t', ...base } as never] });
    inbox(['1', BANK_SENDER, BODY.cardPayment]);
    const result = await syncSms(RESCAN);
    expect(result.meaningSuggested).toBe(0);
    expect(state().meaningSuggestions).toEqual([]);
  });
});
