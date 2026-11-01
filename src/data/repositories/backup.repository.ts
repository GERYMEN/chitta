import type { DB, Scalar } from '@op-engineering/op-sqlite';
import { getDatabase } from '../db/connection';
import { dataStatementsAfter } from '../db/restoreUpgrade';
import { auditRepository, SqlExecutor } from './audit.repository';
import {
  BACKUP_TABLES,
  DEVICE_LOCAL_SETTING_KEYS,
} from '../../domain/backup/backup.tables';
import type {
  BackupCell,
  BackupPayload,
  BackupRow,
  BackupTables,
} from '../../domain/backup/backup.payload';

/**
 * R4e: raw table access for backup + restore. Table and column names come
 * ONLY from the fixed BACKUP_TABLES catalogue (never from the file); every
 * value is a bound parameter.
 *
 * Nothing here logs: rows, the JSON and the password never reach a console.
 */
export type BackupDb = Pick<DB, 'execute' | 'transaction'>;

const HAS_ONBOARDED_KEY = 'has_onboarded';

function toCell(value: unknown): BackupCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value);
}

/**
 * Every backup table, read inside ONE transaction (a consistent snapshot).
 * Rows keep rowid order, so a restore re-inserts them in the same order —
 * the Activity feed uses audit rowid as its tie-breaker.
 */
async function readAllTables(db: BackupDb = getDatabase()): Promise<BackupTables> {
  const tables: BackupTables = {};
  await db.transaction(async tx => {
    for (const spec of BACKUP_TABLES) {
      const result = await tx.execute(`SELECT * FROM ${spec.name} ORDER BY rowid`);
      const known = Object.keys(spec.columns);
      tables[spec.name] = result.rows.map(row => {
        const out: BackupRow = {};
        for (const column of known) {
          if (column in row) out[column] = toCell((row as Record<string, unknown>)[column]);
        }
        return out;
      });
    }
  });
  return tables;
}

export interface ReplaceAllOptions {
  /** Written into the `backup_restored` audit row (counts per table only). */
  counts: Record<string, number>;
  now?: Date;
}

async function insertRow(executor: SqlExecutor, table: string, row: BackupRow, allowed: Set<string>) {
  const columns = Object.keys(row).filter(column => allowed.has(column));
  if (columns.length === 0) return;
  const placeholders = columns.map(() => '?').join(', ');
  await executor.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
    columns.map(column => row[column] as Scalar),
  );
}

/**
 * Replace ALL user data with a validated payload, in ONE transaction:
 * delete every backup table, insert the backup's rows, replay the data steps
 * of migrations newer than the backup, keep this phone's device-local
 * settings, mark onboarding done, and write one `backup_restored` audit row.
 * Any failure rolls the whole transaction back — the app data is unchanged.
 */
async function replaceAllData(
  payload: BackupPayload,
  options: ReplaceAllOptions,
  db: BackupDb = getDatabase(),
): Promise<void> {
  await db.transaction(async tx => {
    const local: Array<[string, string]> = [];
    for (const key of DEVICE_LOCAL_SETTING_KEYS) {
      const result = await tx.execute('SELECT value FROM app_settings WHERE key = ?', [key]);
      if (result.rows.length > 0) local.push([key, String(result.rows[0].value)]);
    }

    for (const spec of [...BACKUP_TABLES].reverse()) {
      await tx.execute(`DELETE FROM ${spec.name}`);
    }

    for (const spec of BACKUP_TABLES) {
      const allowed = new Set(Object.keys(spec.columns));
      for (const row of payload.tables[spec.name] ?? []) {
        if (spec.name === 'app_settings' && DEVICE_LOCAL_SETTING_KEYS.includes(String(row.key))) {
          continue;
        }
        await insertRow(tx, spec.name, row, allowed);
      }
    }

    for (const statement of dataStatementsAfter(payload.schemaVersion)) {
      if (typeof statement === 'string') await tx.execute(statement);
      else await tx.execute(statement.sql, statement.params);
    }

    for (const [key, value] of local) {
      await tx.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
    }
    // A backup can only be made after setup, so restored data is always "set up".
    // (INSERT OR IGNORE + UPDATE keeps the restored row's rowid order.)
    await tx.execute('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)', [
      HAS_ONBOARDED_KEY,
      'true',
    ]);
    await tx.execute('UPDATE app_settings SET value = ? WHERE key = ?', ['true', HAS_ONBOARDED_KEY]);

    await auditRepository.insert(tx, {
      eventType: 'backup_restored',
      actor: 'user',
      eventAt: (options.now ?? new Date()).toISOString(),
      metadata: { kind: 'backup_restored', counts: options.counts },
    });
  });
}

export const backupRepository = {
  readAllTables,
  replaceAllData,
};
