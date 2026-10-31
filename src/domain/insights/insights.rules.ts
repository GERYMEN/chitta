import { Transaction } from '../transactions/transaction.types';
import {
  countsTowardIncomeExpense,
  incomeContributionMinor,
  IncomeExpenseTotals,
  isLinkedRefund,
  spendContributionMinor,
} from '../transactions/transaction.rules';
import { normalizeMerchant } from '../merchants/normalizeMerchant';
import { Period, PeriodRange } from '../periods/period.types';
import { isWithinRange, periodRange } from '../periods/period.rules';
import {
  CategoryBreakdownRow,
  CategorySpend,
  MerchantHistory,
  MonthBucket,
} from './insights.types';

/**
 * R4 insights — "where did my money go" for a period. Pure functions over
 * the in-memory rows (no SQL, no React, no clock): the R3a/R3b money rules
 * live in TS, so every number here goes through the same per-row helpers
 * `incomeExpenseTotals` sums (`countsTowardIncomeExpense`,
 * `incomeContributionMinor`, `spendContributionMinor`) — one source of
 * truth. Each aggregate is a single O(n) pass over the rows (plus a sort
 * over the handful of categories).
 *
 * Rules every aggregate shares:
 *  - only APPROVED rows count (pending/rejected/invalid never do);
 *  - transfers, transfer twins and hidden duplicates never count;
 *  - a linked refund is not income: it reduces the spend of its (original's)
 *    category, in the period of the REFUND's own date;
 *  - a row is in a period when `from <= occurredAt <= to` (isWithinRange).
 */

type Row = Pick<Transaction, 'type' | 'status' | 'amountMinor' | 'occurredAt'> &
  Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId'>>;

/** Home card: top N categories, the rest folded into "Other". */
export const TOP_CATEGORY_LIMIT = 5;

/** Key of the folded "Other" row (never a real category id). */
export const OTHER_BREAKDOWN_KEY = 'insights-other';

interface Bounds {
  fromMs: number;
  toMs: number;
}

function boundsOf(range: PeriodRange): Bounds {
  return { fromMs: range.from.getTime(), toMs: range.to.getTime() };
}

function inBounds(occurredAt: string, bounds: Bounds): boolean {
  const at = Date.parse(occurredAt);
  return at >= bounds.fromMs && at <= bounds.toMs;
}

/** A row that moves spend: an expense or a linked refund (and counts at all). */
function isSpendRow(t: Row): boolean {
  return countsTowardIncomeExpense(t) && (t.type === 'expense' || isLinkedRefund(t));
}

/** Approved rows (any type) dated inside the range. */
export function approvedInRange<T extends Pick<Transaction, 'status' | 'occurredAt'>>(
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): T[] {
  return transactions.filter(t => t.status === 'approved' && isWithinRange(t.occurredAt, range));
}

/**
 * INCOME / EXPENSES (spend) / NET of a period — approved rows in the range,
 * summed with the per-row helpers of incomeExpenseTotals in one pass (equal
 * to `incomeExpenseTotals(approvedInRange(rows, range))`). Home tiles, the
 * Insights totals and (via the filter predicate) Transactions
 * Inflow/Spent/Net agree.
 */
export function periodTotals<T extends Row>(
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): IncomeExpenseTotals {
  const bounds = boundsOf(range);
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const t of transactions) {
    if (t.status !== 'approved' || !inBounds(t.occurredAt, bounds)) continue;
    incomeMinor += incomeContributionMinor(t);
    expenseMinor += spendContributionMinor(t);
  }
  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor };
}

/**
 * Spend per category in the range, sorted by spend (highest first, ties by
 * category id). Includes Uncategorised like any other category. Only
 * categories with at least one spend row (expense or linked refund) appear.
 */
export function spendByCategory<T extends Row & Pick<Transaction, 'categoryId'>>(
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): CategorySpend[] {
  const bounds = boundsOf(range);
  const byCategory = new Map<string, { spendMinor: number; count: number }>();
  for (const t of transactions) {
    if (t.status !== 'approved' || !isSpendRow(t) || !inBounds(t.occurredAt, bounds)) continue;
    const entry = byCategory.get(t.categoryId) ?? { spendMinor: 0, count: 0 };
    entry.spendMinor += spendContributionMinor(t);
    entry.count += 1;
    byCategory.set(t.categoryId, entry);
  }

  let totalPositiveMinor = 0;
  for (const entry of byCategory.values()) {
    if (entry.spendMinor > 0) totalPositiveMinor += entry.spendMinor;
  }

  return Array.from(byCategory, ([categoryId, entry]) => ({
    categoryId,
    spendMinor: entry.spendMinor,
    count: entry.count,
    share: shareOf(entry.spendMinor, totalPositiveMinor),
  })).sort(
    (a, b) =>
      b.spendMinor - a.spendMinor || (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0),
  );
}

function shareOf(spendMinor: number, totalPositiveMinor: number): number {
  return spendMinor > 0 && totalPositiveMinor > 0 ? spendMinor / totalPositiveMinor : 0;
}

/**
 * Home "Where it went": the first `limit` categories of a spendByCategory
 * result, the rest folded into one "Other" row. When only ONE category would
 * be folded it is shown as itself instead (an "Other" of one hides a name for
 * no gain), so at most limit + 1 rows come back either way. "Other" uses the
 * same rules as a category: spend = sum of the folded spends, count = sum,
 * share = its spend / total positive spend (0 when ≤ 0). The rows' spends
 * always add up to the period's spend (the EXPENSES tile).
 */
export function topCategories(
  rows: ReadonlyArray<CategorySpend>,
  limit: number = TOP_CATEGORY_LIMIT,
): CategoryBreakdownRow[] {
  const asRow = (r: CategorySpend): CategoryBreakdownRow => ({
    key: r.categoryId,
    categoryId: r.categoryId,
    spendMinor: r.spendMinor,
    count: r.count,
    share: r.share,
    categoryCount: 1,
  });
  if (rows.length <= limit + 1) return rows.map(asRow);

  const shown = rows.slice(0, limit).map(asRow);
  const folded = rows.slice(limit);
  const totalPositiveMinor = rows.reduce((sum, r) => sum + Math.max(0, r.spendMinor), 0);
  const otherSpendMinor = folded.reduce((sum, r) => sum + r.spendMinor, 0);
  shown.push({
    key: OTHER_BREAKDOWN_KEY,
    categoryId: null,
    spendMinor: otherSpendMinor,
    count: folded.reduce((sum, r) => sum + r.count, 0),
    share: shareOf(otherSpendMinor, totalPositiveMinor),
    categoryCount: folded.length,
  });
  return shown;
}

/**
 * The window the Trends chart shows for a period. 1M is a single month, so
 * it shows the current month plus the previous 2 months for context (the
 * same window as 3M); every other period charts its own range.
 */
export function trendRange(period: Period, now: Date): PeriodRange {
  return periodRange(period === '1M' ? '3M' : period, now);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM' of a date, local time. */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * Calendar-month buckets (local time) that intersect the range, oldest
 * first, including empty months. A bucket only sums rows that are inside
 * the range, and is `partial` when the range does not cover the whole month
 * (the current month while it is in progress; the first month of 1Y, which
 * starts mid-month — so 1Y can give 13 buckets with a partial first and
 * last). Income = income that counts; spend = expenses − linked refunds by
 * the refund's own date.
 */
export function monthlyTrend<T extends Row>(
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): MonthBucket[] {
  const bounds = boundsOf(range);
  if (!(bounds.fromMs <= bounds.toMs)) return [];
  const startIndex = range.from.getFullYear() * 12 + range.from.getMonth();
  const endIndex = range.to.getFullYear() * 12 + range.to.getMonth();

  const buckets: MonthBucket[] = [];
  for (let index = startIndex; index <= endIndex; index++) {
    const year = Math.floor(index / 12);
    const month = index % 12;
    const monthStartMs = new Date(year, month, 1).getTime();
    const nextMonthStartMs = new Date(year, month + 1, 1).getTime();
    buckets.push({
      monthKey: `${year}-${pad2(month + 1)}`,
      incomeMinor: 0,
      spendMinor: 0,
      partial: bounds.fromMs > monthStartMs || bounds.toMs < nextMonthStartMs - 1,
    });
  }

  for (const t of transactions) {
    if (t.status !== 'approved' || !countsTowardIncomeExpense(t)) continue;
    const at = Date.parse(t.occurredAt);
    if (!(at >= bounds.fromMs && at <= bounds.toMs)) continue;
    const date = new Date(at);
    const bucket = buckets[date.getFullYear() * 12 + date.getMonth() - startIndex];
    if (!bucket) continue;
    bucket.incomeMinor += incomeContributionMinor(t);
    bucket.spendMinor += spendContributionMinor(t);
  }
  return buckets;
}

/**
 * Approved, counting rows of one merchant (same normalizeMerchant key the R2
 * rules use) inside the range. count = every such row (expenses, plain
 * income and linked refunds); spend = expenses − linked refunds; income =
 * plain income. An empty key matches nothing.
 */
export function merchantHistory<T extends Row & Pick<Transaction, 'merchantName'>>(
  transactions: ReadonlyArray<T>,
  merchantKey: string,
  range: PeriodRange,
): MerchantHistory {
  const history: MerchantHistory = { count: 0, spendMinor: 0, incomeMinor: 0 };
  if (merchantKey === '') return history;
  const bounds = boundsOf(range);
  for (const t of transactions) {
    if (t.status !== 'approved' || !countsTowardIncomeExpense(t)) continue;
    if (!inBounds(t.occurredAt, bounds)) continue;
    if (normalizeMerchant(t.merchantName) !== merchantKey) continue;
    history.count += 1;
    history.incomeMinor += incomeContributionMinor(t);
    history.spendMinor += spendContributionMinor(t);
  }
  return history;
}

/**
 * Source of "Records start …" (partial-data notice): the occurredAt of the
 * earliest APPROVED row of any type (incl. transfers, rows on removed
 * accounts). null when nothing is approved yet.
 */
export function earliestApprovedAt(
  transactions: ReadonlyArray<Pick<Transaction, 'status' | 'occurredAt'>>,
): string | null {
  let earliest: string | null = null;
  let earliestMs = Infinity;
  for (const t of transactions) {
    if (t.status !== 'approved') continue;
    const at = Date.parse(t.occurredAt);
    if (at < earliestMs) {
      earliestMs = at;
      earliest = t.occurredAt;
    }
  }
  return earliest;
}

/**
 * Partial-data notice: true when the period starts on an earlier calendar
 * day (local) than the first approved record. Compared by day, because the
 * notice names a day ("Records start 5 Oct 2026"): records that start later
 * on the period's first day still cover that day.
 */
export function startsBeforeRecords(range: PeriodRange, earliestIso: string | null): boolean {
  if (earliestIso === null) return false;
  const earliest = new Date(earliestIso);
  if (Number.isNaN(earliest.getTime())) return false;
  const earliestDayMs = new Date(
    earliest.getFullYear(),
    earliest.getMonth(),
    earliest.getDate(),
  ).getTime();
  return range.from.getTime() < earliestDayMs;
}

/**
 * "N pending not included": pending rows dated in the range that WOULD
 * count once approved (income/expense; never transfers/twins/duplicates).
 */
export function pendingInRangeCount<T extends Row>(
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): number {
  const bounds = boundsOf(range);
  let count = 0;
  for (const t of transactions) {
    if (t.status === 'pending' && countsTowardIncomeExpense(t) && inBounds(t.occurredAt, bounds)) {
      count += 1;
    }
  }
  return count;
}
