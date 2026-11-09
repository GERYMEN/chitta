/**
 * R5: sms_unparsed on a REAL SQLite schema (migration 8) — insert-or-ignore,
 * dismiss, resolve, open list; and the backup leaves the table alone.
 */
import { getDatabase } from '../../db/connection';
import { smsUnparsedRepository } from '../smsUnparsed.repository';
import { backupRepository } from '../backup.repository';
import { migrateTo, openTestSqlite, sqliteAvailable, TestSqlite } from '../../../test/sqliteDb';
import { CURRENT_SCHEMA_VERSION } from '../../db/restoreUpgrade';

jest.mock('../../db/connection', () => ({ getDatabase: jest.fn() }));

const describeSql = sqliteAvailable() ? describe : describe.skip;
const NOW = new Date('2026-11-06T10:00:00.000Z');

describeSql('smsUnparsedRepository (real SQLite)', () => {
  let t: TestSqlite;
  beforeEach(() => {
    t = openTestSqlite();
    migrateTo(t, CURRENT_SCHEMA_VERSION);
    (getDatabase as jest.Mock).mockReturnValue(t.db);
  });
  afterEach(() => t.close());

  const row = (smsId: string, smsDate: number) => ({
    smsId,
    smsDate,
    reasonCode: 'no_amount' as const,
    institution: 'federal',
    parserVersion: 2,
  });

  it('records, lists open newest first, ignores repeats', async () => {
    await smsUnparsedRepository.recordMany([row('1', 100), row('2', 200)], NOW);
    await smsUnparsedRepository.recordMany([row('1', 100)], NOW);
    const open = await smsUnparsedRepository.listOpen();
    expect(open.map(r => r.smsId)).toEqual(['2', '1']);
    expect(open[0]).toMatchObject({ reasonCode: 'no_amount', institution: 'federal', parserVersion: 2 });
    expect(t.rows('sms_unparsed')).toHaveLength(2);
  });

  it('dismissed / resolved rows leave the open list and stay dismissed on a later sync', async () => {
    await smsUnparsedRepository.recordMany([row('1', 100), row('2', 200), row('3', 300)], NOW);
    await smsUnparsedRepository.dismiss('1', 100, NOW);
    await smsUnparsedRepository.resolveMany([{ smsId: '2', smsDate: 200 }], NOW);
    await smsUnparsedRepository.recordMany([row('1', 100), row('2', 200)], NOW);
    expect((await smsUnparsedRepository.listOpen()).map(r => r.smsId)).toEqual(['3']);
    expect(await smsUnparsedRepository.openKeys()).toEqual(new Set(['3:300']));
  });

  it('a backup carries no sms_unparsed table', async () => {
    await smsUnparsedRepository.recordMany([row('1', 100)], NOW);
    const tables = await backupRepository.readAllTables();
    expect(Object.keys(tables)).not.toContain('sms_unparsed');
  });
});
