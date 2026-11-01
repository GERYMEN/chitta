import {
  BACKUP_ERROR_MESSAGES,
  BackupError,
  buildBackupPayload,
  defaultBackupFileName,
  parseBackupJson,
  summarizeBackup,
  validateBackupPayload,
} from '../backup.payload';
import { BACKUP_TABLE_NAMES } from '../backup.tables';
import { FULL_BACKUP_ROWS, rowsAt } from '../../../test/fixtures/backupRows.fixture';

const CURRENT = 7;
const NOW = new Date(2026, 10, 1, 9, 30);
const APP = { versionName: '0.9.0-beta', versionCode: 2 };

const payload = (patch: Record<string, unknown> = {}) => ({
  ...buildBackupPayload({ tables: rowsAt(CURRENT), app: APP, schemaVersion: CURRENT, now: NOW }),
  ...patch,
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BackupError);
    return (error as BackupError).code;
  }
  throw new Error('expected a BackupError');
}

describe('backup payload', () => {
  it('builds {format, app, schemaVersion, createdAt, tables} with every table; device-local keys left out', () => {
    const tables = {
      ...FULL_BACKUP_ROWS,
      app_settings: [...FULL_BACKUP_ROWS.app_settings, { key: 'last_backup_at', value: 'x' }],
    };
    const built = buildBackupPayload({ tables, app: APP, schemaVersion: CURRENT, now: NOW });
    expect(built.format).toBe(1);
    expect(built.app).toEqual(APP);
    expect(built.schemaVersion).toBe(CURRENT);
    expect(built.createdAt).toBe(NOW.toISOString());
    expect(Object.keys(built.tables)).toEqual(BACKUP_TABLE_NAMES);
    expect(built.tables.app_settings.map(r => r.key)).not.toContain('last_backup_at');
  });

  it('round-trips through JSON unchanged', () => {
    const built = payload();
    expect(parseBackupJson(JSON.stringify(built), CURRENT)).toEqual(built);
  });

  it('not JSON / not an object / wrong shape → not_backup', () => {
    expect(codeOf(() => parseBackupJson('{oops', CURRENT))).toBe('not_backup');
    expect(codeOf(() => parseBackupJson('[]', CURRENT))).toBe('not_backup');
    expect(codeOf(() => validateBackupPayload({ ...payload(), format: 0 }, CURRENT))).toBe('not_backup');
    expect(codeOf(() => validateBackupPayload({ ...payload(), format: '1' }, CURRENT))).toBe('not_backup');
    expect(codeOf(() => validateBackupPayload({ ...payload(), createdAt: 'nope' }, CURRENT))).toBe('not_backup');
    const badCell = payload();
    badCell.tables = { ...badCell.tables, accounts: [{ id: { nested: true } as never }] };
    expect(codeOf(() => validateBackupPayload(badCell, CURRENT))).toBe('not_backup');
  });

  it('a newer format or a newer schema → too_new with the update message', () => {
    expect(codeOf(() => validateBackupPayload({ ...payload(), format: 2 }, CURRENT))).toBe('too_new');
    expect(codeOf(() => validateBackupPayload({ ...payload(), schemaVersion: CURRENT + 1 }, CURRENT))).toBe('too_new');
    expect(BACKUP_ERROR_MESSAGES.too_new).toBe('Backup is from a newer app — update Tracker first.');
  });

  it('a table that existed at the backup schema but is missing → incomplete', () => {
    const p = payload();
    const rest = { ...p.tables };
    delete rest.merchant_rules;
    expect(codeOf(() => validateBackupPayload({ ...p, tables: rest }, CURRENT))).toBe('incomplete');
    // …but at schema 4 merchant_rules did not exist yet: fine.
    const old = { ...payload(), schemaVersion: 4, tables: rowsAt(4) };
    expect(validateBackupPayload(old, CURRENT).schemaVersion).toBe(4);
  });

  it('unknown table, unknown column, or a column newer than the backup schema → not_backup', () => {
    const p = payload();
    expect(codeOf(() => validateBackupPayload({ ...p, tables: { ...p.tables, sqlite_master: [] } }, CURRENT))).toBe('not_backup');
    const injected = payload();
    injected.tables = {
      ...injected.tables,
      accounts: [{ ...injected.tables.accounts[0], 'name) VALUES (1); DROP TABLE accounts; --': 'x' }],
    };
    expect(codeOf(() => validateBackupPayload(injected, CURRENT))).toBe('not_backup');
    // deleted_at arrived with migration 1 — a schema-0 backup cannot have it.
    const old = { ...payload(), schemaVersion: 0, tables: rowsAt(0) };
    old.tables.accounts = [{ ...old.tables.accounts[0], deleted_at: null }];
    expect(codeOf(() => validateBackupPayload(old, CURRENT))).toBe('not_backup');
  });

  it('summary: date + transaction/account counts + per-table counts', () => {
    const summary = summarizeBackup(payload());
    expect(summary).toMatchObject({ createdAt: NOW.toISOString(), transactions: 4, accounts: 2 });
    expect(Object.keys(summary.counts)).toEqual(BACKUP_TABLE_NAMES);
  });

  it('default file name: tracker-backup-YYYY-MM-DD.trkbak (local date)', () => {
    expect(defaultBackupFileName(new Date(2026, 0, 5, 23, 59))).toBe('tracker-backup-2026-01-05.trkbak');
  });

  it('error messages carry no data from the file', () => {
    for (const message of Object.values(BACKUP_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/QA|\d{4}-\d{2}/);
    }
  });
});
