import { Transaction } from '../../transactions/transaction.types';
import { Category } from '../../categories/category.types';
import { periodRange } from '../../periods/period.rules';
import { Budget } from '../budget.types';
import {
  BUDGET_NEAR_RATIO,
  budgetState,
  budgetRatio,
  isValidBudgetAmount,
  currentMonthRange,
  findOverallBudget,
  findCategoryBudget,
  budgetedCategoryIds,
  overallBudgetProgress,
  categoryBudgetProgress,
  visibleCategoryBudgets,
  budgetSummary,
  hasAnyBudget,
} from '../budget.rules';

// Local wall-clock → ISO, so every test holds in any timezone.
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const at = (y: number, m: number, d: number, h = 12) => local(y, m, d, h).toISOString();

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 10000,
    currency: 'INR',
    merchantName: `QA-Merchant-${id}`,
    categoryId: 'cat-food',
    accountId: 'acc-qa',
    paymentMethod: 'upi',
    occurredAt: at(2026, 10, 10),
    detectedAt: at(2026, 10, 10),
    approvedAt: at(2026, 10, 10),
    note: null,
    sourceType: 'manual',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: null,
    parserVersion: null,
    bulkBatchId: null,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: at(2026, 10, 10),
    updatedAt: at(2026, 10, 10),
    ...patch,
  };
}

function budget(categoryId: string | null, amountMinor: number): Budget {
  return {
    id: categoryId === null ? 'budget-overall' : `budget-${categoryId}`,
    categoryId,
    amountMinor,
    period: 'monthly',
    createdAt: at(2026, 10, 1),
    updatedAt: at(2026, 10, 1),
  };
}

function category(id: string, patch: Partial<Category> = {}): Category {
  return {
    id,
    name: id,
    parentId: null,
    type: 'expense',
    icon: 'cash',
    isSystem: false,
    archivedAt: null,
    color: null,
    ...patch,
  };
}

const NOW = local(2026, 10, 20, 15, 0);
const MONTH = periodRange('1M', NOW); // 1 Oct 00:00 → now

describe('budgetState thresholds (D-c)', () => {
  it('is under below 0.8 of the budget', () => {
    expect(budgetState(0, 10000)).toBe('under');
    expect(budgetState(7999, 10000)).toBe('under');
  });

  it('is near from 0.8 up to and including 1.0', () => {
    expect(budgetState(8000, 10000)).toBe('near'); // exactly 0.8
    expect(budgetState(9999, 10000)).toBe('near');
    expect(budgetState(10000, 10000)).toBe('near'); // exactly at the cap
  });

  it('is over above 1.0', () => {
    expect(budgetState(10001, 10000)).toBe('over');
    expect(budgetState(50000, 10000)).toBe('over');
  });

  it('treats a budget of 0 or less as unset (under)', () => {
    expect(budgetState(5000, 0)).toBe('under');
    expect(budgetState(5000, -1)).toBe('under');
  });

  it('exposes the near ratio and a safe ratio helper', () => {
    expect(BUDGET_NEAR_RATIO).toBe(0.8);
    expect(budgetRatio(5000, 10000)).toBe(0.5);
    expect(budgetRatio(5000, 0)).toBe(0);
  });
});

describe('isValidBudgetAmount (D-d)', () => {
  it('requires a strictly positive amount', () => {
    expect(isValidBudgetAmount(1)).toBe(true);
    expect(isValidBudgetAmount(0)).toBe(false);
    expect(isValidBudgetAmount(-100)).toBe(false);
    expect(isValidBudgetAmount(null)).toBe(false);
    expect(isValidBudgetAmount(NaN)).toBe(false);
  });
});

describe('currentMonthRange (D-b)', () => {
  it('is the insights 1M range: 1st of this month 00:00 local → now', () => {
    const range = currentMonthRange(NOW);
    expect(range.from.getTime()).toBe(local(2026, 10, 1, 0, 0).getTime());
    expect(range.to).toBe(NOW);
  });
});

describe('lookup helpers', () => {
  const budgets = [budget(null, 100000), budget('cat-food', 20000), budget('cat-shopping', 30000)];
  it('finds the overall budget and per-category budgets', () => {
    expect(findOverallBudget(budgets)?.id).toBe('budget-overall');
    expect(findCategoryBudget(budgets, 'cat-food')?.amountMinor).toBe(20000);
    expect(findCategoryBudget(budgets, 'cat-missing')).toBeNull();
  });
  it('lists budgeted category ids (never the overall)', () => {
    expect(budgetedCategoryIds(budgets)).toEqual(new Set(['cat-food', 'cat-shopping']));
  });
  it('reports whether any budget is set', () => {
    expect(hasAnyBudget(budgets)).toBe(true);
    expect(hasAnyBudget([])).toBe(false);
  });
});

describe('overall budget actual comes from periodTotals (D-b)', () => {
  const rows: Transaction[] = [
    tx('e1', { amountMinor: 50000, categoryId: 'cat-food', occurredAt: at(2026, 10, 5) }),
    tx('e2', { amountMinor: 30000, categoryId: 'cat-shopping', occurredAt: at(2026, 10, 8) }),
    // Transfer + its twin — NEVER count toward spend.
    tx('t1', {
      type: 'transfer',
      amountMinor: 70000,
      categoryId: 'cat-transfer',
      transferAccountId: 'acc-2',
      occurredAt: at(2026, 10, 9),
    }),
    tx('tw1', {
      type: 'income',
      status: 'rejected',
      amountMinor: 70000,
      linkKind: 'transfer_twin',
      linkedTransactionId: 't1',
      occurredAt: at(2026, 10, 9),
    }),
    // Pending — never counts.
    tx('p1', { status: 'pending', amountMinor: 99900, occurredAt: at(2026, 10, 10) }),
    // A linked refund of e1 reduces spend (not income).
    tx('r1', {
      type: 'income',
      amountMinor: 10000,
      categoryId: 'cat-food',
      linkKind: 'refund',
      linkedTransactionId: 'e1',
      occurredAt: at(2026, 10, 14),
    }),
  ];

  it('actual excludes transfers and pending, and the refund reduces it', () => {
    // 50000 + 30000 − 10000 refund = 70000; the 70000 transfer never counts.
    const progress = overallBudgetProgress([budget(null, 100000)], rows, MONTH);
    expect(progress).not.toBeNull();
    expect(progress?.actualMinor).toBe(70000);
    expect(progress?.budgetMinor).toBe(100000);
    expect(progress?.state).toBe('under');
    expect(progress?.remainingMinor).toBe(30000);
    expect(progress?.overMinor).toBe(0);
  });

  it('is null when there is no overall budget', () => {
    expect(overallBudgetProgress([budget('cat-food', 10000)], rows, MONTH)).toBeNull();
  });

  it('flags over budget and reports the overshoot', () => {
    const progress = overallBudgetProgress([budget(null, 60000)], rows, MONTH);
    expect(progress?.state).toBe('over');
    expect(progress?.overMinor).toBe(10000); // 70000 − 60000
    expect(progress?.remainingMinor).toBe(0);
  });
});

describe('category budget actual comes from spendByCategory (D-b)', () => {
  const rows: Transaction[] = [
    tx('e1', { amountMinor: 50000, categoryId: 'cat-food', occurredAt: at(2026, 10, 5) }),
    tx('e2', { amountMinor: 30000, categoryId: 'cat-shopping', occurredAt: at(2026, 10, 8) }),
    // Linked refund of e1 reduces FOOD spend in the refund's own month.
    tx('r1', {
      type: 'income',
      amountMinor: 20000,
      categoryId: 'cat-food',
      linkKind: 'refund',
      linkedTransactionId: 'e1',
      occurredAt: at(2026, 10, 15),
    }),
  ];

  it('matches each budget to its category spend (refund-reduced)', () => {
    const budgets = [budget('cat-food', 40000), budget('cat-shopping', 20000)];
    const progress = categoryBudgetProgress(budgets, rows, MONTH);
    const food = progress.find(p => p.categoryId === 'cat-food');
    const shopping = progress.find(p => p.categoryId === 'cat-shopping');
    // Food: 50000 − 20000 refund = 30000 of 40000 → under (0.75).
    expect(food?.actualMinor).toBe(30000);
    expect(food?.state).toBe('under');
    // Shopping: 30000 of 20000 → over.
    expect(shopping?.actualMinor).toBe(30000);
    expect(shopping?.state).toBe('over');
    expect(shopping?.overMinor).toBe(10000);
  });

  it('reports 0 actual for a budgeted category with no spend this month', () => {
    const progress = categoryBudgetProgress([budget('cat-fuel', 10000)], rows, MONTH);
    expect(progress[0].actualMinor).toBe(0);
    expect(progress[0].state).toBe('under');
  });

  it('clamps a net-refund category to 0 actual (never negative)', () => {
    const refundHeavy: Transaction[] = [
      tx('e1', { amountMinor: 10000, categoryId: 'cat-food', occurredAt: at(2026, 10, 5) }),
      tx('r1', {
        type: 'income',
        amountMinor: 30000,
        categoryId: 'cat-food',
        linkKind: 'refund',
        linkedTransactionId: 'e1',
        occurredAt: at(2026, 10, 15),
      }),
    ];
    const progress = categoryBudgetProgress([budget('cat-food', 10000)], refundHeavy, MONTH);
    expect(progress[0].actualMinor).toBe(0);
  });
});

describe('visibleCategoryBudgets + budgetSummary (D-d/D-e)', () => {
  const categories = [
    category('cat-food'),
    category('cat-shopping'),
    category('cat-old', { archivedAt: at(2026, 9, 1) }),
  ];
  const budgets = [
    budget(null, 100000),
    budget('cat-food', 20000),
    budget('cat-shopping', 30000),
    budget('cat-old', 5000),
    budget('cat-deleted', 5000),
  ];
  const rows: Transaction[] = [
    tx('e1', { amountMinor: 25000, categoryId: 'cat-food', occurredAt: at(2026, 10, 5) }),
    tx('e2', { amountMinor: 27000, categoryId: 'cat-shopping', occurredAt: at(2026, 10, 8) }),
  ];

  it('hides archived and deleted categories from the visible list', () => {
    const visible = visibleCategoryBudgets(budgets, categories);
    expect(visible.map(b => b.categoryId)).toEqual(['cat-food', 'cat-shopping']);
  });

  it('summarises near/over counts over visible budgets only', () => {
    const summary = budgetSummary(budgets, categories, rows, MONTH);
    expect(summary.hasOverall).toBe(true);
    // Food 25000/20000 → over; Shopping 27000/30000 = 0.9 → near.
    expect(summary.overCount).toBe(1);
    expect(summary.nearCount).toBe(1);
    expect(summary.overall?.actualMinor).toBe(52000);
  });
});
