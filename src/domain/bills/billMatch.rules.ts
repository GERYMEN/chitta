import { Bill, BillKind } from './bill.types';
import { Transaction } from '../transactions/transaction.types';

/** A proposed "Bill paid?" link (D-e). The user confirms it; never auto-marked. */
export interface BillMatch {
  billId: string;
  transactionId: string;
}

const CARD_BILL_KINDS: ReadonlySet<BillKind> = new Set(['card_statement', 'pay_later']);

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_BEFORE_DUE_MS = 30 * DAY_MS;
const WINDOW_AFTER_DUE_MS = 7 * DAY_MS;

/** Normalize a payee / merchant for a loose match (case + punctuation folded). */
function normalizePayee(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function payeeMatches(billPayee: string, merchant: string): boolean {
  const a = normalizePayee(billPayee);
  const b = normalizePayee(merchant);
  if (a.length === 0 || b.length === 0) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/** The amount a payment must reach: the min due, else the full amount due. */
function requiredMinor(bill: Pick<Bill, 'amountDueMinor' | 'minDueMinor'>): number {
  return bill.minDueMinor != null && bill.minDueMinor > 0 ? bill.minDueMinor : bill.amountDueMinor;
}

/** [windowStart, windowEnd] in epoch ms, or null when no due date to anchor on. */
function paymentWindow(bill: Pick<Bill, 'statementDate' | 'dueDate'>): { start: number; end: number } | null {
  if (!bill.dueDate) return null;
  const dueMs = Date.parse(bill.dueDate);
  const start = bill.statementDate ? Date.parse(bill.statementDate) : dueMs - WINDOW_BEFORE_DUE_MS;
  return { start, end: dueMs + WINDOW_AFTER_DUE_MS };
}

/** The amount a transaction contributes to a bill: a card-bill transfer's move or an expense. */
function paymentAmountFor(bill: Bill, t: Transaction): number | null {
  if (CARD_BILL_KINDS.has(bill.kind)) {
    // A card bill payment is a transfer INTO the card / pay-later account.
    if (t.type === 'transfer' && bill.accountId != null && t.transferAccountId === bill.accountId) {
      return t.amountMinor;
    }
    return null;
  }
  // Biller / manual / scheduled debit: an expense whose merchant matches the payee.
  if (t.type === 'expense' && payeeMatches(bill.payee, t.merchantName)) {
    return t.amountMinor;
  }
  return null;
}

/**
 * D-e: a payment transaction (a card bill payment transfer to that card /
 * pay-later account, or an expense whose merchant matches a biller bill) with
 * amount >= the min due (or >= the amount due when no min), dated from the
 * statement date (or due date − 30 days) to due date + 7 days, becomes a
 * "Bill paid?" suggestion. Pending rows (R5h) are never matched — only
 * approved ones. Never auto-marked: the suggestion waits for the user.
 */
export function matchBillSuggestions(
  bills: ReadonlyArray<Bill>,
  transactions: ReadonlyArray<Transaction>,
): BillMatch[] {
  const openBills = bills.filter(b => b.status === 'open' && b.paidTransactionId == null);
  const approved = transactions.filter(t => t.status === 'approved');
  const linkedTxnIds = new Set(
    bills.map(b => b.paidTransactionId).filter((id): id is string => id != null),
  );
  const matches: BillMatch[] = [];
  const usedTxn = new Set<string>();
  for (const bill of openBills) {
    const window = paymentWindow(bill);
    if (!window) continue;
    const need = requiredMinor(bill);
    for (const t of approved) {
      if (usedTxn.has(t.id) || linkedTxnIds.has(t.id)) continue;
      const amount = paymentAmountFor(bill, t);
      if (amount == null || amount < need) continue;
      const when = Date.parse(t.occurredAt);
      if (when < window.start || when > window.end) continue;
      matches.push({ billId: bill.id, transactionId: t.id });
      usedTxn.add(t.id);
      break;
    }
  }
  return matches;
}

/** Add +1 calendar month to an ISO date, keeping the time-of-day. */
function addMonth(iso: string): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

/**
 * D-h: when a monthly manual bill is paid, create next month's open bill —
 * same payee / amount / account, due and statement dates advanced one month,
 * paid progress and link reset.
 */
export function nextMonthlyBill(
  bill: Bill,
  nowIso: () => string,
  nextId: () => string,
): Bill | null {
  if (bill.repeat !== 'monthly') return null;
  const now = nowIso();
  return {
    ...bill,
    id: nextId(),
    status: 'open',
    paidMinor: 0,
    paidTransactionId: null,
    statementDate: bill.statementDate ? addMonth(bill.statementDate) : null,
    dueDate: bill.dueDate ? addMonth(bill.dueDate) : null,
    createdAt: now,
    updatedAt: now,
  };
}
