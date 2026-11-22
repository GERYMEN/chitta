import type { Transaction } from '../../domain/transactions/transaction.types';
import type { Account } from '../../domain/accounts/account.types';
import type { Category } from '../../domain/categories/category.types';

/**
 * R9a T3: pure CSV of the user's APPROVED transactions. Columns are fixed and
 * hold NO SMS content: no body, sender, sanitized preview or reference hash.
 * The amount is the real figure (an explicit export of the user's own data —
 * redaction does not apply). CRLF line ends (RFC 4180).
 */
export const CSV_HEADER = 'date,type,account,category,merchant,amount,notes';

/** RFC 4180: wrap fields with comma / quote / CR / LF; double inner quotes. */
export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Spreadsheet formula guard for free text: a leading = + - @ gets a ' prefix. */
function textField(value: string | null | undefined): string {
  const text = value ?? '';
  return csvEscape(/^[=+\-@]/.test(text) ? `'${text}` : text);
}

/** Integer paise → "1234.50" with no float arithmetic. */
function rupees(amountMinor: number): string {
  const abs = Math.abs(Math.trunc(amountMinor));
  const whole = Math.floor(abs / 100);
  const paise = String(abs % 100).padStart(2, '0');
  return `${amountMinor < 0 ? '-' : ''}${whole}.${paise}`;
}

export function csvFromTransactions(
  transactions: ReadonlyArray<Transaction>,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'name'>>,
  categories: ReadonlyArray<Pick<Category, 'id' | 'name'>>,
): string {
  const accountName = new Map(accounts.map(a => [a.id, a.name]));
  const categoryName = new Map(categories.map(c => [c.id, c.name]));
  const approved = transactions
    .filter(t => t.status === 'approved')
    .slice()
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
  const lines = approved.map(t =>
    [
      csvEscape(t.occurredAt),
      csvEscape(t.type),
      textField(accountName.get(t.accountId)),
      textField(categoryName.get(t.categoryId)),
      textField(t.merchantName),
      rupees(t.amountMinor),
      textField(t.note),
    ].join(','),
  );
  return [CSV_HEADER, ...lines].join('\r\n');
}

export function csvFileName(now: Date): string {
  return `tracker-transactions-${now.toISOString().slice(0, 10)}.csv`;
}
