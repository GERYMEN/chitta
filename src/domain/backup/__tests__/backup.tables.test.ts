/**
 * R4e: the backup table catalogue must match the REAL schema — every table
 * (except schema_migrations) and every column, with the migration that added
 * it. Fails when a future migration adds a table/column that is not listed.
 */
import { BACKUP_TABLES, columnsAt } from '../backup.tables';
import { CURRENT_SCHEMA_VERSION } from '../../../data/db/restoreUpgrade';
import { migrateTo, openTestSqlite, sqliteAvailable } from '../../../test/sqliteDb';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn() }));

const describeSql = sqliteAvailable() ? describe : describe.skip;

function schemaAt(version: number): Record<string, string[]> {
  const t = openTestSqlite();
  try {
    migrateTo(t, version);
    const tables = t.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => String(r.name))
      .filter(name => name !== 'schema_migrations');
    return Object.fromEntries(
      tables.map(name => [
        name,
        t.raw.prepare(`PRAGMA table_info(${name})`).all().map(c => String(c.name)).sort(),
      ]),
    );
  } finally {
    t.close();
  }
}

describeSql('backup table catalogue', () => {
  it.each(Array.from({ length: CURRENT_SCHEMA_VERSION + 1 }, (_, i) => i))(
    'matches the real schema at version %i (tables + columns)',
    version => {
      const real = schemaAt(version);
      const listed = Object.fromEntries(
        BACKUP_TABLES.filter(spec => spec.sinceVersion <= version).map(spec => [
          spec.name,
          columnsAt(spec, version).sort(),
        ]),
      );
      expect(listed).toEqual(real);
    },
  );

  it('lists parents before children (categories/accounts → transactions → audit_events)', () => {
    const names = BACKUP_TABLES.map(t => t.name);
    expect(names.indexOf('categories')).toBeLessThan(names.indexOf('transactions'));
    expect(names.indexOf('accounts')).toBeLessThan(names.indexOf('transactions'));
    expect(names.indexOf('transactions')).toBeLessThan(names.indexOf('audit_events'));
    expect(names).not.toContain('schema_migrations');
  });
});
