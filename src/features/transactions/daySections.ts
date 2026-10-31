import { Transaction } from '../../domain/transactions/transaction.types';
import { incomeExpenseTotals } from '../../domain/transactions/transaction.rules';

/**
 * Transactions-list day sections. Fixes B1: "today" is the screen's
 * injected now (useNow — the device clock, refreshed on focus), never a
 * fixed fixture date, so TODAY / YESTERDAY are right on any day.
 */

/** Local calendar day of an ISO timestamp. */
export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "TODAY", "YESTERDAY" (relative to `now`), else e.g. "1 OCT". */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameLocalDay(date, now)) return 'TODAY';
  if (sameLocalDay(date, yesterday)) return 'YESTERDAY';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase();
}

export interface DaySection<T> {
  title: string;
  /** Day net via the single income/expense rule (transfers never move it). */
  netMinor: number;
  data: T[];
}

type SectionRow = Pick<Transaction, 'occurredAt' | 'type' | 'amountMinor'> &
  Partial<Pick<Transaction, 'linkKind' | 'linkedTransactionId'>>;

/** Rows grouped by local day, newest day first; rows keep their order within a day. */
export function buildDaySections<T extends SectionRow>(
  transactions: ReadonlyArray<T>,
  now: Date,
): DaySection<T>[] {
  const byDay = new Map<string, T[]>();
  for (const transaction of transactions) {
    const key = dayKey(transaction.occurredAt);
    const list = byDay.get(key) ?? [];
    list.push(transaction);
    byDay.set(key, list);
  }
  return Array.from(byDay.values())
    .sort((a, b) => Date.parse(b[0].occurredAt) - Date.parse(a[0].occurredAt))
    .map(data => ({
      title: dayLabel(data[0].occurredAt, now),
      netMinor: incomeExpenseTotals(data).netMinor,
      data,
    }));
}
