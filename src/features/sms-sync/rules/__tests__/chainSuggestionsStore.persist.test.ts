/**
 * R5i (G3) — the repository-backed chain-suggestions store survives a
 * "restart": add persists open rows, a fresh refresh (cleared memory) brings
 * them back, and accept / dismiss / Undo / completion move the persisted
 * status. SYNTHETIC ids only.
 */
import { getDatabase } from '../../../../data/db/connection';
import { useChainSuggestions } from '../chaining';
import { migrateTo, openTestSqlite, sqliteAvailable, TestSqlite } from '../../../../test/sqliteDb';
import { CURRENT_SCHEMA_VERSION } from '../../../../data/db/restoreUpgrade';
import type { ChainOutcome } from '../chaining';

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn() }));

const describeSql = sqliteAvailable() ? describe : describe.skip;
const T = Date.parse('2026-11-21T10:00:00.000Z');

const outcome = (p: Partial<ChainOutcome> = {}): ChainOutcome => ({
  kind: p.kind ?? 'refund_link',
  childId: p.childId ?? 'child-1',
  parentId: p.parentId ?? 'parent-1',
  hold: true,
  parentOverride: p.parentOverride ?? { link: 'refund' },
});

describeSql('useChainSuggestions (persisted)', () => {
  let t: TestSqlite;
  beforeEach(() => {
    t = openTestSqlite();
    migrateTo(t, CURRENT_SCHEMA_VERSION);
    (getDatabase as jest.Mock).mockReturnValue(t.db);
    useChainSuggestions.getState().clear();
  });
  afterEach(() => t.close());

  it('add persists; a fresh refresh (restart) restores the open suggestions', async () => {
    await useChainSuggestions.getState().add([outcome({ childId: 'a' }), outcome({ childId: 'b', kind: 'incomplete', parentId: null })], T);
    // Simulate a restart: wipe memory, then hydrate from the DB.
    useChainSuggestions.getState().clear();
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
    await useChainSuggestions.getState().refresh();
    expect(useChainSuggestions.getState().suggestions.map(s => s.childId).sort()).toEqual(['a', 'b']);
  });

  it('a newer suggestion for the same child replaces the open one', async () => {
    await useChainSuggestions.getState().add([outcome({ childId: 'a', kind: 'refund_link' })], T);
    await useChainSuggestions.getState().add([outcome({ childId: 'a', kind: 'duplicate' })], T + 1000);
    useChainSuggestions.getState().clear();
    await useChainSuggestions.getState().refresh();
    const open = useChainSuggestions.getState().suggestions;
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe('duplicate');
  });

  it('accept removes it from open and persists accepted (gone after a restart)', async () => {
    await useChainSuggestions.getState().add([outcome({ childId: 'a' })], T);
    await useChainSuggestions.getState().accept('a');
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
    useChainSuggestions.getState().clear();
    await useChainSuggestions.getState().refresh();
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
  });

  it('dismiss then Undo (reopen) brings the open suggestion back and persists it', async () => {
    await useChainSuggestions.getState().add([outcome({ childId: 'a' })], T);
    const removed = await useChainSuggestions.getState().dismiss('a');
    expect(removed).not.toBeNull();
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
    await useChainSuggestions.getState().reopen(removed!);
    useChainSuggestions.getState().clear();
    await useChainSuggestions.getState().refresh();
    expect(useChainSuggestions.getState().suggestions.map(s => s.childId)).toEqual(['a']);
  });

  it('remove (completion) supersedes the parent suggestion', async () => {
    await useChainSuggestions.getState().add([outcome({ childId: 'a', kind: 'incomplete', parentId: null })], T);
    await useChainSuggestions.getState().remove('a');
    useChainSuggestions.getState().clear();
    await useChainSuggestions.getState().refresh();
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
  });
});
