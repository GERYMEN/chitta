import { SplitError } from '../../domain/iou/iou.rules';
import { formatRupeesFromMinor } from '../../shared/utils/currency';

/** Copy for R10. Amounts go through the redaction-aware formatter. */

export const SPLIT_ERROR_TEXT: Record<SplitError | 'not-approved-expense', string> = {
  'no-shares': 'Add at least one person.',
  'no-person': 'Type a name for every share.',
  'amount-not-positive': 'Each amount must be more than ₹0.',
  'amount-not-whole': 'Enter amounts in rupees and paise (for example 250.50).',
  'over-expense': 'The shares add up to more than this expense.',
  'not-approved-expense': 'Only an approved expense can be split.',
};

/** "250" / "250.5" / "250.50" -> paise; anything else -> null. */
export function parseRupeesToMinor(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Expense row summary: "Split: 2 people owe you ₹750" / "Split: all paid back". */
export function splitSummaryLabel(owedCount: number, owedMinor: number, totalCount: number): string {
  if (totalCount === 0) return '';
  if (owedCount === 0) return `Split: ${totalCount} ${plural(totalCount, 'person', 'people')} paid you back`;
  return `Split: ${owedCount} ${plural(owedCount, 'person owes', 'people owe')} you ${formatRupeesFromMinor(owedMinor)}`;
}

/** Home tile text. */
export function youGetLabel(minor: number): string {
  return `You get ${formatRupeesFromMinor(minor)}`;
}
export function youOweLabel(minor: number): string {
  return `You owe ${formatRupeesFromMinor(minor)}`;
}

/** Per-person net line. */
export function netLabel(netMinor: number): string {
  if (netMinor > 0) return `owes you ${formatRupeesFromMinor(netMinor)}`;
  if (netMinor < 0) return `you owe ${formatRupeesFromMinor(-netMinor)}`;
  return 'settled up';
}
