import { formatRupeesFromMinor } from '../../shared/utils/currency';
import { RecurringCadence } from '../../domain/recurring/recurring.types';

export const CADENCE_LABEL: Record<RecurringCadence, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** D-g: an estimate, never a confirmed charge. Redaction-aware. */
export function approxAmountLabel(amountMinor: number): string {
  return `~${formatRupeesFromMinor(amountMinor)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Oct 2026" in the device's local calendar. */
export function shortDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
