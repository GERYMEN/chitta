import { Bill } from './bill.types';
import { AccountType } from '../accounts/account.types';

/** D-f: "due soon" = open and due within this many days of today. */
export const DUE_SOON_DAYS = 7;

export type BillUrgency = 'overdue' | 'due_soon' | 'later' | 'done';

/** A bill's calendar-day index in the device's local timezone (date-only). */
function dayIndex(iso: string | Date): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / (24 * 60 * 60 * 1000),
  );
}

/** Paise still owed on a bill (never negative). */
export function remainingMinor(bill: Pick<Bill, 'amountDueMinor' | 'paidMinor'>): number {
  return Math.max(0, bill.amountDueMinor - bill.paidMinor);
}

/** D-e: a bill is paid when paid so far covers the amount due. */
export function isBillPaid(bill: Pick<Bill, 'amountDueMinor' | 'paidMinor'>): boolean {
  return bill.paidMinor >= bill.amountDueMinor;
}

/**
 * D-f (useNow, R4): overdue = open and due_date before today; due soon = open
 * and due within 7 days. A bill with no due date, or further out, is "later".
 * Paid / dismissed bills are "done".
 */
export function billUrgency(
  bill: Pick<Bill, 'status' | 'dueDate'>,
  now: Date,
): BillUrgency {
  if (bill.status !== 'open') return 'done';
  if (!bill.dueDate) return 'later';
  const due = dayIndex(bill.dueDate);
  const today = dayIndex(now);
  if (due < today) return 'overdue';
  if (due <= today + DUE_SOON_DAYS) return 'due_soon';
  return 'later';
}

export interface DueBannerModel {
  count: number;
  totalMinor: number;
  nextDueDate: string | null;
  hasOverdue: boolean;
}

/**
 * D-g: the Home due banner. Shows when any bill is overdue or due soon:
 * "N bills due — ₹X, next <date>". `totalMinor` sums each bill's REMAINING
 * amount. Null when nothing qualifies (the banner is hidden).
 */
export function dueBannerModel(
  bills: ReadonlyArray<Bill>,
  now: Date,
): DueBannerModel | null {
  const due = bills.filter(b => {
    const u = billUrgency(b, now);
    return u === 'overdue' || u === 'due_soon';
  });
  if (due.length === 0) return null;
  const totalMinor = due.reduce((sum, b) => sum + remainingMinor(b), 0);
  const hasOverdue = due.some(b => billUrgency(b, now) === 'overdue');
  const nextDueDate = due
    .map(b => b.dueDate)
    .filter((d): d is string => d != null)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return { count: due.length, totalMinor, nextDueDate, hasOverdue };
}

export interface BillSections {
  overdue: Bill[];
  dueSoon: Bill[];
  later: Bill[];
  paidDismissed: Bill[];
}

function byDueDateAsc(a: Bill, b: Bill): number {
  const da = a.dueDate ? Date.parse(a.dueDate) : Number.POSITIVE_INFINITY;
  const db = b.dueDate ? Date.parse(b.dueDate) : Number.POSITIVE_INFINITY;
  return da - db || a.id.localeCompare(b.id);
}

function byUpdatedDesc(a: Bill, b: Bill): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id);
}

/** D-h: Bills screen sections. Overdue first, soonest first; recent paid/dismissed. */
export function billSections(bills: ReadonlyArray<Bill>, now: Date): BillSections {
  const sections: BillSections = { overdue: [], dueSoon: [], later: [], paidDismissed: [] };
  for (const b of bills) {
    switch (billUrgency(b, now)) {
      case 'overdue':
        sections.overdue.push(b);
        break;
      case 'due_soon':
        sections.dueSoon.push(b);
        break;
      case 'later':
        sections.later.push(b);
        break;
      default:
        sections.paidDismissed.push(b);
    }
  }
  sections.overdue.sort(byDueDateAsc);
  sections.dueSoon.sort(byDueDateAsc);
  sections.later.sort(byDueDateAsc);
  sections.paidDismissed.sort(byUpdatedDesc);
  return sections;
}

export interface CreditUsage {
  usedMinor: number;
  limitMinor: number;
  availableMinor: number;
}

/**
 * D-b: used and available credit for a card / pay-later account. The account
 * balance is negative while money is owed, so `used` is its magnitude.
 * Null when the user set no credit limit.
 */
export function creditUsage(
  creditLimitMinor: number | null,
  balanceMinor: number,
): CreditUsage | null {
  if (creditLimitMinor == null) return null;
  const usedMinor = Math.max(0, -balanceMinor);
  return {
    usedMinor,
    limitMinor: creditLimitMinor,
    availableMinor: Math.max(0, creditLimitMinor - usedMinor),
  };
}

/** D-a/D-b: account types that carry a credit limit and a card-style bill. */
export function isCreditLimitAccount(type: AccountType): boolean {
  return type === 'credit_card' || type === 'pay_later';
}
