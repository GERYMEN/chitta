import { create } from 'zustand';
import {
  SuggestionCandidateRow,
  suggestionCandidatesRepository,
} from '../../data/repositories/suggestionCandidates.repository';

/**
 * R5-fix C2: the persisted "New accounts found" summary for Home (counts and
 * public bank ids only). Refreshed after every sync and every decision.
 */
interface NewAccountsState {
  rows: SuggestionCandidateRow[];
  refresh: () => Promise<void>;
}

export const useNewAccountsStore = create<NewAccountsState>(set => ({
  rows: [],
  refresh: async () => {
    const rows = await suggestionCandidatesRepository.list().catch(() => []);
    set({ rows });
  },
}));

/** Window to re-read for the stored keys: earliest first-seen → now. */
export function newAccountsWindow(
  rows: ReadonlyArray<Pick<SuggestionCandidateRow, 'firstSeenAt'>>,
  nowMs: number,
): { sinceMs: number; beforeMs: number } | null {
  if (rows.length === 0) return null;
  return { sinceMs: Math.min(...rows.map(r => r.firstSeenAt)), beforeMs: nowMs + 1 };
}

/** "1 new account found" / "3 new accounts found". */
export function newAccountsLabel(count: number): string {
  return `${count} new account${count === 1 ? '' : 's'} found`;
}
