/**
 * R5b — Bills & dues. A bill is a known amount owed by a due date: a card
 * statement, a pay-later / biller bill, a future scheduled debit (mandate /
 * NACH / EMI due) or a manual reminder. Bills NEVER touch balances and are
 * NEVER transactions (D-d). Money stays integer paise.
 *
 * Privacy: `payee` is user text or a known issuer DISPLAY name only — never
 * raw SMS text and never a sender number. `sourceHash` is the R5d salted
 * content hash (no SMS content).
 */
export type BillKind =
  | 'card_statement'
  | 'pay_later'
  | 'biller'
  | 'scheduled_debit'
  | 'manual';

export type BillStatus = 'open' | 'paid' | 'dismissed';

export type BillSource = 'sms' | 'manual';

/**
 * Decision beyond D-c: D-h needs a monthly manual bill to spawn next month's
 * bill when it is paid. One extra column `repeat` carries that ('none' |
 * 'monthly'); SMS bills are always 'none'.
 */
export type BillRepeat = 'none' | 'monthly';

export interface Bill {
  id: string;
  /** The account this bill is for (a card / pay-later / biller), or null. */
  accountId: string | null;
  kind: BillKind;
  payee: string;
  amountDueMinor: number;
  minDueMinor: number | null;
  statementDate: string | null;
  /**
   * Decision: nullable. Manual bills always carry one (form-required); an SMS
   * bill with no parseable due date still becomes an open bill (shown under
   * "Later", never overdue / due soon).
   */
  dueDate: string | null;
  status: BillStatus;
  /** Paise paid so far; a partial payment adds to it. */
  paidMinor: number;
  /** The transaction a "Mark paid (linked)" tied to this bill, if any. */
  paidTransactionId: string | null;
  source: BillSource;
  /** R5d content hash for SMS dedupe; null for manual bills. */
  sourceHash: string | null;
  repeat: BillRepeat;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBillInput {
  accountId: string | null;
  kind: BillKind;
  payee: string;
  amountDueMinor: number;
  minDueMinor: number | null;
  statementDate: string | null;
  dueDate: string | null;
  source: BillSource;
  sourceHash: string | null;
  repeat?: BillRepeat;
}

/** Fields a user may edit on a manual bill (D-h). */
export interface BillPatch {
  payee?: string;
  amountDueMinor?: number;
  minDueMinor?: number | null;
  statementDate?: string | null;
  dueDate?: string | null;
  accountId?: string | null;
  repeat?: BillRepeat;
}

export const BILL_KINDS: ReadonlyArray<BillKind> = [
  'card_statement',
  'pay_later',
  'biller',
  'scheduled_debit',
  'manual',
];

export const BILL_STATUSES: ReadonlyArray<BillStatus> = ['open', 'paid', 'dismissed'];
