/**
 * R5i (G3) — chain_suggestions on a REAL SQLite schema (migration 12).
 * Persists open rows (one per child), replaces an open row with a newer
 * suggestion, moves status (accepted / dismissed / superseded) keeping the
 * row, and writes ids/enums-only audit rows. The parent_override column holds
 * only the RuleChainOverride enum/boolean fields — never free text.
 * SYNTHETIC ids only.
 */
import { getDatabase } from '../../db/connection';
import { chainSuggestionRepository } from '../chainSuggestion.repository';
import { migrateTo, openTestSqlite, sqliteAvailable, TestSqlite } from '../../../test/sqliteDb';
import { CURRENT_SCHEMA_VERSION } from '../../db/restoreUpgrade';
import { ChainSuggestionRecord } from '../../../domain/chains/chainSuggestion.types';

jest.mock('../../db/connection', () => ({ getDatabase: jest.fn() }));

const describeSql = sqliteAvailable() ? describe : describe.skip;
const ISO = '2026-11-21T10:00:00.000Z';

function record(p: Partial<ChainSuggestionRecord> = {}): ChainSuggestionRecord {
  return {
    id: p.id ?? 'chain-1',
    kind: p.kind ?? 'refund_link',
    childId: p.childId ?? 'child-1',
    parentId: p.parentId ?? 'parent-1',
    parentOverride: p.parentOverride ?? { link: 'refund' },
    status: 'open',
    createdAt: p.createdAt ?? ISO,
    updatedAt: p.updatedAt ?? ISO,
  };
}

describeSql('chainSuggestionRepository (real SQLite)', () => {
  let t: TestSqlite;
  beforeEach(() => {
    t = openTestSqlite();
    migrateTo(t, CURRENT_SCHEMA_VERSION);
    (getDatabase as jest.Mock).mockReturnValue(t.db);
  });
  afterEach(() => t.close());

  const audits = () => t.rows('audit_events').map(r => String(r.event_type));

  it('persists open suggestions and lists them; writes a chain_suggested audit', async () => {
    await chainSuggestionRepository.replaceOpen([
      record({ id: 'c1', childId: 'a', parentId: 'p', kind: 'refund_link' }),
      record({ id: 'c2', childId: 'b', parentId: null, kind: 'incomplete', parentOverride: { incomplete: true } }),
    ]);
    const open = await chainSuggestionRepository.listOpen();
    expect(open.map(r => r.childId).sort()).toEqual(['a', 'b']);
    expect(audits().filter(e => e === 'chain_suggested')).toHaveLength(2);
  });

  it('one open row per child — a newer suggestion REPLACES the open one', async () => {
    await chainSuggestionRepository.replaceOpen([record({ id: 'c1', childId: 'a', kind: 'refund_link' })]);
    await chainSuggestionRepository.replaceOpen([record({ id: 'c2', childId: 'a', kind: 'duplicate' })]);
    const open = await chainSuggestionRepository.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: 'c2', kind: 'duplicate' });
  });

  it('accept moves status + writes a chain_accepted audit; the row leaves the open list', async () => {
    await chainSuggestionRepository.replaceOpen([record({ id: 'c1', childId: 'a' })]);
    const updated = await chainSuggestionRepository.setStatusByChild('a', 'accepted', ISO);
    expect(updated).toMatchObject({ status: 'accepted' });
    expect(await chainSuggestionRepository.listOpen()).toHaveLength(0);
    expect(audits()).toContain('chain_accepted');
    // The row is kept (history), not deleted.
    expect(await chainSuggestionRepository.listAll()).toHaveLength(1);
  });

  it('dismiss writes a chain_dismissed audit; Undo (setStatusById open) returns it to the open list', async () => {
    await chainSuggestionRepository.replaceOpen([record({ id: 'c1', childId: 'a' })]);
    await chainSuggestionRepository.setStatusByChild('a', 'dismissed', ISO);
    expect(audits()).toContain('chain_dismissed');
    await chainSuggestionRepository.setStatusById('c1', 'open', ISO);
    expect((await chainSuggestionRepository.listOpen()).map(r => r.id)).toEqual(['c1']);
  });

  it('superseded (completion) keeps the row but drops it from open, with no accept/dismiss audit', async () => {
    await chainSuggestionRepository.replaceOpen([record({ id: 'c1', childId: 'a' })]);
    await chainSuggestionRepository.setStatusByChild('a', 'superseded', ISO);
    expect(await chainSuggestionRepository.listOpen()).toHaveLength(0);
    expect(audits().filter(e => e === 'chain_accepted' || e === 'chain_dismissed')).toHaveLength(0);
  });

  it('parent_override persists ONLY the enum/boolean fields (privacy)', async () => {
    const dirty = { link: 'refund', deleted: true, body: 'QA SMS BODY', sender: '+910000000000' } as never;
    await chainSuggestionRepository.replaceOpen([record({ id: 'c1', childId: 'a', parentOverride: dirty })]);
    const stored = String(t.rows('chain_suggestions')[0].parent_override);
    expect(stored).not.toMatch(/QA SMS BODY|0000000000|body|sender/);
    const open = await chainSuggestionRepository.listOpen();
    expect(open[0].parentOverride).toEqual({ deleted: true, link: 'refund' });
  });
});
