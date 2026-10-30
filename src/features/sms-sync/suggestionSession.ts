import { create } from 'zustand';
import { SuggestionGroup } from './suggestionGroups';

/**
 * R2b in-memory session cache of the last Sync SMS run's "New Accounts Found"
 * groups (suggestion + its waiting candidates). Module-level only: never in
 * nav params (they carry just `runId`), never in SQLite, never logged. A new
 * sync replaces it; Add / Link / Ignore remove the decided group. Lost on app
 * restart by design — the next sync rebuilds it (dedup by
 * sourceReferenceHash is unchanged).
 */
interface SuggestionSessionState {
  runId: string | null;
  groups: SuggestionGroup[];
  /** Replace the session with a new sync run's groups; returns the run id. */
  start: (groups: SuggestionGroup[]) => string;
  /** Drop one decided group (no-op for a stale run id). */
  remove: (runId: string, key: string) => void;
  clear: () => void;
}

let runCounter = 0;

export const useSuggestionSession = create<SuggestionSessionState>((set, get) => ({
  runId: null,
  groups: [],
  start: groups => {
    runCounter += 1;
    const runId = `run-${Date.now()}-${runCounter}`;
    set({ runId, groups });
    return runId;
  },
  remove: (runId, key) => {
    if (get().runId !== runId) return;
    set(state => ({ groups: state.groups.filter(group => group.key !== key) }));
  },
  clear: () => set({ runId: null, groups: [] }),
}));

/** The group for `key` in run `runId`, or null when the run is stale/gone. */
export function getSuggestionGroup(runId: string, key: string): SuggestionGroup | null {
  const state = useSuggestionSession.getState();
  if (state.runId !== runId) return null;
  return state.groups.find(group => group.key === key) ?? null;
}
