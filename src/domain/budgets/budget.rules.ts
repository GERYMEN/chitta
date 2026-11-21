import { Budget } from './budget.types';
import { Category } from '../categories/category.types';
import { PeriodRange } from '../periods/period.types';
import { periodRange } from '../periods/period.rules';
import { periodTotals, spendByCategory } from '../insights/insights.rules';
import { isArchivedCategory } from '../categories/category.rules';

/**
 * R5c pure budget-vs-actual rules (D-b/D-c). No React, no store, no clock —
 * the screen injects `now` (useNow). Budget "actual" ALWAYS comes from the R4
 * insights selectors (`periodTotals` for the overall budget, `spendByCategory`
 * for a per-category one), so the same R3a/R3b money rules apply: transfers
 * and transfer twins never count, hidden duplicates never count, and a linked
 * refund reduces its category's spend in the refund's own period — one source
 * of truth, never a hand-rolled re-sum of transactions.
 */

/** Progress state from the actual/budget ratio (D-c). */
export type BudgetState = 'under' | 'near' | 'over';

/** At or above this fraction of the budget is "near" (amber). */
export const BUDGET_NEAR_RATIO = 0.8;

/**
 * D-c: under 0.8 = under (green), 0.8..1.0 = near (amber), over 1.0 = over
 * (red). A budget of 0 or less is treated as unset — nothing to warn about, so
 * 'under'.
 */
export function budgetState(actualMinor: number, budgetMinor: number): BudgetState {
  if (budgetMinor <= 0) return 'under';
  const ratio = actualMinor / budgetMinor;
  if (ratio > 1) return 'over';
  if (ratio >= BUDGET_NEAR_RATIO) return 'near';
  return 'under';
}

/** actual / budget, clamped so an unset budget (<= 0) never divides. */
export function budgetRatio(actualMinor: number, budgetMinor: number): number {
  return budgetMinor > 0 ? actualMinor / budgetMinor : 0;
}

/** D-d: a valid budget amount is strictly positive paise. */
export function isValidBudgetAmount(amountMinor: number | null): amountMinor is number {
  return amountMinor != null && Number.isFinite(amountMinor) && amountMinor > 0;
}

export interface BudgetProgress {
  budgetId: string;
  /** null = the overall budget. */
  categoryId: string | null;
  actualMinor: number;
  budgetMinor: number;
  ratio: number;
  state: BudgetState;
  /** max(0, budget - actual): "₹Z left". */
  remainingMinor: number;
  /** max(0, actual - budget): "₹Z over". */
  overMinor: number;
}

function toProgress(budget: Budget, actualMinor: number): BudgetProgress {
  // A net refund can push insights spend below zero; a budget never shows a
  // negative "used", so actual is clamped at zero.
  const actual = Math.max(0, actualMinor);
  return {
    budgetId: budget.id,
    categoryId: budget.categoryId,
    actualMinor: actual,
    budgetMinor: budget.amountMinor,
    ratio: budgetRatio(actual, budget.amountMinor),
    state: budgetState(actual, budget.amountMinor),
    remainingMinor: Math.max(0, budget.amountMinor - actual),
    overMinor: Math.max(0, actual - budget.amountMinor),
  };
}

/**
 * D-b: "monthly" = the CURRENT CALENDAR MONTH. This is exactly the insights 1M
 * range (1st of the current month 00:00 local .. now), so budgets and the Home
 * tiles agree. `now` comes from useNow, so it rolls at the month boundary.
 */
export function currentMonthRange(now: Date): PeriodRange {
  return periodRange('1M', now);
}

export function findOverallBudget(budgets: ReadonlyArray<Budget>): Budget | null {
  return budgets.find(b => b.categoryId === null) ?? null;
}

export function findCategoryBudget(
  budgets: ReadonlyArray<Budget>,
  categoryId: string,
): Budget | null {
  return budgets.find(b => b.categoryId === categoryId) ?? null;
}

/** Category ids that already have a budget (so the chooser can exclude them). */
export function budgetedCategoryIds(budgets: ReadonlyArray<Budget>): Set<string> {
  const ids = new Set<string>();
  for (const b of budgets) if (b.categoryId !== null) ids.add(b.categoryId);
  return ids;
}

/**
 * Overall month progress: actual = periodTotals(...).expenseMinor over the
 * current-month range (D-b). Returns null when there is no overall budget.
 */
export function overallBudgetProgress<
  T extends Parameters<typeof periodTotals>[0][number],
>(
  budgets: ReadonlyArray<Budget>,
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): BudgetProgress | null {
  const overall = findOverallBudget(budgets);
  if (!overall) return null;
  const { expenseMinor } = periodTotals(transactions, range);
  return toProgress(overall, expenseMinor);
}

/**
 * Per-category progress for every category budget, in the budgets' order.
 * actual = spendByCategory spend for the matching categoryId over the range
 * (0 when the category had no spend this month).
 */
export function categoryBudgetProgress<
  T extends Parameters<typeof spendByCategory>[0][number],
>(
  budgets: ReadonlyArray<Budget>,
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): BudgetProgress[] {
  const spend = spendByCategory(transactions, range);
  const byCategory = new Map(spend.map(s => [s.categoryId, s.spendMinor]));
  return budgets
    .filter(b => b.categoryId !== null)
    .map(b => toProgress(b, byCategory.get(b.categoryId as string) ?? 0));
}

/**
 * D-d: category budgets to SHOW in the list — archived (or deleted) categories
 * keep their budget data but are hidden. `categories` is the live set.
 */
export function visibleCategoryBudgets(
  budgets: ReadonlyArray<Budget>,
  categories: ReadonlyArray<Category>,
): Budget[] {
  const byId = new Map(categories.map(c => [c.id, c]));
  return budgets.filter(b => {
    if (b.categoryId === null) return false;
    const category = byId.get(b.categoryId);
    return category != null && !isArchivedCategory(category);
  });
}

export interface BudgetSummary {
  hasOverall: boolean;
  overall: BudgetProgress | null;
  /** Visible category budgets at or over their cap. */
  nearCount: number;
  overCount: number;
}

/**
 * D-e: the Home card summary. Counts only VISIBLE category budgets (archived
 * ones are hidden from the warning counts too). A budget is "near" at amber and
 * "over" at red; overCount and nearCount never double-count a row.
 */
export function budgetSummary<
  T extends Parameters<typeof spendByCategory>[0][number],
>(
  budgets: ReadonlyArray<Budget>,
  categories: ReadonlyArray<Category>,
  transactions: ReadonlyArray<T>,
  range: PeriodRange,
): BudgetSummary {
  const overall = overallBudgetProgress(budgets, transactions, range);
  const visible = visibleCategoryBudgets(budgets, categories);
  const progress = categoryBudgetProgress(visible, transactions, range);
  let nearCount = 0;
  let overCount = 0;
  for (const p of progress) {
    if (p.state === 'over') overCount += 1;
    else if (p.state === 'near') nearCount += 1;
  }
  return { hasOverall: overall !== null, overall, nearCount, overCount };
}

/** D-e: the card is shown only when at least one budget (overall or category) is set. */
export function hasAnyBudget(budgets: ReadonlyArray<Budget>): boolean {
  return budgets.length > 0;
}
