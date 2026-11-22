import { Bill } from '../bills/bill.types';
import { billUrgency, remainingMinor } from '../bills/bill.rules';
import { RecurringSeries } from '../recurring/recurring.types';
import { Transaction } from '../transactions/transaction.types';
import { periodTotals } from '../insights/insights.rules';
import { formatRupeesPlain } from '../../shared/utils/currency';

/**
 * R8b: the PURE planner. JS decides WHAT to notify and WHEN; native only
 * schedules inexact alarms and posts the pre-built text. Nothing here reads a
 * clock, the DB or a store: `now` and all data are passed in.
 *
 * Privacy (D-g): a notification never carries SMS text, a sender or an account
 * number. When Private mode is on (`hideAmounts`) it also carries NO rupee
 * figure and NO payee / merchant name; the text is generic instead.
 */
export type NotificationChannelId = 'bills' | 'reminders' | 'summary';

export interface ScheduledItem {
  /** Stable id (bill id / hashed merchant key / 'weekly') — native cancels and replaces by it. */
  id: string;
  title: string;
  body: string;
  /** Local-time instant (epoch ms) the notification should appear. Inexact. */
  whenEpochMs: number;
  channel: NotificationChannelId;
}

export interface NotificationSettings {
  bills: boolean;
  recurring: boolean;
  weekly: boolean;
  /** 0 = Sunday .. 6 = Saturday. */
  weeklyDay: number;
  /** Local hour 0-23. */
  weeklyHour: number;
}

export interface PlanInput {
  bills: ReadonlyArray<Bill>;
  /** All detected series; only those in `remindedKeys` are scheduled. */
  recurring: ReadonlyArray<RecurringSeries>;
  remindedKeys: ReadonlyArray<string>;
  transactions: ReadonlyArray<Transaction>;
  settings: NotificationSettings;
  now: Date;
  hideAmounts: boolean;
}

/** Bill and recurring reminders appear at this local hour. */
export const REMINDER_HOUR = 9;
export const DEFAULT_WEEKLY_DAY = 0;
export const DEFAULT_WEEKLY_HOUR = 9;
const WEEK_DAYS = 7;

function atHour(base: Date, dayOffset: number, hour: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0);
}

function dayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** Next local `hour`:00 strictly after `now` (today if still ahead, else tomorrow). */
function nextHour(now: Date, hour: number): Date {
  const today = atHour(now, 0, hour);
  return today.getTime() > now.getTime() ? today : atHour(now, 1, hour);
}

/** Next `weekday` (0-6) at `hour` strictly after `now`. */
function nextWeekly(now: Date, weekday: number, hour: number): Date {
  const ahead = (weekday - now.getDay() + WEEK_DAYS) % WEEK_DAYS;
  const candidate = atHour(now, ahead, hour);
  return candidate.getTime() > now.getTime() ? candidate : atHour(now, ahead + WEEK_DAYS, hour);
}

/** Short stable hash so a merchant name is never used as a stored id. */
function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = (h * 33 + text.charCodeAt(i)) % 4_294_967_296;
  return h.toString(16);
}

function billItems(input: PlanInput): ScheduledItem[] {
  const { bills, now, hideAmounts } = input;
  const items: ScheduledItem[] = [];
  for (const bill of bills) {
    const urgency = billUrgency(bill, now);
    // Same rule as the Home due banner: overdue or due soon (open bills only).
    if ((urgency !== 'overdue' && urgency !== 'due_soon') || !bill.dueDate) continue;
    const due = new Date(bill.dueDate);
    const dueMorning = atHour(due, 0, REMINDER_HOUR);
    const when = dueMorning.getTime() > now.getTime() ? dueMorning : nextHour(now, REMINDER_HOUR);
    const overdue = dayIndex(when) > dayIndex(due);
    const status = overdue ? 'overdue' : 'due';
    const body = hideAmounts
      ? `A bill is ${status}`
      : `${bill.payee} bill is ${status} (~${formatRupeesPlain(remainingMinor(bill))})`;
    items.push({
      id: `bill:${bill.id}`,
      title: overdue ? 'Bill overdue' : 'Bill due',
      body,
      whenEpochMs: when.getTime(),
      channel: 'bills',
    });
  }
  return items;
}

function recurringItems(input: PlanInput): ScheduledItem[] {
  const { recurring, remindedKeys, now, hideAmounts } = input;
  const items: ScheduledItem[] = [];
  for (const series of recurring) {
    if (!remindedKeys.includes(series.merchantKey)) continue;
    const when = atHour(new Date(series.nextDueAt), 0, REMINDER_HOUR);
    // A date already behind us is skipped, not fired late: an estimate is not worth a stale ping.
    if (when.getTime() <= now.getTime()) continue;
    items.push({
      id: `rec:${shortHash(series.merchantKey)}`,
      title: 'Payment coming up',
      body: hideAmounts
        ? 'A recurring payment is usually due around now'
        : `${series.displayName} is usually due around now`,
      whenEpochMs: when.getTime(),
      channel: 'reminders',
    });
  }
  return items;
}

function weeklyItem(input: PlanInput): ScheduledItem {
  const { settings, now, transactions, hideAmounts } = input;
  const when = nextWeekly(now, settings.weeklyDay, settings.weeklyHour);
  let body = 'Your weekly summary is ready';
  if (!hideAmounts) {
    const from = atHour(now, -WEEK_DAYS, 0);
    const { expenseMinor } = periodTotals(transactions, { from, to: now });
    const pending = transactions.filter(t => t.status === 'pending').length;
    body = `This week: spent ${formatRupeesPlain(expenseMinor)}, ${pending} pending`;
  }
  return { id: 'weekly', title: 'Weekly summary', body, whenEpochMs: when.getTime(), channel: 'summary' };
}

/** The full set of notifications that should be scheduled right now (replaces any earlier set). */
export function buildScheduledNotifications(input: PlanInput): ScheduledItem[] {
  const { settings } = input;
  return [
    ...(settings.bills ? billItems(input) : []),
    ...(settings.recurring ? recurringItems(input) : []),
    ...(settings.weekly ? [weeklyItem(input)] : []),
  ];
}
