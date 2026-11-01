/**
 * R4e test helper: a REAL in-memory SQLite database (Node's built-in
 * `node:sqlite`, Node >= 22.13) behind the small slice of the op-sqlite `DB`
 * API the app uses — `execute(sql, params)` → `{ rows, rowsAffected,
 * insertId }` and `transaction(fn)` with BEGIN / COMMIT / ROLLBACK. Used where
 * the regex-based fakeDb is not enough: real schema + migrations, real
 * rollback, PRAGMA table_info.
 */
import type { DB } from '@op-engineering/op-sqlite';
import { SCHEMA_STATEMENTS } from '../data/db/schema';
import { NUMBERED_MIGRATIONS } from '../data/db/migrations';

type Params = ReadonlyArray<unknown> | undefined;

interface SyncDb {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Array<Record<string, unknown>>;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
  close(): void;
}

export function sqliteAvailable(): boolean {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

export interface TestSqlite {
  db: DB;
  raw: SyncDb;
  /** Every SELECT * row of a table, ordered by rowid (plain objects). */
  rows: (table: string) => Array<Record<string, unknown>>;
  close: () => void;
}

const isRead = (sql: string) => /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);

export function openTestSqlite(): TestSqlite {
  const { DatabaseSync } = require('node:sqlite');
  // op-sqlite ships SQLite with foreign keys OFF (no SQLITE_DEFAULT_FOREIGN_KEYS) — match it.
  const raw: SyncDb = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });

  const run = (sql: string, params: Params) => {
    const bound = (params ?? []).map(p => (p === undefined ? null : p));
    const statement = raw.prepare(sql);
    if (isRead(sql)) {
      const rows = statement.all(...bound).map(row => ({ ...row }));
      return { rows, rowsAffected: 0, insertId: 0 };
    }
    const info = statement.run(...bound);
    return { rows: [], rowsAffected: Number(info.changes), insertId: Number(info.lastInsertRowid) };
  };

  let inTx = false;
  const execute = async (sql: string, params?: Params) => run(sql, params);
  const db = {
    execute,
    transaction: async (fn: (tx: { execute: typeof execute }) => Promise<void>) => {
      if (inTx) throw new Error('nested transaction');
      inTx = true;
      raw.exec('BEGIN');
      try {
        await fn({ execute });
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      } finally {
        inTx = false;
      }
    },
  } as unknown as DB;

  return {
    db,
    raw,
    rows: table =>
      raw
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all()
        .map(row => ({ ...row })),
    close: () => raw.close(),
  };
}

/** Base schema + numbered migrations up to and including `version`. */
export function migrateTo(t: TestSqlite, version: number): void {
  for (const statement of SCHEMA_STATEMENTS) t.raw.exec(statement);
  applyMigrations(t, 0, version);
}

/** Apply the numbered migrations in (from, to]. */
export function applyMigrations(t: TestSqlite, from: number, to: number): void {
  for (const migration of NUMBERED_MIGRATIONS) {
    if (migration.version <= from || migration.version > to) continue;
    for (const statement of migration.statements) {
      if (typeof statement === 'string') t.raw.exec(statement);
      else t.raw.prepare(statement.sql).run(...statement.params);
    }
    t.raw.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      migration.version,
      0,
    );
  }
}
