import { Bill } from '../bill.types';
import { Transaction } from '../../transactions/transaction.types';
import { matchBillSuggestions, nextMonthlyBill, BillMatch } from '../billMatch.rules';

function bill(p: Partial<Bill>): Bill {
  return {
    id: p.id ?? 'bill-1',
    accountId: p.accountId ?? null,
    kind: p.kind ?? 'manual',
    payee: p.payee ?? 'QA Biller',
    amountDueMinor: p.amountDueMinor ?? 100000,
    minDueMinor: p.minDueMinor ?? null,
    statementDate: p.statementDate ?? null,
    dueDate: p.dueDate ?? '2026-11-20T00:00:00+05:30',
    status: p.status ?? 'open',
    paidMinor: p.paidMinor ?? 0,
    paidTransactionId: p.paidTransactionId ?? null,
    source: p.source ?? 'manual',
    sourceHash: p.sourceHash ?? null,
    repeat: p.repeat ?? 'none',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function txn(p: Partial<Transaction>): Transaction {
  return {
    id: p.id ?? 'txn-1',
    type: p.type ?? 'expense',
    status: p.status ?? 'approved',
    amountMinor: p.amountMinor ?? 100000,
    currency: 'INR',
    merchantName: p.merchantName ?? 'QA Biller',
    categoryId: p.categoryId ?? 'cat-uncategorised',
    accountId: p.accountId ?? 'acc-bank',
    paymentMethod: 'bank',
    occurredAt: p.occurredAt ?? '2026-11-18T00:00:00+05:30',
    detectedAt: '2026-11-18T00:00:00+05:30',
    approvedAt: p.approvedAt ?? '2026-11-18T00:00:00+05:30',
    note: null,
    sourceType: p.sourceType ?? 'manual',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: null,
    parserVersion: null,
    bulkBatchId: null,
    transferAccountId: p.transferAccountId ?? null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
  };
}

describe('matchBillSuggestions (D-e)', () => {
  it('a card bill payment transfer matches the card statement', () => {
    const bills = [bill({ id: 'b', kind: 'card_statement', accountId: 'acc-card', amountDueMinor: 100000, minDueMinor: 20000 })];
    const txns = [txn({ id: 't', type: 'transfer', accountId: 'acc-bank', transferAccountId: 'acc-card', amountMinor: 50000 })];
    const matches = matchBillSuggestions(bills, txns);
    expect(matches).toEqual<BillMatch[]>([{ billId: 'b', transactionId: 't' }]);
  });

  it('an expense whose merchant matches a biller bill', () => {
    const bills = [bill({ id: 'b', kind: 'biller', payee: 'QA Electric Board', amountDueMinor: 80000 })];
    const txns = [txn({ id: 't', type: 'expense', merchantName: 'QA Electric Board', amountMinor: 80000 })];
    expect(matchBillSuggestions(bills, txns)).toEqual([{ billId: 'b', transactionId: 't' }]);
  });

  it('amount below min due does not match', () => {
    const bills = [bill({ id: 'b', kind: 'card_statement', accountId: 'acc-card', amountDueMinor: 100000, minDueMinor: 20000 })];
    const txns = [txn({ id: 't', type: 'transfer', transferAccountId: 'acc-card', amountMinor: 19999 })];
    expect(matchBillSuggestions(bills, txns)).toEqual([]);
  });

  it('amount below amount due (no min) does not match', () => {
    const bills = [bill({ id: 'b', kind: 'biller', payee: 'QA Biller', amountDueMinor: 100000, minDueMinor: null })];
    const txns = [txn({ id: 't', type: 'expense', merchantName: 'QA Biller', amountMinor: 99999 })];
    expect(matchBillSuggestions(bills, txns)).toEqual([]);
  });

  it('out-of-window payment does not match (due + 8 days)', () => {
    const bills = [bill({ id: 'b', kind: 'biller', payee: 'QA Biller', dueDate: '2026-11-20T00:00:00+05:30' })];
    const txns = [txn({ id: 't', merchantName: 'QA Biller', occurredAt: '2026-11-28T12:00:00+05:30' })];
    expect(matchBillSuggestions(bills, txns)).toEqual([]);
  });

  it('matches from statement_date to due + 7 days', () => {
    const bills = [bill({ id: 'b', kind: 'card_statement', accountId: 'acc-card', statementDate: '2026-11-01T00:00:00+05:30', dueDate: '2026-11-20T00:00:00+05:30', minDueMinor: 20000 })];
    const txns = [txn({ id: 't', type: 'transfer', transferAccountId: 'acc-card', amountMinor: 30000, occurredAt: '2026-11-27T00:00:00+05:30' })];
    expect(matchBillSuggestions(bills, txns)).toEqual([{ billId: 'b', transactionId: 't' }]);
  });

  it('pending transactions are never matched (R5h)', () => {
    const bills = [bill({ id: 'b', kind: 'biller', payee: 'QA Biller' })];
    const txns = [txn({ id: 't', merchantName: 'QA Biller', status: 'pending', approvedAt: null })];
    expect(matchBillSuggestions(bills, txns)).toEqual([]);
  });

  it('paid / dismissed bills and already-linked transactions are skipped', () => {
    const bills = [
      bill({ id: 'paid', status: 'paid', payee: 'QA Biller' }),
      bill({ id: 'open', kind: 'biller', payee: 'QA Biller', paidTransactionId: 't' }),
    ];
    const txns = [txn({ id: 't', merchantName: 'QA Biller' })];
    expect(matchBillSuggestions(bills, txns)).toEqual([]);
  });
});

describe('nextMonthlyBill (D-h)', () => {
  it('spawns next month, due date +1 month, reset paid/status', () => {
    const paid = bill({
      id: 'b',
      kind: 'manual',
      repeat: 'monthly',
      dueDate: '2026-11-20T00:00:00+05:30',
      statementDate: '2026-11-01T00:00:00+05:30',
      paidMinor: 100000,
      status: 'paid',
    });
    const next = nextMonthlyBill(paid, () => '2026-11-21T00:00:00.000Z', () => 'bill-next');
    expect(next).not.toBeNull();
    expect(next!.id).toBe('bill-next');
    expect(next!.status).toBe('open');
    expect(next!.paidMinor).toBe(0);
    expect(next!.paidTransactionId).toBeNull();
    expect(new Date(next!.dueDate!).getMonth()).toBe(11); // December (0-based)
    expect(next!.repeat).toBe('monthly');
  });

  it('returns null for a non-monthly bill', () => {
    expect(nextMonthlyBill(bill({ repeat: 'none' }), () => 'x', () => 'y')).toBeNull();
  });
});
