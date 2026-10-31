import { Transaction } from '../../transactions/transaction.types';
import { incomeExpenseTotals } from '../../transactions/transaction.rules';
import { calculateBalance } from '../../accounts/account.rules';
import { Account } from '../../accounts/account.types';
import {
  defaultKeepId,
  duplicatePairIds,
  duplicatePairKey,
  duplicatePickerOptions,
  findDuplicatePairs,
  hiddenDuplicatesOf,
  isDuplicateCandidate,
  markDuplicate,
  orderedPairIds,
  restoreDuplicate,
} from '../duplicate.rules';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const BASE = Date.parse('2026-10-20T10:00:00.000Z');
const at = (offsetMs: number) => new Date(BASE + offsetMs).toISOString();

function tx(id: string, patch: Partial<Transaction> = {}): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 5000,
    currency: 'INR',
    merchantName: 'QA-Merchant-11',
    categoryId: 'cat-food',
    accountId: 'acc-bank',
    paymentMethod: 'other',
    occurredAt: at(0),
    detectedAt: at(0),
    approvedAt: at(0),
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: `sms:${id}`,
    sanitizedPreview: null,
    confidenceScore: 90,
    parserVersion: 'sms-heuristic-v1',
    bulkBatchId: null,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: at(0),
    updatedAt: at(0),
    ...patch,
  };
}

const ids = (pairs: ReturnType<typeof findDuplicatePairs>) =>
  pairs.map(p => `${p.first.id}+${p.second.id}`);

describe('findDuplicatePairs', () => {
  it('pairs same account + type + amount within the window (inclusive boundary)', () => {
    expect(ids(findDuplicatePairs([tx('a'), tx('b', { occurredAt: at(10 * MIN) })], []))).toEqual(['a+b']);
    expect(findDuplicatePairs([tx('a'), tx('b', { occurredAt: at(10 * MIN + 1) })], [])).toEqual([]);
    expect(ids(findDuplicatePairs([tx('a'), tx('b', { occurredAt: at(-10 * MIN) })], []))).toEqual(['b+a']);
    expect(ids(findDuplicatePairs([tx('a'), tx('b', { occurredAt: at(30 * MIN) })], [], 30))).toEqual(['a+b']);
  });

  it('1 paisa off, different account, different type → no pair', () => {
    expect(findDuplicatePairs([tx('a'), tx('b', { amountMinor: 5001 })], [])).toEqual([]);
    expect(findDuplicatePairs([tx('a'), tx('b', { accountId: 'acc-wallet' })], [])).toEqual([]);
    expect(findDuplicatePairs([tx('a'), tx('b', { type: 'income' })], [])).toEqual([]);
  });

  it('three rows: each row in at most one pair — the closest two pair, the third is left', () => {
    const rows = [tx('a'), tx('b', { occurredAt: at(5 * MIN) }), tx('c', { occurredAt: at(6 * MIN) })];
    expect(ids(findDuplicatePairs(rows, []))).toEqual(['b+c']);
    // Exact tie → the pair whose first row is earlier, then ids.
    const tie = [tx('a'), tx('b', { occurredAt: at(2 * MIN) }), tx('c', { occurredAt: at(4 * MIN) })];
    expect(ids(findDuplicatePairs(tie, []))).toEqual(['a+b']);
    // Four rows → two pairs, newest first.
    const four = [...tie, tx('d', { occurredAt: at(6 * MIN) })];
    expect(ids(findDuplicatePairs(four, []))).toEqual(['c+d', 'a+b']);
  });

  it('a dismissed pair is never suggested (either id order); its rows may pair with others', () => {
    const rows = [tx('a'), tx('b', { occurredAt: at(MIN) })];
    expect(findDuplicatePairs(rows, [{ aId: 'a', bId: 'b' }])).toEqual([]);
    expect(findDuplicatePairs(rows, [{ aId: 'b', bId: 'a' }])).toEqual([]);
    const three = [...rows, tx('c', { occurredAt: at(3 * MIN) })];
    expect(ids(findDuplicatePairs(three, [{ aId: 'a', bId: 'b' }]))).toEqual(['b+c']);
  });

  it('only pending/approved, unlinked, non-transfer income/expense rows', () => {
    const other = tx('b', { occurredAt: at(MIN) });
    for (const patch of [
      { status: 'rejected' as const },
      { status: 'invalid' as const },
      { type: 'transfer' as const, transferAccountId: 'acc-wallet' },
      { linkKind: 'transfer_twin' as const, linkedTransactionId: 'x' },
      { linkKind: 'refund' as const, linkedTransactionId: 'x', type: 'income' as const },
      { linkKind: 'duplicate' as const, linkedTransactionId: 'x' },
    ]) {
      expect(findDuplicatePairs([tx('a', patch), other], [])).toEqual([]);
    }
    expect(ids(findDuplicatePairs([tx('a', { status: 'pending' }), other], []))).toEqual(['a+b']);
    expect(ids(findDuplicatePairs([tx('a', { type: 'income' }), tx('b', { type: 'income', occurredAt: at(MIN) })], []))).toEqual(['a+b']);
    expect(isDuplicateCandidate(tx('a'))).toBe(true);
  });

  it('pair ids + keys', () => {
    const pairs = findDuplicatePairs([tx('a'), tx('b', { occurredAt: at(MIN) })], []);
    expect(Array.from(duplicatePairIds(pairs)).sort()).toEqual(['a', 'b']);
    expect(orderedPairIds('z', 'a')).toEqual(['a', 'z']);
    expect(duplicatePairKey('z', 'a')).toBe(duplicatePairKey('a', 'z'));
  });
});

describe('defaultKeepId', () => {
  it('keeps the approved one, else the earlier one', () => {
    const early = tx('a', { status: 'pending' });
    const late = tx('b', { status: 'approved', occurredAt: at(MIN) });
    expect(defaultKeepId({ first: early, second: late })).toBe('b');
    expect(defaultKeepId({ first: tx('a'), second: tx('b', { occurredAt: at(MIN) }) })).toBe('a');
    expect(defaultKeepId({ first: tx('a', { status: 'pending' }), second: tx('b', { status: 'pending' }) })).toBe('a');
  });
});

describe('markDuplicate / restoreDuplicate', () => {
  const ACCOUNT = {
    id: 'acc-bank',
    openingBalanceMinor: 100000,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    type: 'bank',
  } as unknown as Account;

  it('hides the duplicate (rejected + link) and restores it EXACTLY; totals + balance follow', () => {
    const kept = tx('a');
    const dup = tx('b', { occurredAt: at(MIN), approvedAt: '2026-10-20T10:05:00.000Z' });
    const before = incomeExpenseTotals([kept, dup]);
    const balanceBefore = calculateBalance(ACCOUNT, [kept, dup], 'acc-bank');

    const marking = markDuplicate(kept, dup, at(DAY))!;
    expect(marking.duplicate).toMatchObject({
      status: 'rejected',
      linkKind: 'duplicate',
      linkedTransactionId: 'a',
      sourceReferenceHash: 'sms:b',
      updatedAt: at(DAY),
    });
    const approvedOnly = (rows: Transaction[]) => rows.filter(t => t.status === 'approved');
    const hidden = [kept, marking.duplicate];
    expect(incomeExpenseTotals(approvedOnly(hidden)).expenseMinor - before.expenseMinor).toBe(-5000);
    expect(incomeExpenseTotals(hidden).expenseMinor - before.expenseMinor).toBe(-5000);
    expect(calculateBalance(ACCOUNT, hidden, 'acc-bank') - balanceBefore).toBe(5000);
    expect(hiddenDuplicatesOf(hidden, 'a').map(t => t.id)).toEqual(['b']);

    const restored = restoreDuplicate(marking.duplicate, marking.previous, at(2 * DAY))!;
    expect({ ...restored, updatedAt: dup.updatedAt }).toEqual(dup);
    expect(incomeExpenseTotals([kept, restored])).toEqual(before);
    expect(calculateBalance(ACCOUNT, [kept, restored], 'acc-bank')).toBe(balanceBefore);
  });

  it('a pending duplicate restores to pending with no approvedAt', () => {
    const dup = tx('b', { status: 'pending', approvedAt: null });
    const marking = markDuplicate(tx('a'), dup, at(DAY))!;
    expect(marking.previous).toMatchObject({ status: 'pending', approvedAt: null, linkKind: null });
    expect(restoreDuplicate(marking.duplicate, marking.previous, at(DAY))).toMatchObject({
      status: 'pending',
      approvedAt: null,
      linkKind: null,
      linkedTransactionId: null,
    });
  });

  it('refuses invalid pairs', () => {
    expect(markDuplicate(tx('a'), tx('a'), at(0))).toBeNull();
    expect(markDuplicate(tx('a'), tx('b', { amountMinor: 5001 }), at(0))).toBeNull();
    expect(markDuplicate(tx('a'), tx('b', { accountId: 'x' }), at(0))).toBeNull();
    expect(markDuplicate(tx('a'), tx('b', { type: 'income' }), at(0))).toBeNull();
    expect(markDuplicate(tx('a', { status: 'rejected' }), tx('b'), at(0))).toBeNull();
    expect(restoreDuplicate(tx('b'), markDuplicate(tx('a'), tx('b'), at(0))!.previous, at(0))).toBeNull();
  });
});

describe('duplicatePickerOptions (manual "Mark as duplicate of…")', () => {
  it('same account + type + amount within 3 days, closest first; never itself or hidden rows', () => {
    const self = tx('self');
    const rows = [
      self,
      tx('far', { occurredAt: at(3 * DAY) }),
      tx('too-far', { occurredAt: at(-3 * DAY - 1) }),
      tx('near', { occurredAt: at(-MIN) }),
      tx('other-amount', { amountMinor: 5001 }),
      tx('other-account', { accountId: 'x' }),
      tx('other-type', { type: 'income' }),
      tx('hidden', { status: 'rejected', linkKind: 'duplicate', linkedTransactionId: 'self' }),
    ];
    expect(duplicatePickerOptions(self, rows).map(t => t.id)).toEqual(['near', 'far']);
    expect(duplicatePickerOptions(tx('t', { type: 'transfer', transferAccountId: 'w' }), rows)).toEqual([]);
  });
});
