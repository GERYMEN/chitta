import {
  affectsBalance,
  canFastApprove,
  canTransition,
  confidenceTier,
  countsTowardIncomeExpense,
  incomeContributionMinor,
  incomeExpenseTotals,
  spendContributionMinor,
} from '../transaction.rules';

describe('confidenceTier', () => {
  it('is high at and above 90', () => {
    expect(confidenceTier(98)).toBe('high');
    expect(confidenceTier(90)).toBe('high');
  });

  it('needs review between 70 and 89', () => {
    expect(confidenceTier(89)).toBe('needsReview');
    expect(confidenceTier(70)).toBe('needsReview');
  });

  it('is uncertain below 70 or when absent', () => {
    expect(confidenceTier(61)).toBe('uncertain');
    expect(confidenceTier(null)).toBe('uncertain');
  });
});

describe('canFastApprove', () => {
  it('only fast-approves high-confidence detections', () => {
    expect(canFastApprove(95)).toBe(true);
    expect(canFastApprove(85)).toBe(false);
    expect(canFastApprove(null)).toBe(false);
  });
});

describe('affectsBalance', () => {
  it('only approved transactions affect the balance', () => {
    expect(affectsBalance({ status: 'approved' })).toBe(true);
    expect(affectsBalance({ status: 'pending' })).toBe(false);
    expect(affectsBalance({ status: 'rejected' })).toBe(false);
    expect(affectsBalance({ status: 'invalid' })).toBe(false);
  });
});

describe('canTransition', () => {
  it('allows pending to move to approved or rejected', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
  });

  it('never allows a transition out of a terminal state', () => {
    expect(canTransition('approved', 'pending')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
  });
});

describe('R3a countsTowardIncomeExpense / incomeExpenseTotals', () => {
  it('income and expense count; transfers and transfer twins never do', () => {
    expect(countsTowardIncomeExpense({ type: 'income' })).toBe(true);
    expect(countsTowardIncomeExpense({ type: 'expense', linkKind: null })).toBe(true);
    expect(countsTowardIncomeExpense({ type: 'transfer' })).toBe(false);
    expect(countsTowardIncomeExpense({ type: 'income', linkKind: 'transfer_twin' })).toBe(false);
  });

  it('totals skip transfers and twins', () => {
    expect(
      incomeExpenseTotals([
        { type: 'income', amountMinor: 100000 },
        { type: 'expense', amountMinor: 25000 },
        { type: 'transfer', amountMinor: 50000 },
        { type: 'income', amountMinor: 50000, linkKind: 'transfer_twin' },
      ]),
    ).toEqual({ incomeMinor: 100000, expenseMinor: 25000, netMinor: 75000 });
    expect(incomeExpenseTotals([])).toEqual({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
  });
});

describe('R4 incomeContributionMinor (per-row form of incomeExpenseTotals)', () => {
  const row = (patch: Record<string, unknown>) => ({ type: 'income' as const, amountMinor: 5000, ...patch });

  it('plain income counts; refunds, transfers, twins, duplicates and expenses do not', () => {
    expect(incomeContributionMinor(row({}))).toBe(5000);
    expect(incomeContributionMinor(row({ linkKind: 'refund', linkedTransactionId: 'e1' }))).toBe(0);
    expect(incomeContributionMinor(row({ linkKind: 'transfer_twin' }))).toBe(0);
    expect(incomeContributionMinor(row({ linkKind: 'duplicate' }))).toBe(0);
    expect(incomeContributionMinor(row({ type: 'transfer' }))).toBe(0);
    expect(incomeContributionMinor(row({ type: 'expense' }))).toBe(0);
  });

  it('summing both per-row helpers gives incomeExpenseTotals', () => {
    const rows = [
      row({}),
      row({ type: 'expense', amountMinor: 2000 }),
      row({ amountMinor: 700, linkKind: 'refund', linkedTransactionId: 'e1' }),
      row({ type: 'transfer', amountMinor: 9999 }),
      row({ amountMinor: 1234, linkKind: 'duplicate' }),
    ];
    const income = rows.reduce((s, t) => s + incomeContributionMinor(t), 0);
    const spend = rows.reduce((s, t) => s + spendContributionMinor(t), 0);
    expect(incomeExpenseTotals(rows)).toEqual({ incomeMinor: income, expenseMinor: spend, netMinor: income - spend });
    expect(income).toBe(5000);
    expect(spend).toBe(1300);
  });
});
