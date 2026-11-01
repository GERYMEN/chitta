import { MigrationStatement, NUMBERED_MIGRATIONS } from './migrations';

/** The schema version this app's database is at after runMigrations(). */
export const CURRENT_SCHEMA_VERSION: number = NUMBERED_MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

const SCHEMA_CHANGE = /^\s*(ALTER|CREATE|DROP)\b/i;

function sqlOf(statement: MigrationStatement): string {
  return typeof statement === 'string' ? statement : statement.sql;
}

/**
 * R4e restore of a backup made at an OLDER schema version ("mapping"
 * approach). The live database is already at CURRENT_SCHEMA_VERSION, so the
 * schema half of each newer migration (ALTER / CREATE / DROP) already
 * happened; only its DATA half has to be replayed on the restored rows:
 * e.g. migration 3's confidence rescale, migration 5's Uncategorised seed,
 * migration 6's Transfer seed. Columns a migration added and the old backup
 * lacks are simply NULL / their default, exactly as after ALTER TABLE ADD
 * COLUMN. A test (restore.test.ts) checks, for every older version, that
 * "restore old rows + replay" equals "old DB + run the real migrations".
 *
 * Rule for future migrations: their data statements must stay safe to
 * replay on restored rows (guarded UPDATEs, INSERT OR IGNORE seeds).
 */
export function dataStatementsAfter(schemaVersion: number): MigrationStatement[] {
  return NUMBERED_MIGRATIONS.filter(migration => migration.version > schemaVersion)
    .sort((a, b) => a.version - b.version)
    .flatMap(migration => migration.statements)
    .filter(statement => !SCHEMA_CHANGE.test(sqlOf(statement)));
}
