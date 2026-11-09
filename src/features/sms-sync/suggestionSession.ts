import { create } from 'zustand';
import { SuggestionGroup } from './suggestionGroups';

/**
 * R2b in-memory session cache of the last Sync SMS run's "New Accounts Found"
 * groups (suggestion + its waiting candidates). Module-level only: never in
 * nav params (they carry just `runId`), never in SQLite, never logged. A new
 * sync MERGES into it (R5-fix C3); Add / Link / Ignore remove the decided group. Lost on app
 * restart by design — the next sync rebuilds it (dedup by
 * sourceReferenceHash is unchanged).
 */
interface SuggestionSessionState {
  runId: string | null;
  groups: SuggestionGroup[];
  /** Replace the session with a new sync run's groups; returns the run id. */
  start: (groups: SuggestionGroup[]) => string;
  /**
   * R5-fix C3: merge a sync run's groups into the CURRENT session (same run
   * id, so an open "New accounts found" screen keeps working). Groups the
   * user has not acted on are never dropped; items already recorded
   * (`recordedHashes`) are pruned. Starts a session when none exists.
   */
  merge: (groups: SuggestionGroup[], recordedHashes?: ReadonlySet<string>) => string;
  /** Drop one decided group (no-op for a stale run id). */
  remove: (runId: string, key: string) => void;
  /** R5: put a group back (Undo of a link) — no-op for a stale run id. */
  restore: (runId: string, group: SuggestionGroup) => void;
  clear: () => void;
}

let runCounter = 0;

function pruneGroup(group: SuggestionGroup, recorded: ReadonlySet<string>): SuggestionGroup {
  const items = group.items
    .filter(item => !recorded.has(item.sourceReferenceHash))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return { ...group, items, suggestion: { ...group.suggestion, messageCount: items.length } };
}

function nonEmpty(group: SuggestionGroup): boolean {
  return group.items.length > 0;
}

export const useSuggestionSession = create<SuggestionSessionState>((set, get) => ({
  runId: null,
  groups: [],
  start: groups => {
    runCounter += 1;
    const runId = `run-${Date.now()}-${runCounter}`;
    set({ runId, groups });
    return runId;
  },
  merge: (incoming, recordedHashes = new Set<string>()) => {
    const state = get();
    if (state.runId == null) return get().start(incoming.map(g => pruneGroup(g, recordedHashes)).filter(nonEmpty));
    const merged = state.groups.map(group => ({ ...group, items: [...group.items] }));
    for (const group of incoming) {
      const existing = merged.find(g => g.key === group.key);
      if (!existing) {
        merged.push({ ...group, items: [...group.items] });
        continue;
      }
      const hashes = new Set(existing.items.map(item => item.sourceReferenceHash));
      for (const item of group.items) {
        if (!hashes.has(item.sourceReferenceHash)) existing.items.push(item);
      }
    }
    const groups = merged.map(group => pruneGroup(group, recordedHashes)).filter(nonEmpty);
    set({ groups });
    return state.runId;
  },
  remove: (runId, key) => {
    if (get().runId !== runId) return;
    set(state => ({ groups: state.groups.filter(group => group.key !== key) }));
  },
  restore: (runId, group) => {
    if (get().runId !== runId) return;
    if (get().groups.some(g => g.key === group.key)) return;
    set(state => ({ groups: [...state.groups, group] }));
  },
  clear: () => set({ runId: null, groups: [] }),
}));

/** The group for `key` in run `runId`, or null when the run is stale/gone. */
export function getSuggestionGroup(runId: string, key: string): SuggestionGroup | null {
  const state = useSuggestionSession.getState();
  if (state.runId !== runId) return null;
  return state.groups.find(group => group.key === key) ?? null;
}
