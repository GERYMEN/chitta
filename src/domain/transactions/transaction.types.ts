export type TransactionType = 'income' | 'expense';

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
  createdAt: string;
  updatedAt: string;
}
