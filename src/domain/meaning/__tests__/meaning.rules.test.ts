/**
 * R5e T1 — meaning target resolution (every branch) + the one-row transfer
 * conversion and its exact undo. SYNTHETIC accounts only (QA names, ••1234 /
 * ••9999).
 */
import type { Account, AccountType } from '../../accounts/account.types';
import type { Transaction } from '../../transactions/transaction.types';
import {
  buildMeaningConversion,
  candidateFromSuggestion,
  counterpartyKeyOf,
  meaningKindOf,
  openMeaningIds,
  resolveMeaningTarget,
  targetAccountTypes,
  undoMeaningConversion,
} from '../meaning.rules';
import type { MeaningCandidate, MeaningRule } from '../meaning.types';
import { bankCanonicalForText } from '../../../features/sms-sync/normalizeAccountKey';

const T = '2026-11-05T10:00:00.000Z';
function account(id: string, name: string, type: AccountType, lastFour: string | null, deletedAt: string | null = null): Account {
  return {
    id,
    name,
    type,
    lastFour,
    openingBalanceMinor: 0,
    currency: 'INR',
    isActive: true,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    deletedAt,
    creditLimitMinor: null,
    createdAt: T,
    updatedAt: T,
  };
}

const BANK = account('bank', 'QA HDFC Bank', 'bank', '1234');
const BANK2 = account('bank2', 'QA SBI Savings', 'bank', '5678');
const CARD = account('card', 'QA HDFC Credit Card', 'credit_card', '9999');
const CARD_SAME_SUFFIX = account('card2', 'QA HDFC Platinum Card', 'credit_card', '1999');
const CARD_OTHER_BANK = account('card3', 'QA SBI Card', 'credit_card', '4321');
const CASH = account('cash', 'Cash', 'cash', null);
const CASH2 = account('cash2', 'QA Petty Cash', 'cash', null);
const PAYTM = account('paytm', 'QA Paytm Wallet', 'other', null);
const AMAZON = account('amazon', 'QA Amazon Pay', 'other', null);
const DELETED_CARD = account('gone', 'QA HDFC Old Card', 'credit_card', '9999', T);

const bankOf = (a: Pick<Account, 'name'>) => bankCanonicalForText(a.name);
const out = (kind: MeaningCandidate['kind'], extra: Partial<MeaningCandidate> = {}): MeaningCandidate => ({
  kind,
  side: 'out',
  accountId: 'bank',
  bankCanonical: 'hdfc',
  ...extra,
});

interface Row {
  name: string;
  candidate: MeaningCandidate;
  accounts: Account[];
  rules?: MeaningRule[];
  expect: { target: string | null; reason: string };
}

const rule = (patch: Partial<MeaningRule>): MeaningRule => ({
  id: 'r1',
  bankCanonical: 'hdfc',
  kind: 'card_payment',
  counterpartyKey: '9999',
  targetAccountId: 'card',
  createdAt: T,
  ...patch,
});

const TABLE: Row[] = [
  // rule
  { name: 'rule: stored rule with an active target wins', candidate: out('card_payment', { counterpartyLastFour: '9999' }), accounts: [BANK, CARD, CARD_SAME_SUFFIX], rules: [rule({ targetAccountId: 'card2' })], expect: { target: 'card2', reason: 'rule' } },
  { name: 'rule: a rule pointing at a deleted account is ignored', candidate: out('card_payment', { counterpartyLastFour: '9999' }), accounts: [BANK, CARD, DELETED_CARD], rules: [rule({ targetAccountId: 'gone' })], expect: { target: 'card', reason: 'unique' } },
  { name: 'rule: another counterparty key does not match', candidate: out('card_payment', { counterpartyLastFour: '4321' }), accounts: [BANK, CARD, CARD_OTHER_BANK], rules: [rule({})], expect: { target: 'card3', reason: 'unique' } },
  { name: 'rule: the in side never reuses an out-side rule', candidate: { ...out('card_payment'), side: 'in', accountId: 'card' }, accounts: [BANK, CARD], rules: [rule({ counterpartyKey: '' , targetAccountId: 'card' })], expect: { target: null, reason: 'ambiguous' } },
  // card_payment out
  { name: 'card out: last-4 → unique credit card', candidate: out('card_payment', { counterpartyLastFour: '9999' }), accounts: [BANK, CARD, CARD_OTHER_BANK, DELETED_CARD], expect: { target: 'card', reason: 'unique' } },
  { name: 'card out: last-4 with no card → missing', candidate: out('card_payment', { counterpartyLastFour: '7777' }), accounts: [BANK, CARD], expect: { target: null, reason: 'missing' } },
  { name: 'card out: last-4 never matches a BANK a/c with those digits', candidate: out('card_payment', { counterpartyLastFour: '5678' }), accounts: [BANK, BANK2, CARD], expect: { target: null, reason: 'missing' } },
  { name: 'card out: two cards with the same last-4 → ambiguous', candidate: out('card_payment', { counterpartyLastFour: '9999' }), accounts: [BANK, CARD, account('card4', 'QA Other Card', 'credit_card', '9999')], expect: { target: null, reason: 'ambiguous' } },
  { name: 'card out: 3-digit mask → suffix on the same bank (unique)', candidate: out('card_payment', { counterpartyLastDigits: '999' }), accounts: [BANK, CARD, CARD_OTHER_BANK], expect: { target: 'card', reason: 'unique' } },
  { name: 'card out: 3-digit mask matching two cards of the bank → ambiguous', candidate: out('card_payment', { counterpartyLastDigits: '999' }), accounts: [BANK, CARD, CARD_SAME_SUFFIX], expect: { target: null, reason: 'ambiguous' } },
  { name: 'card out: 3-digit mask, unknown bank → missing', candidate: out('card_payment', { counterpartyLastDigits: '999', bankCanonical: 'unknown' }), accounts: [BANK, CARD], expect: { target: null, reason: 'missing' } },
  { name: 'card out: no digits → the only card of the same bank', candidate: out('card_payment'), accounts: [BANK, CARD, CARD_OTHER_BANK], expect: { target: 'card', reason: 'unique' } },
  { name: 'card out: no digits, two cards of the bank → ambiguous', candidate: out('card_payment'), accounts: [BANK, CARD, CARD_SAME_SUFFIX], expect: { target: null, reason: 'ambiguous' } },
  { name: 'card out: no digits, no card of the bank → missing', candidate: out('card_payment'), accounts: [BANK, CARD_OTHER_BANK], expect: { target: null, reason: 'missing' } },
  // atm
  { name: 'atm: the only cash account', candidate: out('atm'), accounts: [BANK, CASH, CARD], expect: { target: 'cash', reason: 'unique' } },
  { name: 'atm: two cash accounts → ambiguous', candidate: out('atm'), accounts: [BANK, CASH, CASH2], expect: { target: null, reason: 'ambiguous' } },
  { name: 'atm: no cash account → missing', candidate: out('atm'), accounts: [BANK, CARD], expect: { target: null, reason: 'missing' } },
  { name: 'atm: a deleted cash account is not a target', candidate: out('atm'), accounts: [BANK, account('oldcash', 'Cash', 'cash', null, T)], expect: { target: null, reason: 'missing' } },
  // wallet_load out
  { name: 'wallet out: the wallet of that institution', candidate: out('wallet_load', { counterpartyInstitution: 'paytm' }), accounts: [BANK, PAYTM, AMAZON], expect: { target: 'paytm', reason: 'unique' } },
  { name: 'wallet out: no account of that wallet → missing', candidate: out('wallet_load', { counterpartyInstitution: 'paytm' }), accounts: [BANK, AMAZON], expect: { target: null, reason: 'missing' } },
  { name: 'wallet out: two accounts of that wallet → ambiguous', candidate: out('wallet_load', { counterpartyInstitution: 'paytm' }), accounts: [BANK, PAYTM, account('paytm2', 'QA Paytm Postpaid', 'other', null)], expect: { target: null, reason: 'ambiguous' } },
  { name: 'wallet out: wallet not named, one other account → unique', candidate: out('wallet_load'), accounts: [BANK, PAYTM, CARD], expect: { target: 'paytm', reason: 'unique' } },
  { name: 'wallet out: wallet not named, two other accounts → ambiguous', candidate: out('wallet_load'), accounts: [BANK, PAYTM, AMAZON], expect: { target: null, reason: 'ambiguous' } },
  // transfer
  { name: 'transfer: counterparty last-4 → the own account', candidate: out('transfer', { counterpartyLastFour: '5678' }), accounts: [BANK, BANK2, CARD], expect: { target: 'bank2', reason: 'unique' } },
  { name: 'transfer: counterparty last-4 not found → missing', candidate: out('transfer', { counterpartyLastFour: '0000' }), accounts: [BANK, BANK2], expect: { target: null, reason: 'missing' } },
  { name: 'transfer: no digits → the user picks (ambiguous) even with one other account', candidate: out('transfer'), accounts: [BANK, BANK2], expect: { target: null, reason: 'ambiguous' } },
  { name: 'transfer: no other account → missing', candidate: out('transfer'), accounts: [BANK], expect: { target: null, reason: 'missing' } },
  { name: 'transfer: never the item’s own account', candidate: out('transfer', { counterpartyLastFour: '1234' }), accounts: [BANK, BANK2], expect: { target: null, reason: 'missing' } },
  // the bank side of card / wallet credits ('in')
  { name: 'card in: bank digits → the bank a/c', candidate: { ...out('card_payment', { counterpartyLastFour: '1234' }), side: 'in', accountId: 'card' }, accounts: [BANK, BANK2, CARD], expect: { target: 'bank', reason: 'unique' } },
  { name: 'card in: no digits → the user picks', candidate: { ...out('card_payment'), side: 'in', accountId: 'card' }, accounts: [BANK, CARD], expect: { target: null, reason: 'ambiguous' } },
  { name: 'wallet in: bank digits → the bank a/c (never another card)', candidate: { ...out('wallet_load', { counterpartyLastFour: '9999' }), side: 'in', accountId: 'paytm', bankCanonical: 'paytm' }, accounts: [BANK, CARD, PAYTM], expect: { target: null, reason: 'missing' } },
  { name: 'wallet in: bank digits → unique bank', candidate: { ...out('wallet_load', { counterpartyLastFour: '1234' }), side: 'in', accountId: 'paytm', bankCanonical: 'paytm' }, accounts: [BANK, CARD, PAYTM], expect: { target: 'bank', reason: 'unique' } },
];

describe('R5e T1 — resolveMeaningTarget', () => {
  it.each(TABLE.map(r => [r.name, r] as const))('%s', (_name, r) => {
    const result = resolveMeaningTarget(r.candidate, r.accounts, r.rules ?? [], bankOf);
    expect(result).toEqual({ kind: r.candidate.kind, target: r.expect.target, reason: r.expect.reason });
  });

  it('meaningKindOf: only M1–M4 hints are meanings (emi / interest / refund are category / release only)', () => {
    expect(['card_payment', 'atm', 'wallet_load', 'transfer'].map(meaningKindOf)).toEqual(['card_payment', 'atm', 'wallet_load', 'transfer']);
    expect(['emi', 'interest', 'refund', undefined, 'spend'].map(meaningKindOf)).toEqual([null, null, null, null, null]);
  });

  it('counterparty key: last-4, else 3-digit mask, else wallet id, else empty; in side prefixed', () => {
    expect(counterpartyKeyOf({ side: 'out', counterpartyLastFour: '9999', counterpartyInstitution: 'paytm' })).toBe('9999');
    expect(counterpartyKeyOf({ side: 'out', counterpartyLastDigits: '999' })).toBe('999');
    expect(counterpartyKeyOf({ side: 'out', counterpartyInstitution: 'paytm' })).toBe('paytm');
    expect(counterpartyKeyOf({ side: 'out' })).toBe('');
    expect(counterpartyKeyOf({ side: 'in', counterpartyLastFour: '1234' })).toBe('in:1234');
    expect(counterpartyKeyOf({ side: 'in' })).toBe('in:');
    // Garbage never becomes part of a key.
    expect(counterpartyKeyOf({ side: 'out', counterpartyLastFour: '12a4', counterpartyInstitution: 'Pay TM!' })).toBe('');
  });

  it('a stored suggestion re-resolves to the same candidate (live after "Add account")', () => {
    for (const c of [
      out('card_payment', { counterpartyLastFour: '9999' }),
      out('card_payment', { counterpartyLastDigits: '999' }),
      out('wallet_load', { counterpartyInstitution: 'paytm' }),
      { ...out('transfer', { counterpartyLastFour: '5678' }), side: 'in' as const },
      out('atm'),
    ]) {
      const back = candidateFromSuggestion({ kind: c.kind, bankCanonical: c.bankCanonical, counterpartyKey: counterpartyKeyOf(c) }, c.accountId);
      expect(resolveMeaningTarget(back, [BANK, BANK2, CARD, CASH, PAYTM], [], bankOf)).toEqual(
        resolveMeaningTarget(c, [BANK, BANK2, CARD, CASH, PAYTM], [], bankOf),
      );
    }
    // Missing → the account is added → the same suggestion now resolves.
    const missing = out('card_payment', { counterpartyLastFour: '9999' });
    expect(resolveMeaningTarget(missing, [BANK], [], bankOf).reason).toBe('missing');
    expect(resolveMeaningTarget(missing, [BANK, CARD], [], bankOf)).toEqual({ kind: 'card_payment', target: 'card', reason: 'unique' });
  });

  it('picker types per kind and side', () => {
    expect(targetAccountTypes('card_payment', 'out')).toEqual(['credit_card', 'pay_later']);
    expect(targetAccountTypes('atm', 'out')).toEqual(['cash']);
    expect(targetAccountTypes('wallet_load', 'out')).toEqual(['other']);
    expect(targetAccountTypes('card_payment', 'in')).not.toContain('credit_card');
    expect(targetAccountTypes('transfer', 'out')).toHaveLength(6);
  });
});

// ---- conversion ------------------------------------------------------------------

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'pending',
    amountMinor: 1000000,
    currency: 'INR',
    merchantName: 'QA-Merchant-50',
    categoryId: 'cat-uncategorised',
    accountId: 'bank',
    paymentMethod: 'other',
    occurredAt: T,
    detectedAt: T,
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: `sms-${id}-1`,
    sanitizedPreview: 'Debited Rs 10,000.00 — QA-Merchant-50',
    confidenceScore: 90,
    parserVersion: 'sms-reader-v2',
    createdAt: T,
    updatedAt: T,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    ...patch,
  } as Transaction;
}

const NOW = '2026-11-06T09:00:00.000Z';

describe('R5e — buildMeaningConversion / undoMeaningConversion', () => {
  it('expense on the bank → ONE transfer bank → card; merchant, hash, preview kept; user confirm approves', () => {
    const row = tx('e1', {});
    const c = buildMeaningConversion(row, 'card', null, NOW, { approve: true })!;
    expect(c.twin).toBeNull();
    expect(c.transfer).toMatchObject({
      id: 'e1',
      type: 'transfer',
      accountId: 'bank',
      transferAccountId: 'card',
      categoryId: 'cat-transfer',
      status: 'approved',
      approvedAt: NOW,
      merchantName: row.merchantName,
      sourceReferenceHash: row.sourceReferenceHash,
      sanitizedPreview: row.sanitizedPreview,
    });
    const undone = undoMeaningConversion(c.transfer, null, c.previous, '2026-11-06T09:05:00.000Z')!;
    expect({ ...undone.transfer, updatedAt: row.updatedAt }).toEqual(row);
  });

  it('income on a wallet → transfer FROM the target bank TO the wallet (account moves); exact undo', () => {
    const row = tx('i1', { type: 'income', accountId: 'paytm', status: 'approved', approvedAt: T });
    const c = buildMeaningConversion(row, 'bank', null, NOW, { approve: true })!;
    expect(c.transfer).toMatchObject({ accountId: 'bank', transferAccountId: 'paytm', status: 'approved', approvedAt: T });
    const undone = undoMeaningConversion(c.transfer, null, c.previous, NOW)!;
    expect({ ...undone.transfer, updatedAt: row.updatedAt }).toEqual(row);
  });

  it('a stored rule (approve false) keeps a pending item pending', () => {
    const c = buildMeaningConversion(tx('e2', {}), 'card', null, NOW, { approve: false })!;
    expect(c.transfer.status).toBe('pending');
    expect(c.transfer.approvedAt).toBeNull();
  });

  it('with the counterpart SMS: the expense is the transfer, the income its rejected twin (either row confirmed)', () => {
    const debit = tx('d1', {});
    const credit = tx('c1', { type: 'income', accountId: 'card', status: 'approved', approvedAt: T });
    for (const [row, partner] of [[debit, credit], [credit, debit]] as const) {
      const target = row.id === 'd1' ? 'card' : 'bank';
      const c = buildMeaningConversion(row, target, partner, NOW, { approve: true })!;
      expect(c.transfer).toMatchObject({ id: 'd1', type: 'transfer', accountId: 'bank', transferAccountId: 'card' });
      expect(c.twin).toMatchObject({ id: 'c1', status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: 'd1' });
      const undone = undoMeaningConversion(c.transfer, c.twin, c.previous, NOW)!;
      expect({ ...undone.transfer, updatedAt: T }).toEqual(debit);
      expect({ ...undone.twin!, updatedAt: T }).toEqual(credit);
    }
  });

  it('refuses: same account, a transfer / linked / rejected row, a mismatched partner', () => {
    expect(buildMeaningConversion(tx('x', {}), 'bank', null, NOW, { approve: true })).toBeNull();
    expect(buildMeaningConversion(tx('x', { type: 'transfer' }), 'card', null, NOW, { approve: true })).toBeNull();
    expect(buildMeaningConversion(tx('x', { linkKind: 'refund', linkedTransactionId: 'y' }), 'card', null, NOW, { approve: true })).toBeNull();
    expect(buildMeaningConversion(tx('x', { status: 'rejected' }), 'card', null, NOW, { approve: true })).toBeNull();
    const credit = tx('c', { type: 'income', accountId: 'card', amountMinor: 1 });
    expect(buildMeaningConversion(tx('x', {}), 'card', credit, NOW, { approve: true })).toBeNull();
    expect(buildMeaningConversion(tx('x', {}), 'card', tx('c2', { type: 'income', accountId: 'cash' }), NOW, { approve: true })).toBeNull();
  });

  it('undo refuses rows that are no longer that conversion', () => {
    const c = buildMeaningConversion(tx('d', {}), 'card', tx('c', { type: 'income', accountId: 'card' }), NOW, { approve: true })!;
    expect(undoMeaningConversion({ ...c.transfer, type: 'expense' }, c.twin, c.previous, NOW)).toBeNull();
    expect(undoMeaningConversion(c.transfer, { ...c.twin!, linkKind: null }, c.previous, NOW)).toBeNull();
    expect(undoMeaningConversion(c.transfer, null, c.previous, NOW)).toBeNull();
  });

  it('openMeaningIds: only unresolved suggestions', () => {
    const base = { kind: 'atm' as const, targetAccountId: null, reason: 'missing' as const, bankCanonical: 'hdfc', counterpartyKey: '', createdAt: T, resolution: null };
    expect(openMeaningIds([
      { ...base, transactionId: 'a', resolvedAt: null },
      { ...base, transactionId: 'b', resolvedAt: T, resolution: 'expense' },
    ])).toEqual(new Set(['a']));
  });
});
