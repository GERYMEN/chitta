import { create } from 'zustand';
import { budgetRepository } from '../../../data/repositories/budget.repository';
import { Budget, SetBudgetInput } from '../../../domain/budgets/budget.types';

/**
 * R5c: a light store over `budgetRepository` (the pattern of billsStore /
 * chainSuggestions). Screens call `refresh()` on focus; every write persists
 * through the repository (budgets table + its audit row in one db.transaction)
 * and then reloads. Budgets never touch balances, so nothing else reloads.
 */
interface BudgetsState {
  budgets: Budget[];
  refresh: () => Promise<void>;
  setBudget: (input: SetBudgetInput) => Promise<Budget>;
  /** Remove a budget; returns it so a 5 s Undo can re-set it exactly. */
  removeBudget: (budget: Budget) => Promise<Budget>;
}

export const useBudgetsStore = create<BudgetsState>((set, get) => ({
  budgets: [],
  refresh: async () => {
    const budgets = await budgetRepository.listAll().catch(() => [] as Budget[]);
    set({ budgets });
  },
  setBudget: async input => {
    const budget = await budgetRepository.setBudget(input);
    await get().refresh();
    return budget;
  },
  removeBudget: async budget => {
    await budgetRepository.removeBudget(budget);
    await get().refresh();
    return budget;
  },
}));
