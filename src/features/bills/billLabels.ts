import { BillKind } from '../../domain/bills/bill.types';

export const BILL_KIND_LABEL: Record<BillKind, string> = {
  card_statement: 'Card statement',
  pay_later: 'Pay later',
  biller: 'Biller',
  scheduled_debit: 'Scheduled debit',
  manual: 'Manual',
};

export const BILL_KIND_OPTIONS: Array<{ value: BillKind; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'biller', label: 'Biller' },
  { value: 'card_statement', label: 'Card statement' },
  { value: 'pay_later', label: 'Pay later' },
  { value: 'scheduled_debit', label: 'Scheduled debit' },
];

/** Short due-date line, e.g. "Due 20 Nov 2026" or "No due date". */
export function dueLabel(dueDate: string | null): string {
  if (!dueDate) return 'No due date';
  return `Due ${new Date(dueDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}
