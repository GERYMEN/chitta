import {
  affectsBalance,
  canFastApprove,
  canTransition,
  confidenceTier,
  countsTowardIncomeExpense,
  incomeExpenseTotals,
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
