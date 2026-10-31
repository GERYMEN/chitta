import { Transaction } from '../../transactions/transaction.types';
import {
  incomeExpenseTotals,
  isLinkedRefund,
} from '../../transactions/transaction.rules';
import { isWithinRange, periodRange } from '../../periods/period.rules';
import { PeriodRange } from '../../periods/period.types';
import { normalizeMerchant } from '../../merchants/normalizeMerchant';
import {
  approvedInRange,
  earliestApprovedAt,
  merchantHistory,
  monthKeyOf,
  monthlyTrend,
  OTHER_BREAKDOWN_KEY,
  pendingInRangeCount,
  periodTotals,
  spendByCategory,
  startsBeforeRecords,
  topCategories,
  trendRange,
} from '../insights.rules';
import { CategorySpend } from '../insights.types';

// Local wall-clock dates → ISO strings, so every test holds in any timezone.
const local = (y: number, m: number, d: number, h = 0, min = 0, sec = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, sec, ms);
const at = (y: number, m: number, d: number, h = 12) => local(y, m, d, h).toISOString();

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 10000,
    currency: 'INR',
    merchantName: `QA-Merchant-${id}`,
    categoryId: 'cat-food',
    accountId: 'acc-qa',
    paymentMethod: 'upi',
    occurredAt: at(2026, 10, 10),
    detectedAt: at(2026, 10, 10),
    approvedAt: at(2026, 10, 10),
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
    createdAt: at(2026, 10, 10),
    updatedAt: at(2026, 10, 10),
    ...patch,
  };
}

const NOW = local(2026, 10, 20, 15, 0, 0, 0); // 20 Oct 2026 15:00 local
const ONE_MONTH = periodRange('1M', NOW); // 1 Oct 00:00 → now
const THREE_MONTHS = periodRange('3M', NOW); // 1 Aug 00:00 → now

/**
 * Synthetic fixture covering every R3a/R3b rule: transfers, transfer twins,
 * hidden duplicates, pending rows, a same-month refund and a cross-month
 * refund (refund in October for a September expense), plus the period edges.
 */
const FIXTURE: Transaction[] = [
  tx('e1', { amountMinor: 50000, categoryId: 'cat-food', occurredAt: at(2026, 10, 5) }),
  tx('e2', { amountMinor: 20000, categoryId: 'cat-food', occurredAt: at(2026, 10, 12) }),
  tx('e3', { amountMinor: 30000, categoryId: 'cat-shopping', occurredAt: at(2026, 10, 8) }),
  tx('e4', { amountMinor: 10000, categoryId: 'cat-uncategorised', occurredAt: at(2026, 10, 15) }),
  // Income exactly at the 1M start (inclusive).
  tx('i1', {
    type: 'income',
    amountMinor: 500000,
    categoryId: 'cat-salary',
    occurredAt: local(2026, 10, 1).toISOString(),
  }),
  // Pending — never counts.
  tx('p1', { status: 'pending', amountMinor: 99900, categoryId: 'cat-food', occurredAt: at(2026, 10, 10) }),
  // Transfer + its kept twin — never count.
  tx('t1', {
    type: 'transfer',
    amountMinor: 70000,
    categoryId: 'cat-transfer',
    transferAccountId: 'acc-qa-2',
    occurredAt: at(2026, 10, 9),
  }),
  tx('tw1', {
    type: 'income',
    status: 'rejected',
    amountMinor: 70000,
    categoryId: 'cat-uncategorised',
    linkKind: 'transfer_twin',
    linkedTransactionId: 't1',
    occurredAt: at(2026, 10, 9),
  }),
  // Hidden duplicate of e3 — never counts.
  tx('d1', {
    status: 'rejected',
    amountMinor: 30000,
    categoryId: 'cat-shopping',
    linkKind: 'duplicate',
    linkedTransactionId: 'e3',
    occurredAt: at(2026, 10, 8),
  }),
  // Same-month refund of e3: shopping 30000 − 5000.
  tx('r1', {
    type: 'income',
    amountMinor: 5000,
    categoryId: 'cat-shopping',
    linkKind: 'refund',
    linkedTransactionId: 'e3',
    occurredAt: at(2026, 10, 14),
  }),
  // September expense + its October refund (cross-month).
  tx('e5', { amountMinor: 40000, categoryId: 'cat-transport', occurredAt: at(2026, 9, 20) }),
  tx('r2', {
    type: 'income',
    amountMinor: 30000,
    categoryId: 'cat-transport',
    linkKind: 'refund',
    linkedTransactionId: 'e5',
    occurredAt: at(2026, 10, 3),
  }),
  // `to` = now is inclusive; 1 ms later is not.
  tx('e6', { amountMinor: 15000, categoryId: 'cat-food', occurredAt: NOW.toISOString() }),
  tx('e7', { amountMinor: 12345, categoryId: 'cat-food', occurredAt: new Date(NOW.getTime() + 1).toISOString() }),
  // 1 ms before the 1M start.
  tx('e8', { amountMinor: 777, categoryId: 'cat-food', occurredAt: local(2026, 9, 30, 23, 59, 59, 999).toISOString() }),
];

/** Simple, independent reference: per category, the shared totals helper over approved rows in range. */
function referenceSpend(rows: ReadonlyArray<Transaction>, range: PeriodRange): Map<string, number> {
  const inRange = rows.filter(t => t.status === 'approved' && isWithinRange(t.occurredAt, range));
  const spendRows = inRange.filter(
    t => (t.type === 'expense' || isLinkedRefund(t)) && t.linkKind !== 'duplicate' && t.linkKind !== 'transfer_twin',
  );
  const result = new Map<string, number>();
  for (const categoryId of new Set(spendRows.map(t => t.categoryId))) {
    result.set(categoryId, incomeExpenseTotals(inRange.filter(t => t.categoryId === categoryId)).expenseMinor);
  }
  return result;
}

const asMap = (rows: CategorySpend[]) => new Map(rows.map(r => [r.categoryId, r.spendMinor]));

describe('spendByCategory', () => {
  it('matches a simple reference built on incomeExpenseTotals (1M and 3M)', () => {
    for (const range of [ONE_MONTH, THREE_MONTHS]) {
      expect(asMap(spendByCategory(FIXTURE, range))).toEqual(referenceSpend(FIXTURE, range));
    }
  });

  it('1M: excludes pending, transfers, twins and hidden duplicates; nets the same-month refund', () => {
    const rows = spendByCategory(FIXTURE, ONE_MONTH);
    expect(rows.map(r => [r.categoryId, r.spendMinor, r.count])).toEqual([
      ['cat-food', 85000, 3], // e1 + e2 + e6 (now inclusive; e7/e8/p1 out)
      ['cat-shopping', 25000, 2], // e3 − r1 (d1 hidden)
      ['cat-uncategorised', 10000, 1], // Uncategorised is a category like any other
      ['cat-transport', -30000, 1], // only the cross-month refund r2 is in October
    ]);
    expect(rows.some(r => r.categoryId === 'cat-salary' || r.categoryId === 'cat-transfer')).toBe(false);
  });

  it('the category spends add up to the period spend (EXPENSES tile)', () => {
    for (const range of [ONE_MONTH, THREE_MONTHS]) {
      const sum = spendByCategory(FIXTURE, range).reduce((s, r) => s + r.spendMinor, 0);
      expect(sum).toBe(periodTotals(FIXTURE, range).expenseMinor);
    }
    expect(periodTotals(FIXTURE, ONE_MONTH)).toEqual({
      incomeMinor: 500000, // refunds are not income
      expenseMinor: 90000,
      netMinor: 410000,
    });
  });

  it('shares divide by total positive spend; a negative category keeps its number with share 0', () => {
    const rows = spendByCategory(FIXTURE, ONE_MONTH);
    const share = (id: string) => rows.find(r => r.categoryId === id)!.share;
    expect(share('cat-food')).toBeCloseTo(85000 / 120000, 10);
    expect(share('cat-shopping')).toBeCloseTo(25000 / 120000, 10);
    expect(share('cat-uncategorised')).toBeCloseTo(10000 / 120000, 10);
    expect(share('cat-transport')).toBe(0);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
  });

  it('3M: the cross-month refund nets against its September expense', () => {
    const transport = spendByCategory(FIXTURE, THREE_MONTHS).find(r => r.categoryId === 'cat-transport')!;
    expect(transport.spendMinor).toBe(10000); // 40000 − 30000
    expect(transport.count).toBe(2);
  });

  it('sorted by spend, highest first (ties by category id); empty period → []', () => {
    const tie = [
      tx('a', { categoryId: 'cat-b', amountMinor: 100 }),
      tx('b', { categoryId: 'cat-a', amountMinor: 100 }),
      tx('c', { categoryId: 'cat-c', amountMinor: 300 }),
    ];
    expect(spendByCategory(tie, ONE_MONTH).map(r => r.categoryId)).toEqual(['cat-c', 'cat-a', 'cat-b']);
    expect(spendByCategory(FIXTURE, periodRange('1M', local(2020, 1, 15)))).toEqual([]);
  });

  it('refunds only (nothing positive) → every share is 0', () => {
    const rows = spendByCategory([FIXTURE.find(t => t.id === 'r2')!], ONE_MONTH);
    expect(rows).toEqual([{ categoryId: 'cat-transport', spendMinor: -30000, count: 1, share: 0 }]);
  });
});

describe('topCategories (Home card: top 5 + Other)', () => {
  const rowsOf = (spends: number[]): CategorySpend[] => {
    const totalPositive = spends.reduce((s, v) => s + Math.max(0, v), 0);
    return spends.map((spendMinor, i) => ({
      categoryId: `cat-${i + 1}`,
      spendMinor,
      count: i + 1,
      share: spendMinor > 0 ? spendMinor / totalPositive : 0,
    }));
  };

  it('≤ 6 categories are all shown (an "Other" of one would hide a name)', () => {
    expect(topCategories(rowsOf([5, 4, 3])).map(r => r.key)).toEqual(['cat-1', 'cat-2', 'cat-3']);
    const six = topCategories(rowsOf([6, 5, 4, 3, 2, 1]));
    expect(six).toHaveLength(6);
    expect(six.every(r => r.categoryId !== null && r.categoryCount === 1)).toBe(true);
  });

  it('7+ categories: top 5 + one "Other" that sums the rest (spend, count, share)', () => {
    const rows = rowsOf([700, 600, 500, 400, 300, 200, 100]);
    const top = topCategories(rows);
    expect(top).toHaveLength(6);
    const other = top[5];
    expect(other).toEqual({
      key: OTHER_BREAKDOWN_KEY,
      categoryId: null,
      spendMinor: 300,
      count: 6 + 7,
      share: 300 / 2800,
      categoryCount: 2,
    });
    // Bars always add up to the period spend.
    expect(top.reduce((s, r) => s + r.spendMinor, 0)).toBe(2800);
  });

  it('"Other" follows the category rule: negative total → share 0', () => {
    const top = topCategories(rowsOf([700, 600, 500, 400, 300, 100, -900]));
    expect(top[5].spendMinor).toBe(-800);
    expect(top[5].share).toBe(0);
  });
});

describe('monthlyTrend', () => {
  it('3M: one bucket per calendar month incl. empty ones; only the running month is partial', () => {
    const buckets = monthlyTrend(FIXTURE, THREE_MONTHS);
    expect(buckets).toEqual([
      { monthKey: '2026-08', incomeMinor: 0, spendMinor: 0, partial: false },
      { monthKey: '2026-09', incomeMinor: 0, spendMinor: 40777, partial: false }, // e5 + e8
      { monthKey: '2026-10', incomeMinor: 500000, spendMinor: 90000, partial: true },
    ]);
  });

  it('1M charts the current month plus the 2 before it (context months)', () => {
    const window = trendRange('1M', NOW);
    expect(window.from.getTime()).toBe(local(2026, 8, 1).getTime());
    const buckets = monthlyTrend(FIXTURE, window);
    expect(buckets.map(b => b.monthKey)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(buckets.map(b => b.partial)).toEqual([false, false, true]);
    // Other periods chart their own range.
    expect(trendRange('6M', NOW)).toEqual(periodRange('6M', NOW));
  });

  it('the cross-month refund lowers October (refund date), not September', () => {
    const [, september, october] = monthlyTrend(FIXTURE, THREE_MONTHS);
    expect(september.spendMinor).toBe(40000 + 777);
    // October: 125000 expenses − 5000 (r1) − 30000 (r2).
    expect(october.spendMinor).toBe(90000);
    expect(october.incomeMinor).toBe(500000);
  });

  it('bucket totals add up to the period totals', () => {
    const buckets = monthlyTrend(FIXTURE, THREE_MONTHS);
    const totals = periodTotals(FIXTURE, THREE_MONTHS);
    expect(buckets.reduce((s, b) => s + b.spendMinor, 0)).toBe(totals.expenseMinor);
    expect(buckets.reduce((s, b) => s + b.incomeMinor, 0)).toBe(totals.incomeMinor);
  });

  it('1Y mid-month: 13 buckets, partial first and last; rows before `from` are left out', () => {
    const now = local(2026, 3, 15, 10);
    const rows = [
      tx('y0', { amountMinor: 111, occurredAt: local(2025, 3, 14, 23, 59, 59, 999).toISOString() }),
      tx('y1', { amountMinor: 222, occurredAt: local(2025, 3, 15).toISOString() }),
      tx('y2', { amountMinor: 333, occurredAt: at(2025, 9, 1) }),
      tx('y3', { amountMinor: 444, occurredAt: at(2026, 3, 15, 9) }),
    ];
    const buckets = monthlyTrend(rows, periodRange('1Y', now));
    expect(buckets).toHaveLength(13);
    expect(buckets[0]).toEqual({ monthKey: '2025-03', incomeMinor: 0, spendMinor: 222, partial: true });
    expect(buckets[12]).toEqual({ monthKey: '2026-03', incomeMinor: 0, spendMinor: 444, partial: true });
    expect(buckets.slice(1, 12).every(b => !b.partial)).toBe(true);
    expect(buckets.find(b => b.monthKey === '2025-09')!.spendMinor).toBe(333);
  });

  it('1Y from the 1st: the first month is whole, the running month partial (still 13)', () => {
    const buckets = monthlyTrend([], periodRange('1Y', local(2026, 3, 1, 9)));
    expect(buckets).toHaveLength(13);
    expect(buckets[0]).toMatchObject({ monthKey: '2025-03', partial: false });
    expect(buckets[12]).toMatchObject({ monthKey: '2026-03', partial: true });
  });

  it('1Y on a leap day: Feb 2027 (from the 28th) to Feb 2028', () => {
    const buckets = monthlyTrend([], periodRange('1Y', local(2028, 2, 29, 12)));
    expect(buckets.map(b => b.monthKey)[0]).toBe('2027-02');
    expect(buckets[buckets.length - 1].monthKey).toBe('2028-02');
    expect(buckets).toHaveLength(13);
    expect(buckets[0].partial).toBe(true);
  });

  it('a range that ends on the last millisecond of a month leaves it whole', () => {
    const range = { from: local(2026, 9, 1), to: local(2026, 9, 30, 23, 59, 59, 999) };
    expect(monthlyTrend([], range)).toEqual([
      { monthKey: '2026-09', incomeMinor: 0, spendMinor: 0, partial: false },
    ]);
    expect(monthKeyOf(local(2026, 1, 5))).toBe('2026-01');
  });
});

describe('merchantHistory', () => {
  const KEY = normalizeMerchant('QA-Merchant-12');
  const rows: Transaction[] = [
    tx('m1', { merchantName: 'QA-Merchant-12', amountMinor: 20000, occurredAt: at(2026, 10, 2) }),
    tx('m2', { merchantName: 'qa  merchant 12', amountMinor: 5000, occurredAt: at(2026, 10, 6) }),
    tx('m3', { merchantName: 'QA-Merchant-12@okqa', status: 'pending', amountMinor: 999, occurredAt: at(2026, 10, 6) }),
    tx('m4', {
      merchantName: 'QA-Merchant-12',
      type: 'transfer',
      transferAccountId: 'acc-qa-2',
      categoryId: 'cat-transfer',
      amountMinor: 888,
      occurredAt: at(2026, 10, 7),
    }),
    tx('m5', {
      merchantName: 'QA-Merchant-12',
      status: 'rejected',
      linkKind: 'duplicate',
      linkedTransactionId: 'm1',
      amountMinor: 20000,
      occurredAt: at(2026, 10, 2),
    }),
    tx('m6', {
      merchantName: 'QA-Merchant-12',
      type: 'income',
      linkKind: 'refund',
      linkedTransactionId: 'm1',
      amountMinor: 3000,
      occurredAt: at(2026, 10, 9),
    }),
    tx('m7', { merchantName: 'QA-Merchant-12', type: 'income', amountMinor: 700, occurredAt: at(2026, 10, 11) }),
    tx('m8', { merchantName: 'QA-Merchant-12', amountMinor: 4000, occurredAt: at(2026, 9, 25) }),
    tx('m9', { merchantName: 'QA-Merchant-13', amountMinor: 6000, occurredAt: at(2026, 10, 3) }),
  ];

  it('approved counting rows of the key in the period (pending, transfers, hidden duplicates out)', () => {
    expect(merchantHistory(rows, KEY, ONE_MONTH)).toEqual({
      count: 4, // m1, m2, m6 (refund), m7 (income)
      spendMinor: 22000, // 20000 + 5000 − 3000
      incomeMinor: 700,
    });
  });

  it('the period decides: 3M also has the September visit', () => {
    expect(merchantHistory(rows, KEY, THREE_MONTHS)).toEqual({ count: 5, spendMinor: 26000, incomeMinor: 700 });
  });

  it('other keys and an empty key', () => {
    expect(merchantHistory(rows, normalizeMerchant('QA-Merchant-13'), ONE_MONTH)).toEqual({
      count: 1,
      spendMinor: 6000,
      incomeMinor: 0,
    });
    expect(merchantHistory(rows, '', ONE_MONTH)).toEqual({ count: 0, spendMinor: 0, incomeMinor: 0 });
  });
});

describe('partial-data notice and pending hint inputs', () => {
  it('earliestApprovedAt = the earliest approved row of any type (pending/rejected ignored)', () => {
    expect(earliestApprovedAt(FIXTURE)).toBe(at(2026, 9, 20)); // e5
    expect(
      earliestApprovedAt([
        tx('x1', { status: 'pending', occurredAt: at(2020, 1, 1) }),
        tx('x2', { status: 'rejected', occurredAt: at(2020, 1, 2) }),
        tx('x3', { type: 'transfer', occurredAt: at(2026, 10, 2) }),
      ]),
    ).toBe(at(2026, 10, 2));
    expect(earliestApprovedAt([])).toBeNull();
  });

  it('startsBeforeRecords compares local days', () => {
    const range = ONE_MONTH; // from 1 Oct 00:00
    expect(startsBeforeRecords(range, local(2026, 10, 5, 9).toISOString())).toBe(true);
    // Records that start later on the period's first day still cover that day.
    expect(startsBeforeRecords(range, local(2026, 10, 1, 9).toISOString())).toBe(false);
    expect(startsBeforeRecords(range, local(2026, 9, 2).toISOString())).toBe(false);
    expect(startsBeforeRecords(range, null)).toBe(false);
  });

  it('pendingInRangeCount counts pending income/expense dated in the period only', () => {
    const rows = [
      tx('q1', { status: 'pending', occurredAt: at(2026, 10, 2) }),
      tx('q2', { status: 'pending', type: 'income', occurredAt: at(2026, 10, 3) }),
      tx('q3', { status: 'pending', occurredAt: at(2026, 9, 29) }),
      tx('q4', { status: 'approved', occurredAt: at(2026, 10, 2) }),
      tx('q5', { status: 'pending', type: 'transfer', transferAccountId: 'acc-qa-2', occurredAt: at(2026, 10, 2) }),
    ];
    expect(pendingInRangeCount(rows, ONE_MONTH)).toBe(2);
    expect(pendingInRangeCount(rows, THREE_MONTHS)).toBe(3);
  });

  it('periodTotals (one pass) equals incomeExpenseTotals over approvedInRange', () => {
    for (const range of [ONE_MONTH, THREE_MONTHS, periodRange('1Y', NOW)]) {
      expect(periodTotals(FIXTURE, range)).toEqual(incomeExpenseTotals(approvedInRange(FIXTURE, range)));
    }
  });

  it('approvedInRange keeps approved rows of any type in the range', () => {
    expect(approvedInRange(FIXTURE, ONE_MONTH).map(t => t.id).sort()).toEqual(
      ['e1', 'e2', 'e3', 'e4', 'e6', 'i1', 'r1', 'r2', 't1'].sort(),
    );
  });
});
