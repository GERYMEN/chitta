/**
 * R5c — Budgets. A budget is a monthly spending cap: one OVERALL budget
 * (categoryId === null) plus any number of per-category budgets. Budgets are a
 * READ-ONLY overlay on spend (D-f): they never touch balances or transactions.
 * Money stays integer paise.
 *
 * Privacy: a budget row holds ids, an enum period and an amount only — never
 * SMS text, a sender number or a merchant/payee string.
 */
export type BudgetPeriod = 'monthly';

export const BUDGET_PERIODS: ReadonlyArray<BudgetPeriod> = ['monthly'];

export interface Budget {
  id: string;
  /** null = the single overall budget; otherwise the category it caps. */
  categoryId: string | null;
  amountMinor: number;
  /** Only 'monthly' is used now; the column keeps the door open (D-a). */
  period: BudgetPeriod;
  createdAt: string;
  updatedAt: string;
}

/** Set-or-replace a budget by its key (null = overall, else a category id). */
export interface SetBudgetInput {
  categoryId: string | null;
  amountMinor: number;
}
