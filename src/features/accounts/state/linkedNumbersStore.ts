import { create } from 'zustand';
import {
  accountRepository,
  SuggestionDecisionRow,
} from '../../../data/repositories/account.repository';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { ACCOUNT_KEY_NORMALIZER_VERSION } from '../../sms-sync/normalizeAccountKey';
import { LinkedNumber, linkedNumbersFor } from '../../sms-sync/suggestionGroups';

/**
 * R5d T3c: the card / account numbers routed to each account by a 'linked'
 * suggestion decision (R2b / R5 "Link to existing", R5d debit-card link).
 * Public bank id, kind and last-4 only — no SMS content. Decisions are the
 * alias table: no separate alias storage.
 */
interface LinkedNumbersState {
  rows: SuggestionDecisionRow[];
  refresh: () => Promise<void>;
  forAccount: (accountId: string) => LinkedNumber[];
  /**
   * Unlink one number: the existing undoLink path (removes the 'linked'
   * decision if it still points at this account, writes one
   * 'account_unlinked' audit) with NO rows removed — items already recorded
   * stay on the account; new SMS for the number show up in "New accounts
   * found" again.
   */
  unlink: (accountId: string, number: LinkedNumber) => Promise<void>;
}

export const useLinkedNumbersStore = create<LinkedNumbersState>((set, get) => ({
  rows: [],
  refresh: async () => {
    const rows = await accountRepository.listSuggestionDecisions().catch(() => []);
    set({ rows });
  },
  forAccount: accountId => linkedNumbersFor(get().rows, accountId),
  unlink: async (accountId, number) => {
    await useTransactionsStore.getState().undoLinkSuggestion({
      decisionKey: {
        bankCanonical: number.bankCanonical,
        accountKind: number.accountKind,
        lastFour: number.lastFour,
        normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
      },
      accountId,
      pending: [],
    });
    await get().refresh();
  },
}));
