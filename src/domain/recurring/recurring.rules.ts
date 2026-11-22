import { Transaction } from '../transactions/transaction.types';
import { spendContributionMinor } from '../transactions/transaction.rules';
import { normalizeMerchant } from '../merchants/normalizeMerchant';
import { RecurringCadence, RecurringSeries } from './recurring.types';

/** R8a (D-b): minimum occurrences before a group can be recurring. */
export const RECURRING_MIN_OCCURRENCES = 3;
/** Each amount must be within this fraction of the group's median. */
export const RECURRING_AMOUNT_TOLERANCE = 0.1;
/** Inclusive day-gap range accepted per cadence. */
export const CADENCE_GAP_DAYS: Record<RecurringCadence, { min: number; max: number }> = {
  weekly: { min: 6, max: 8 },
  monthly: { min: 28, max: 31 },
  yearly: { min: 360, max: 370 },
};
/** D-c: an upcoming series may be this many days overdue and still show. */
export const UPCOMING_OVERDUE_DAYS = 3;
/** D-c: how far ahead "upcoming" looks. */
export const UPCOMING_WINDOW_DAYS = 14;

const DAY_MS = 86400000;
const CADENCES: RecurringCadence[] = ['weekly', 'monthly', 'yearly'];

/** Local calendar day index (so DST / time of day never skew a gap). */
function dayIndex(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

/** nextDue = last + the cadence step (weekly 7d, monthly +1 calendar month, yearly +12). */
function nextDueFrom(last: Date, cadence: RecurringCadence): Date {
  if (cadence === 'weekly') {
    const next = new Date(last.getTime());
    next.setDate(next.getDate() + 7);
    return next;
  }
  return addMonths(last, cadence === 'monthly' ? 1 : 12);
}

function cadenceForGaps(gaps: number[]): RecurringCadence | null {
  for (const cadence of CADENCES) {
    const { min, max } = CADENCE_GAP_DAYS[cadence];
    if (gaps.every(gap => gap >= min && gap <= max)) return cadence;
  }
  return null;
}

/**
 * R8a (D-a..D-d): detect recurring payments from approved SPEND rows. Pure —
 * `now` is passed in only to drop nothing; no clock is read here. Rows that
 * are not approved, or that do not add to spend (transfers, income, linked
 * refunds, hidden duplicates), are ignored.
 */
export function detectRecurring(transactions: Transaction[], _now: Date): RecurringSeries[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.status !== 'approved') continue;
    if (spendContributionMinor(t) <= 0) continue;
    const key = normalizeMerchant(t.merchantName);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const series: RecurringSeries[] = [];
  for (const [merchantKey, rows] of groups) {
    if (rows.length < RECURRING_MIN_OCCURRENCES) continue;
    const sorted = [...rows].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
    const days = sorted.map(r => dayIndex(new Date(r.occurredAt)));
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    const cadence = cadenceForGaps(gaps);
    if (!cadence) continue;

    const amounts = sorted.map(r => spendContributionMinor(r));
    const typical = median(amounts);
    if (typical <= 0) continue;
    if (amounts.some(a => Math.abs(a - typical) > typical * RECURRING_AMOUNT_TOLERANCE)) continue;

    const last = sorted[sorted.length - 1];
    series.push({
      merchantKey,
      displayName: last.merchantName,
      cadence,
      typicalAmountMinor: typical,
      lastAt: last.occurredAt,
      nextDueAt: nextDueFrom(new Date(last.occurredAt), cadence).toISOString(),
      occurrenceCount: sorted.length,
    });
  }
  return series.sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
}

/**
 * R8a (D-c/D-d): series due within [now - 3 days, now + windowDays] (local
 * calendar days), sorted by nextDueAt. Pure.
 */
export function upcomingWithin(
  series: RecurringSeries[],
  now: Date,
  windowDays: number = UPCOMING_WINDOW_DAYS,
): RecurringSeries[] {
  const today = dayIndex(now);
  return series
    .filter(s => {
      const delta = dayIndex(new Date(s.nextDueAt)) - today;
      return delta >= -UPCOMING_OVERDUE_DAYS && delta <= windowDays;
    })
    .sort((a, b) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime());
}

/** Whole local days from today to the due date (negative = overdue). */
export function daysUntilDue(nextDueAt: string, now: Date): number {
  return dayIndex(new Date(nextDueAt)) - dayIndex(now);
}

/** "today", "tomorrow", "in 5 days", "1 day overdue", "2 days overdue". */
export function relativeDueLabel(nextDueAt: string, now: Date): string {
  const d = daysUntilDue(nextDueAt, now);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d > 1) return `in ${d} days`;
  return d === -1 ? '1 day overdue' : `${-d} days overdue`;
}
