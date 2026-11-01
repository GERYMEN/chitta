import { Period } from '../../domain/periods/period.types';
import {
  CategoryBreakdownRow,
  MerchantHistory,
  MonthBucket,
} from '../../domain/insights/insights.types';
import { formatRupeesFromMinor } from '../../shared/utils/currency';

/**
 * R4 copy for the period selector, notices, "Where it went", Trends and the
 * merchant chip. Pure strings only (the domain returns numbers). Dates use
 * fixed English month names so output never depends on the device's Intl.
 */

/** Tile captions / section subtitles per period. */
export const PERIOD_CAPTION: Record<Period, string> = {
  '1M': 'This month',
  '3M': 'Last 3 months',
  '6M': 'Last 6 months',
  '9M': 'Last 9 months',
  '1Y': 'Last 12 months',
};

/** The caption inside a sentence: "this month", "last 3 months". */
export function periodPhrase(period: Period): string {
  const caption = PERIOD_CAPTION[period];
  return caption.charAt(0).toLowerCase() + caption.slice(1);
}

/** Chip a11y label: "1M, This month". */
export function periodChipA11yLabel(period: Period): string {
  return `${period}, ${PERIOD_CAPTION[period]}`;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "5 Oct 2026" (d MMM yyyy), local time. */
export function formatDayMonthYear(date: Date): string {
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

/** "October 2026", local time (Home date line). */
export function formatMonthYear(date: Date): string {
  return `${MONTH_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/** Partial-data notice under the selector (source: earliest approved row). */
export function partialDataNotice(earliestIso: string): string {
  return `Records start ${formatDayMonthYear(new Date(earliestIso))} — earlier months may be incomplete.`;
}

/** Small hint under the selector — a count only. */
export function pendingNotIncludedLabel(count: number): string {
  return `${count} pending not included`;
}

/** "40%"; "<1%" for a tiny positive share; "0%" at or below 0. */
export function shareLabel(share: number): string {
  if (!(share > 0)) return '0%';
  const percent = Math.round(share * 100);
  return percent === 0 ? '<1%' : `${percent}%`;
}

export function itemCountLabel(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}

/** Bar caption: "3 items · 40% of spend". */
export function categoryBarDetail(row: Pick<CategoryBreakdownRow, 'count' | 'share'>): string {
  return `${itemCountLabel(row.count)} · ${shareLabel(row.share)} of spend`;
}

/** Bar a11y: "Food: ₹1,200, 3 items, 40% of spend". */
export function categoryBarA11yLabel(
  name: string,
  row: Pick<CategoryBreakdownRow, 'spendMinor' | 'count' | 'share'>,
): string {
  return `${name}: ${formatRupeesFromMinor(row.spendMinor)}, ${itemCountLabel(row.count)}, ${shareLabel(row.share)} of spend`;
}

/** Name of the folded row on the Home card. */
export const OTHER_LABEL = 'Other';

/** A11y name of the folded row: "Other, 3 categories". */
export function otherCategoriesA11yName(categoryCount: number): string {
  return `${OTHER_LABEL}, ${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}`;
}

/** Empty "Where it went": "No spending this month." */
export function noSpendingLabel(period: Period): string {
  return `No spending ${periodPhrase(period)}.`;
}

export function visitsLabel(count: number): string {
  return `${count} visit${count === 1 ? '' : 's'}`;
}

/**
 * Detail merchant chip: "1 visit · ₹200 this month". For a plain income row
 * the amount is what came in from that merchant ("… ₹500 received …");
 * otherwise it is the spend there (expenses − linked refunds).
 */
export function merchantChipLabel(
  history: MerchantHistory,
  kind: 'spend' | 'income',
  period: Period,
): string {
  if (history.count === 0) return `No visits ${periodPhrase(period)}`;
  const amount = formatRupeesFromMinor(kind === 'income' ? history.incomeMinor : history.spendMinor);
  const received = kind === 'income' ? ' received' : '';
  return `${visitsLabel(history.count)} · ${amount}${received} ${periodPhrase(period)}`;
}

/** Removable Transactions chip: "Merchant: QA-Merchant-12 ✕". */
export function merchantFilterChipLabel(name: string | null): string {
  return `Merchant: ${name && name.trim() !== '' ? name.trim() : 'selected'} ✕`;
}

function monthParts(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month: month - 1 };
}

/** Trend bar label: "Oct", or "Oct*" for a partial month. */
export function monthBarLabel(bucket: Pick<MonthBucket, 'monthKey' | 'partial'>): string {
  const { month } = monthParts(bucket.monthKey);
  return `${MONTH_SHORT[month]}${bucket.partial ? '*' : ''}`;
}

/** "October 2026". */
export function monthTitle(monthKey: string): string {
  const { year, month } = monthParts(monthKey);
  return `${MONTH_LONG[month]} ${year}`;
}

/** "Oct 2026". */
export function monthShortTitle(monthKey: string): string {
  const { year, month } = monthParts(monthKey);
  return `${MONTH_SHORT[month]} ${year}`;
}

/** Trend bar a11y: "October 2026, partial month: spent ₹300, income ₹1,000". */
export function monthBarA11yLabel(bucket: MonthBucket): string {
  return `${monthTitle(bucket.monthKey)}${bucket.partial ? ', partial month' : ''}: spent ${formatRupeesFromMinor(bucket.spendMinor)}, income ${formatRupeesFromMinor(bucket.incomeMinor)}`;
}

/** Selected-month line above the chart: "October 2026 · partial". */
export function monthDetailTitle(bucket: Pick<MonthBucket, 'monthKey' | 'partial'>): string {
  return `${monthTitle(bucket.monthKey)}${bucket.partial ? ' · partial' : ''}`;
}

/** "Aug 2026 – Oct 2026" under the chart (or one month). */
export function trendSpanLabel(buckets: ReadonlyArray<Pick<MonthBucket, 'monthKey'>>): string {
  if (buckets.length === 0) return '';
  const first = monthShortTitle(buckets[0].monthKey);
  const last = monthShortTitle(buckets[buckets.length - 1].monthKey);
  return first === last ? first : `${first} – ${last}`;
}

/** Trends subtitle: 1M explains its context months. */
export function trendCaption(period: Period): string {
  return period === '1M'
    ? 'This month and the 2 months before it, for context'
    : `Month by month, ${periodPhrase(period)}`;
}

export const PARTIAL_MONTH_FOOTNOTE = '* Partial month — still in progress, or only part of it is in this period.';

/** R4e donut legend: whole percent from the pie model; "<1%" for a sliver. */
export function piePercentLabel(percent: number, share: number): string {
  if (percent > 0) return `${percent}%`;
  return share > 0 ? '<1%' : '0%';
}

/** R4e legend row a11y: "QA Food, 60%, ₹300". */
export function pieLegendA11yLabel(name: string, percentLabel: string, spendMinor: number): string {
  return `${name}, ${percentLabel}, ${formatRupeesFromMinor(spendMinor)}`;
}

/** R4e donut summary: "Spending by category, ₹500 in total: QA Food 60%, QA Shopping 40%". */
export function pieSummaryA11yLabel(
  totalMinor: number,
  parts: ReadonlyArray<{ name: string; percentLabel: string }>,
): string {
  const list = parts.map(part => `${part.name} ${part.percentLabel}`).join(', ');
  return `Spending by category, ${formatRupeesFromMinor(totalMinor)} in total: ${list}`;
}
