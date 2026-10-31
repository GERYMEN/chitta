import { Transaction } from '../../transactions/transaction.types';
import { calculateBalance } from '../../accounts/account.rules';
import { Account } from '../../accounts/account.types';
import {
  countsTowardIncomeExpense,
  incomeExpenseTotals,
  isLinkedRefund,
  spendContributionMinor,
} from '../../transactions/transaction.rules';
import {
  canBeRefunded,
  canLinkAsRefund,
  leftToRefundMinor,
  linkRefundPatch,
  rankRefundCandidates,
  REFUND_CANDIDATE_LIMIT,
  refundedMinor,
  refundsFor,
  unlinkRefundPatch,
  validateRefundLink,
} from '../refund.rules';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-10-20T10:00:00.000Z');
const at = (offsetMs: number) => new Date(BASE + offsetMs).toISOString();

function tx(id: string, patch: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 30000,
    currency: 'INR',
    merchantName: 'QA-Merchant-10',
    categoryId: 'cat-shopping',
    accountId: 'acc-bank',
    paymentMethod: 'other',
    occurredAt: at(0),
    detectedAt: at(0),
    approvedAt: at(0),
    note: null,
    sourceType: 'manual',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: null,
    parserVersion: null,
    bulkBatchId: null,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: at(0),
    updatedAt: at(0),
    ...patch,
  };
}

const EXPENSE = tx('e1');
const refund = (id: string, amountMinor: number, patch: Partial<Transaction> = {}) =>
  tx(id, {
    type: 'income',
    amountMinor,
    categoryId: 'cat-uncategorised',
    occurredAt: at(DAY),
    ...patch,
  });
const linked = (r: Transaction, expense: Transaction = EXPENSE) =>
  linkRefundPatch(r, expense, at(2 * DAY));

const ACCOUNT: Account = {
  id: 'acc-bank',
  name: 'QA Delete Bank 9999',
  type: 'bank',
  lastFour: '9999',
  openingBalanceMinor: 100000,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: at(0),
  updatedAt: at(0),
} as Account;

/** Rows whose own date falls in a calendar month (UTC) — the refund's date decides. */
const inMonth = (rows: Transaction[], month: string) =>
  rows.filter(t => t.occurredAt.startsWith(month));

describe('refund totals (incomeExpenseTotals)', () => {
  it('same month: a linked refund is not income and reduces spend; balance unchanged by the link', () => {
    const r = refund('r1', 10000);
    const before = incomeExpenseTotals([EXPENSE, r]);
    expect(before).toEqual({ incomeMinor: 10000, expenseMinor: 30000, netMinor: -20000 });

    const after = incomeExpenseTotals([EXPENSE, linked(r)]);
    expect(after.incomeMinor - before.incomeMinor).toBe(-10000);
    expect(after.expenseMinor - before.expenseMinor).toBe(-10000);
    expect(after).toEqual({ incomeMinor: 0, expenseMinor: 20000, netMinor: -20000 });

    expect(calculateBalance(ACCOUNT, [EXPENSE, linked(r)], ACCOUNT.id)).toBe(
      calculateBalance(ACCOUNT, [EXPENSE, r], ACCOUNT.id),
    );
  });

  it('cross-month: the refund reduces spend in ITS own month, the expense month is unchanged', () => {
    const expense = tx('e-oct', { occurredAt: '2026-10-28T10:00:00.000Z' });
    const r = linked(refund('r-nov', 10000, { occurredAt: '2026-11-03T10:00:00.000Z' }), expense);
    const rows = [expense, r];
    expect(incomeExpenseTotals(inMonth(rows, '2026-10'))).toEqual({
      incomeMinor: 0,
      expenseMinor: 30000,
      netMinor: -30000,
    });
    expect(incomeExpenseTotals(inMonth(rows, '2026-11'))).toEqual({
      incomeMinor: 0,
      expenseMinor: -10000,
      netMinor: 10000,
    });
  });

  it('partial + multiple refunds all net out', () => {
    const r1 = linked(refund('r1', 10000));
    const r2 = linked(refund('r2', 5000));
    expect(incomeExpenseTotals([EXPENSE, r1, r2])).toEqual({
      incomeMinor: 0,
      expenseMinor: 15000,
      netMinor: -15000,
    });
    expect(refundedMinor([EXPENSE, r1, r2], 'e1')).toBe(15000);
    expect(leftToRefundMinor(EXPENSE, [EXPENSE, r1, r2])).toBe(15000);
    expect(refundsFor([EXPENSE, r1, r2], 'e1').map(t => t.id).sort()).toEqual(['r1', 'r2']);
  });

  it('unlink restores the totals exactly', () => {
    const r = refund('r1', 10000);
    const before = incomeExpenseTotals([EXPENSE, r]);
    const l = linked(r);
    const back = unlinkRefundPatch(l, 'cat-uncategorised', 'cat-shopping', at(3 * DAY))!;
    expect(incomeExpenseTotals([EXPENSE, back])).toEqual(before);
    expect(back).toMatchObject({ linkKind: null, linkedTransactionId: null, categoryId: 'cat-uncategorised' });
  });

  it('unlink keeps a category the user changed after linking', () => {
    const l = { ...linked(refund('r1', 10000)), categoryId: 'cat-food' };
    expect(unlinkRefundPatch(l, 'cat-uncategorised', 'cat-shopping', at(0))!.categoryId).toBe('cat-food');
    expect(unlinkRefundPatch(refund('r9', 1), 'x', 'y', at(0))).toBeNull();
  });

  it('a rejected refund gives no money back; spend contribution rules', () => {
    const rejected = { ...linked(refund('r1', 10000)), status: 'rejected' as const };
    expect(refundedMinor([EXPENSE, rejected], 'e1')).toBe(0);
    expect(spendContributionMinor(EXPENSE)).toBe(30000);
    expect(spendContributionMinor(linked(refund('r2', 100)))).toBe(-100);
    expect(spendContributionMinor(refund('r3', 100))).toBe(0);
    expect(isLinkedRefund(linked(refund('r2', 100)))).toBe(true);
    expect(isLinkedRefund({ type: 'income', linkKind: 'refund', linkedTransactionId: null })).toBe(false);
  });

  it('hidden duplicates and transfer twins never count', () => {
    expect(countsTowardIncomeExpense({ type: 'expense', linkKind: 'duplicate' })).toBe(false);
    expect(countsTowardIncomeExpense({ type: 'income', linkKind: 'transfer_twin' })).toBe(false);
    expect(countsTowardIncomeExpense({ type: 'income', linkKind: 'refund' })).toBe(true);
  });
});

describe('validateRefundLink', () => {
  it('allows a partial refund and refuses an over-refund (sum may not exceed the expense)', () => {
    const r1 = linked(refund('r1', 20000));
    const ok = refund('r2', 10000);
    const tooMuch = refund('r3', 10001);
    const rows = [EXPENSE, r1, ok, tooMuch];
    expect(validateRefundLink(ok, EXPENSE, rows)).toBeNull();
    expect(validateRefundLink(tooMuch, EXPENSE, rows)).toBe('over-refund');
    expect(validateRefundLink(refund('r4', 30001), EXPENSE, [EXPENSE])).toBe('over-refund');
    expect(validateRefundLink(refund('r5', 30000), EXPENSE, [EXPENSE])).toBeNull();
  });

  it('refuses non-income, already-linked, transfer and non-refundable rows', () => {
    expect(validateRefundLink(EXPENSE, EXPENSE, [EXPENSE])).toBe('same-row');
    expect(validateRefundLink(tx('x'), EXPENSE, [])).toBe('not-a-refund-candidate');
    expect(validateRefundLink(linked(refund('r1', 1)), EXPENSE, [])).toBe('not-a-refund-candidate');
    expect(validateRefundLink(refund('r1', 1, { status: 'rejected' }), EXPENSE, [])).toBe(
      'not-a-refund-candidate',
    );
    expect(validateRefundLink(refund('r1', 1), tx('e2', { status: 'rejected' }), [])).toBe(
      'not-refundable',
    );
    expect(validateRefundLink(refund('r1', 1), tx('e3', { type: 'transfer', transferAccountId: 'w' }), [])).toBe(
      'not-refundable',
    );
    expect(validateRefundLink(refund('r1', 1), tx('e4', { linkKind: 'duplicate', linkedTransactionId: 'e1' }), [])).toBe(
      'not-refundable',
    );
  });

  it('eligibility helpers', () => {
    expect(canLinkAsRefund(refund('r', 1, { status: 'pending' }))).toBe(true);
    expect(canLinkAsRefund(EXPENSE)).toBe(false);
    expect(canBeRefunded(tx('p', { status: 'pending' }))).toBe(true);
    expect(canBeRefunded(tx('i', { type: 'income' }))).toBe(false);
  });
});

describe('rankRefundCandidates', () => {
  const r = refund('r', 10000, { merchantName: 'QA-Merchant-10 Ref 1234567', accountId: 'acc-bank' });

  it('ranks same merchant first, then same account, then closest date', () => {
    const sameMerchantOtherAccountOld = tx('a', { accountId: 'acc-card', occurredAt: at(-30 * DAY) });
    const sameMerchantSameAccountOld = tx('b', { occurredAt: at(-20 * DAY) });
    const sameMerchantSameAccountNew = tx('c', { occurredAt: at(-1 * DAY) });
    const otherMerchantSameAccountNew = tx('d', { merchantName: 'QA-Other', occurredAt: at(0) });
    const otherMerchantOtherAccount = tx('e', { merchantName: 'QA-Other', accountId: 'acc-card', occurredAt: at(0) });
    const ranked = rankRefundCandidates(r, [
      otherMerchantOtherAccount,
      sameMerchantOtherAccountOld,
      otherMerchantSameAccountNew,
      sameMerchantSameAccountOld,
      sameMerchantSameAccountNew,
      r,
    ]).map(c => c.expense.id);
    expect(ranked).toEqual(['c', 'b', 'a', 'd', 'e']);
  });

  it('limits: 90 days BEFORE only, enough left to refund, live unlinked expenses only, capped', () => {
    const rows = [
      tx('in-90d', { occurredAt: at(DAY - 90 * DAY) }), // refund is at +1 day → exactly 90 days
      tx('over-90d', { occurredAt: at(DAY - 90 * DAY - 1) }),
      tx('after-refund', { occurredAt: at(DAY + 1) }),
      tx('too-small', { amountMinor: 9999 }),
      tx('rejected', { status: 'rejected' }),
      tx('pending', { status: 'pending' }),
      tx('transfer', { type: 'transfer', transferAccountId: 'acc-wallet' }),
      tx('dup', { linkKind: 'duplicate', linkedTransactionId: 'pending' }),
      tx('income', { type: 'income' }),
      tx('mostly-refunded', { amountMinor: 15000 }),
      linked(refund('old-refund', 6000), tx('mostly-refunded', { amountMinor: 15000 })),
    ];
    const ids = rankRefundCandidates(r, rows).map(c => c.expense.id);
    expect(ids.sort()).toEqual(['in-90d', 'pending']);

    const left = rankRefundCandidates(r, [tx('half', { amountMinor: 30000 }), linked(refund('o', 5000), tx('half'))]);
    expect(left[0].leftMinor).toBe(25000);

    const many = Array.from({ length: REFUND_CANDIDATE_LIMIT + 5 }, (_, i) => tx(`m${i}`));
    expect(rankRefundCandidates(r, many)).toHaveLength(REFUND_CANDIDATE_LIMIT);
    expect(rankRefundCandidates(r, many, { limit: 3 })).toHaveLength(3);
  });

  it('a refund that is already linked to this expense does not count against itself', () => {
    const l = linked(r);
    const ranked = rankRefundCandidates(l, [EXPENSE, l]);
    expect(ranked.map(c => c.expense.id)).toEqual(['e1']);
    expect(ranked[0].leftMinor).toBe(30000);
  });
});

describe('linkRefundPatch', () => {
  it('sets the link and the original category; keeps account, date and status', () => {
    const r = refund('r1', 10000, { accountId: 'acc-wallet', status: 'pending' });
    expect(linkRefundPatch(r, EXPENSE, at(5))).toMatchObject({
      linkKind: 'refund',
      linkedTransactionId: 'e1',
      categoryId: 'cat-shopping',
      accountId: 'acc-wallet',
      occurredAt: r.occurredAt,
      status: 'pending',
      updatedAt: at(5),
    });
  });
});
