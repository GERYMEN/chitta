import { create } from 'zustand';

/**
 * R8a (D-f): "Not recurring" is SESSION-ONLY — merchant keys hidden for this
 * app run. Nothing is persisted (no DB, no audit, no migration).
 */
interface DismissedRecurringState {
  dismissed: string[];
  dismiss: (merchantKey: string) => void;
  reset: () => void;
}

export const useDismissedRecurringStore = create<DismissedRecurringState>(set => ({
  dismissed: [],
  dismiss: merchantKey =>
    set(state =>
      state.dismissed.includes(merchantKey)
        ? state
        : { dismissed: [...state.dismissed, merchantKey] },
    ),
  reset: () => set({ dismissed: [] }),
}));
