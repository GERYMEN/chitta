/**
 * R5e T6 — totals proof. A confirmed card bill payment, ATM withdrawal and
 * wallet top-up leave income / expense totals and the "Where it went" donut
 * unchanged while the two accounts' balances move; EMI shows under "EMI &
 * Loans"; interest counts as income. SYNTHETIC rows only.
 */
import type { Account, AccountType } from '../../accounts/account.types';
import type { Transaction } from '../../transactions/transaction.types';
import { calculateBalance } from '../../accounts/account.rules';
import { incomeExpenseTotals } from '../../transactions/transaction.rules';
import { periodTotals, spendByCategory } from '../../insights/insights.rules';
import { buildPieModel } from '../../insights/pie.rules';
import { buildMeaningConversion } from '../meaning.rules';

const T = '2026-11-05T10:00:00.000Z';
const RANGE = { from: new Date('2026-11-01T00:00:00.000Z'), to: new Date('2026-11-30T23:59:59.999Z') };
const NOW = '2026-11-06T09:00:00.000Z';

function account(id: string, type: AccountType, opening: number): Account {
  return {
    id,
    name: `QA ${id}`,
    type,
    lastFour: null,
    openingBalanceMinor: opening,
    currency: 'INR',
    isActive: true,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    deletedAt: null,
    createdAt: T,
    updatedAt: T,
  };
}

const ACCOUNTS = {
  bank: account('bank', 'bank', 10000000),
  card: account('card', 'credit_card', 0),
  cash: account('cash', 'cash', 0),
  paytm: account('paytm', 'other', 0),
};

let n = 0;
function tx(patch: Partial<Transaction>): Transaction {
  n += 1;
  return {
    id: `t${n}`,
    type: 'expense',
    status: 'approved',
    amountMinor: 100000,
    currency: 'INR',
    merchantName: `QA-Merchant-${n}`,
    categoryId: 'cat-shopping',
    accountId: 'bank',
    paymentMethod: 'other',
    occurredAt: T,
    detectedAt: T,
    approvedAt: T,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: `sms-${n}-1`,
    sanitizedPreview: null,
    confidenceScore: 90,
    parserVersion: 'sms-reader-v2',
    createdAt: T,
    updatedAt: T,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    ...patch,
  } as Transaction;
}

// Ordinary spending: a card purchase, a bank food spend, a salary.
const BASE: Transaction[] = [
  tx({ accountId: 'card', amountMinor: 300000, categoryId: 'cat-shopping' }),
  tx({ accountId: 'bank', amountMinor: 50000, categoryId: 'cat-food' }),
  tx({ type: 'income', accountId: 'bank', amountMinor: 4500000, categoryId: 'cat-salary' }),
];

// The three meaning items as the SMS reader records them (pending expenses).
const cardBill = tx({ status: 'pending', approvedAt: null, accountId: 'bank', amountMinor: 120000, categoryId: 'cat-uncategorised' });
const atm = tx({ status: 'pending', approvedAt: null, accountId: 'bank', amountMinor: 200000, categoryId: 'cat-uncategorised' });
const topUp = tx({ status: 'pending', approvedAt: null, accountId: 'bank', amountMinor: 50000, categoryId: 'cat-uncategorised' });

function confirm(row: Transaction, target: string): Transaction {
  return buildMeaningConversion(row, target, null, NOW, { approve: true })!.transfer;
}

const CONFIRMED = [confirm(cardBill, 'card'), confirm(atm, 'cash'), confirm(topUp, 'paytm')];
const balances = (rows: Transaction[]) =>
  Object.fromEntries(Object.values(ACCOUNTS).map(a => [a.id, calculateBalance(a, rows, a.id)]));
const approved = (rows: Transaction[]) => rows.filter(t => t.status === 'approved');

describe('R5e T6 — confirmed meanings never change income / expense / Where it went', () => {
  it('income / expense totals (Home, Transactions, Insights) are unchanged', () => {
    const before = incomeExpenseTotals(approved(BASE));
    const after = incomeExpenseTotals(approved([...BASE, ...CONFIRMED]));
    expect(after).toEqual(before);
    expect(periodTotals(approved([...BASE, ...CONFIRMED]), RANGE)).toEqual(periodTotals(approved(BASE), RANGE));
  });

  it('the Where-it-went donut (spend by category → pie) is unchanged', () => {
    const before = buildPieModel(spendByCategory(BASE, RANGE));
    const after = buildPieModel(spendByCategory([...BASE, ...CONFIRMED], RANGE));
    expect(after).toEqual(before);
    expect(spendByCategory([...BASE, ...CONFIRMED], RANGE).map(r => r.categoryId)).not.toContain('cat-transfer');
  });

  it('had they been approved as expenses, totals WOULD have double counted (the bug R5e fixes)', () => {
    const asExpenses = [cardBill, atm, topUp].map(t => ({ ...t, status: 'approved' as const, approvedAt: NOW }));
    expect(incomeExpenseTotals([...approved(BASE), ...asExpenses]).expenseMinor).toBe(
      incomeExpenseTotals(approved(BASE)).expenseMinor + 120000 + 200000 + 50000,
    );
  });

  it('balances move between the two accounts (bank down; card owed less; cash and wallet up)', () => {
    const before = balances(BASE);
    const after = balances([...BASE, ...CONFIRMED]);
    expect(after.bank).toBe(before.bank - 120000 - 200000 - 50000);
    expect(after.card).toBe(before.card + 120000); // -300000 owed → -180000 owed
    expect(after.cash).toBe(before.cash + 200000);
    expect(after.paytm).toBe(before.paytm + 50000);
    // Own money only moved: the sum over all four accounts is the same.
    const sum = (b: Record<string, number>) => Object.values(b).reduce((x, y) => x + y, 0);
    expect(sum(after)).toBe(sum(before));
  });

  it('EMI shows under "EMI & Loans"; interest counts as income', () => {
    const emi = tx({ accountId: 'bank', amountMinor: 1250000, categoryId: 'cat-emi' });
    const interest = tx({ type: 'income', accountId: 'bank', amountMinor: 31200, categoryId: 'cat-interest' });
    const rows = [...BASE, emi, interest];
    const spend = spendByCategory(rows, RANGE);
    expect(spend.find(r => r.categoryId === 'cat-emi')).toMatchObject({ spendMinor: 1250000, count: 1 });
    const totals = incomeExpenseTotals(approved(rows));
    const base = incomeExpenseTotals(approved(BASE));
    expect(totals.incomeMinor).toBe(base.incomeMinor + 31200);
    expect(totals.expenseMinor).toBe(base.expenseMinor + 1250000);
    expect(buildPieModel(spend).slices.map(s => s.categoryId)).toContain('cat-emi');
  });
});
