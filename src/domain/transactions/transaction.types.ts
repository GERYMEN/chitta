/**
 * R3a: 'transfer' = money moved between two of the owner's own accounts.
 * One row: `accountId` is the "from" account, `transferAccountId` the "to"
 * account. It changes both balances and never counts as income or expense.
 */
export type TransactionType = 'income' | 'expense' | 'transfer';

/**
 * R3a: what a link on a row means. 'transfer_twin' = the SMS credit half of a
 * confirmed transfer pair (kept, rejected, for dedup). R3b: 'refund' = an
 * income linked to the expense it gives money back for (not income; reduces
 * spend); 'duplicate' = a row hidden as a duplicate of the linked (kept) row
 * (rejected, kept for dedup).
 */
export type LinkKind = 'transfer_twin' | 'refund' | 'duplicate';

export type TransactionStatus = 'pending' | 'approved' | 'rejected' | 'invalid';

export type PaymentMethod = 'bank' | 'upi' | 'cash' | 'card' | 'other';

export type SourceType = 'sms' | 'notification' | 'manual';

/**
 * amount_minor is an integer (paise) — financial values are never
 * represented internally as floating-point money amounts.
 */
export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amountMinor: number;
  currency: 'INR';
  merchantName: string;
  categoryId: string;
  accountId: string;
  paymentMethod: PaymentMethod;
  occurredAt: string;
  detectedAt: string;
  approvedAt: string | null;
  note: string | null;
  sourceType: SourceType;
  sourceReferenceHash: string | null;
  /** Sanitized preview only — never the complete raw message body (docs/PROJECT.md §16). */
  sanitizedPreview: string | null;
  confidenceScore: number | null;
  parserVersion: string | null;
  bulkBatchId: string | null;
  /** R3a: the "to" account of a transfer (null/absent for income/expense). */
  transferAccountId?: string | null;
  /** R3a/R3b: the row this one is linked to (twin → transfer, refund → expense, duplicate → kept row). */
  linkedTransactionId?: string | null;
  linkKind?: LinkKind | null;
  createdAt: string;
  updatedAt: string;
}
