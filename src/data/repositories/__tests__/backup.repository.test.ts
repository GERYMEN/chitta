/**
 * R4e backup repository against a REAL SQLite (node:sqlite): lossless
 * export → restore round trip for every table, one-transaction rollback,
 * and older-schema restores checked against the real migrations.
 */
import { backupRepository } from '../backup.repository';
import { CURRENT_SCHEMA_VERSION, dataStatementsAfter } from '../../db/restoreUpgrade';
import { BACKUP_TABLES } from '../../../domain/backup/backup.tables';
import {
  BackupPayload,
  BackupTables,
  buildBackupPayload,
  parseBackupJson,
  summarizeBackup,
} from '../../../domain/backup/backup.payload';
import {
  applyMigrations,
  migrateTo,
  openTestSqlite,
  sqliteAvailable,
  TestSqlite,
} from '../../../test/sqliteDb';
import { FULL_BACKUP_ROWS, rowsAt } from '../../../test/fixtures/backupRows.fixture';

jest.mock('../../db/connection', () => ({ getDatabase: jest.fn() }));

const describeSql = sqliteAvailable() ? describe : describe.skip;
const NOW = new Date('2026-11-01T08:00:00.000Z');
const APP = { versionName: '0.9.0-beta', versionCode: 2 };

const open: TestSqlite[] = [];
function freshDb(version = CURRENT_SCHEMA_VERSION): TestSqlite {
  const t = openTestSqlite();
  migrateTo(t, version);
  open.push(t);
  return t;
}
afterEach(() => open.splice(0).forEach(t => t.close()));

function insertRows(t: TestSqlite, tables: BackupTables) {
  for (const spec of BACKUP_TABLES) {
    for (const row of tables[spec.name] ?? []) {
      const columns = Object.keys(row);
      t.raw
        .prepare(`INSERT OR REPLACE INTO ${spec.name} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...columns.map(c => row[c]));
    }
  }
}

/** Every backup table that exists at `version`, as SELECT * in rowid order. */
function snapshot(t: TestSqlite, version = CURRENT_SCHEMA_VERSION): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const spec of BACKUP_TABLES) {
    if (spec.sinceVersion <= version) out[spec.name] = t.rows(spec.name);
  }
  return out;
}

function withoutRestoreBookkeeping(snap: Record<string, unknown[]>) {
  return {
    ...snap,
    audit_events: snap.audit_events.filter(
      row => (row as { event_type: string }).event_type !== 'backup_restored',
    ),
  };
}

async function restoreInto(t: TestSqlite, payload: BackupPayload) {
  await backupRepository.replaceAllData(
    payload,
    { counts: summarizeBackup(payload).counts, now: NOW },
    t.db,
  );
}

describeSql('backup repository (real SQLite)', () => {
  it('exports every table in one read transaction; JSON round trip restores identical rows', async () => {
    const source = freshDb();
    insertRows(source, FULL_BACKUP_ROWS);
    source.raw.prepare("INSERT INTO app_settings (key, value) VALUES ('last_backup_at', ?)").run('2026-10-30T00:00:00.000Z');
    const transaction = jest.spyOn(source.db, 'transaction');

    const tables = await backupRepository.readAllTables(source.db);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(Object.keys(tables)).toEqual(BACKUP_TABLES.map(t => t.name));
    for (const spec of BACKUP_TABLES) {
      expect(tables[spec.name].length).toBeGreaterThan(0);
    }

    const payload = buildBackupPayload({ tables, app: APP, schemaVersion: CURRENT_SCHEMA_VERSION, now: NOW });
    // Device-local key never leaves the phone.
    expect(payload.tables.app_settings.some(r => r.key === 'last_backup_at')).toBe(false);
    const parsed = parseBackupJson(JSON.stringify(payload), CURRENT_SCHEMA_VERSION);

    const target = freshDb();
    target.raw.exec("INSERT INTO accounts (id, name, type, opening_balance_minor, currency, created_at, updated_at) VALUES ('acc-old', 'QA Old', 'bank', 0, 'INR', 'x', 'x')");
    target.raw.prepare("INSERT INTO app_settings (key, value) VALUES ('last_backup_at', ?)").run('2026-09-09T00:00:00.000Z');
    await restoreInto(target, parsed);

    const expected = snapshot(source);
    const actual = snapshot(target);
    for (const spec of BACKUP_TABLES) {
      if (spec.name === 'audit_events' || spec.name === 'app_settings') continue;
      expect(actual[spec.name]).toEqual(expected[spec.name]);
    }
    expect(withoutRestoreBookkeeping(actual).audit_events).toEqual(expected.audit_events);
    // The old phone's rows are gone; this phone's last backup date is kept.
    expect(target.rows('accounts').map(r => r.id)).not.toContain('acc-old');
    const settings = Object.fromEntries(target.rows('app_settings').map(r => [r.key, r.value]));
    expect(settings.last_backup_at).toBe('2026-09-09T00:00:00.000Z');
    expect(settings.has_onboarded).toBe('true');
    expect(settings.sms_sync_start_at).toBe(FULL_BACKUP_ROWS.app_settings.find(r => r.key === 'sms_sync_start_at')!.value);
    expect(settings.sms_last_synced_at).toBe(FULL_BACKUP_ROWS.app_settings.find(r => r.key === 'sms_last_synced_at')!.value);
  });

  it('writes ONE backup_restored audit row with counts per table only', async () => {
    const target = freshDb();
    const payload = buildBackupPayload({ tables: rowsAt(CURRENT_SCHEMA_VERSION), app: APP, schemaVersion: CURRENT_SCHEMA_VERSION, now: NOW });
    await restoreInto(target, payload);
    const restored = target.rows('audit_events').filter(r => r.event_type === 'backup_restored');
    expect(restored).toHaveLength(1);
    const metadata = JSON.parse(String(restored[0].metadata_json));
    expect(metadata).toEqual({ kind: 'backup_restored', counts: summarizeBackup(payload).counts });
    expect(Object.values(metadata.counts).every(v => typeof v === 'number')).toBe(true);
    expect(String(restored[0].metadata_json)).not.toMatch(/QA-Merchant|QA Bank|preview|note/i);
    // It is the last row (after every restored audit row).
    expect(target.rows('audit_events').at(-1)?.event_type).toBe('backup_restored');
  });

  it('a failure half-way rolls everything back — the existing data is unchanged', async () => {
    const target = freshDb();
    insertRows(target, rowsAt(CURRENT_SCHEMA_VERSION));
    const before = snapshot(target);

    const tables = rowsAt(CURRENT_SCHEMA_VERSION);
    // A transactions row without NOT NULL merchant_name: fails AFTER the
    // deletes and the categories/accounts inserts have run.
    const broken = { ...tables.transactions[1] };
    delete broken.merchant_name;
    tables.transactions = [tables.transactions[0], broken];
    const payload = buildBackupPayload({ tables, app: APP, schemaVersion: CURRENT_SCHEMA_VERSION, now: NOW });

    await expect(restoreInto(target, payload)).rejects.toThrow();
    expect(snapshot(target)).toEqual(before);
  });

  it('dataStatementsAfter keeps only data steps (no ALTER/CREATE) of newer migrations', () => {
    const sql = (s: ReturnType<typeof dataStatementsAfter>[number]) => (typeof s === 'string' ? s : s.sql);
    expect(dataStatementsAfter(CURRENT_SCHEMA_VERSION)).toEqual([]);
    const all = dataStatementsAfter(0).map(sql);
    expect(all.some(s => /^\s*(ALTER|CREATE)/i.test(s))).toBe(false);
    expect(all.some(s => /confidence_score \* 100/.test(s))).toBe(true);
    expect(all.some(s => /cat-uncategorised/.test(s))).toBe(true);
  });

  // Older-schema restore: "restore old rows into today's DB + replay data
  // steps" must equal "old DB + the real numbered migrations".
  const OLDER = Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, i) => i);
  it.each(OLDER)('schema %i → current: restore equals running the real migrations', async version => {
    const old = freshDb(version);
    insertRows(old, rowsAt(version));
    const oldTables: BackupTables = {};
    for (const [name, rows] of Object.entries(snapshot(old, version))) {
      oldTables[name] = rows as BackupTables[string];
    }
    const json = JSON.stringify({
      format: 1,
      app: APP,
      schemaVersion: version,
      createdAt: NOW.toISOString(),
      tables: oldTables,
    });
    const payload = parseBackupJson(json, CURRENT_SCHEMA_VERSION);

    applyMigrations(old, version, CURRENT_SCHEMA_VERSION);
    const expected = snapshot(old);

    const target = freshDb();
    await restoreInto(target, payload);
    expect(withoutRestoreBookkeeping(snapshot(target))).toEqual(expected);
  });

  it('a backup without migration 8 (v7) has no tombstone table and still restores', async () => {
    // R5-fix C4: migration 8 adds the backed-up sms_deleted_refs again.
    const version = 7;
    const tables = rowsAt(version);
    expect(tables.sms_deleted_refs).toBeUndefined();
    const payload = parseBackupJson(
      JSON.stringify({ format: 1, app: APP, schemaVersion: version, createdAt: NOW.toISOString(), tables }),
      CURRENT_SCHEMA_VERSION,
    );
    const target = freshDb();
    await restoreInto(target, payload);
    expect(target.rows('transactions')).toHaveLength(FULL_BACKUP_ROWS.transactions.length);
    expect(target.rows('sms_deleted_refs')).toEqual([]);
  });

  it('N-1 → N specifically (R5d): a v8 backup has no identity columns; they restore as NULL', async () => {
    const version = CURRENT_SCHEMA_VERSION - 1;
    expect(version).toBe(8);
    const tables = rowsAt(version);
    expect(Object.keys(tables.transactions[0])).not.toContain('sms_content_hash');
    expect(Object.keys(tables.sms_deleted_refs[0])).not.toContain('ref_key');
    const payload = parseBackupJson(
      JSON.stringify({ format: 1, app: APP, schemaVersion: version, createdAt: NOW.toISOString(), tables }),
      CURRENT_SCHEMA_VERSION,
    );
    const target = freshDb();
    await restoreInto(target, payload);
    expect(target.rows('transactions')).toHaveLength(FULL_BACKUP_ROWS.transactions.length);
    for (const row of target.rows('transactions')) {
      expect(row.sms_content_hash).toBeNull();
      expect(row.ref_digest).toBeNull();
    }
    expect(target.rows('sms_deleted_refs')).toHaveLength(FULL_BACKUP_ROWS.sms_deleted_refs.length);
    expect(target.rows('sms_deleted_refs')[0].sms_content_hash).toBeNull();
  });

  it('R5d: a v9 backup carries the identity hashes and the salt round-trips', async () => {
    const tables = rowsAt(CURRENT_SCHEMA_VERSION);
    const sms = tables.transactions.find(row => row.sms_content_hash != null)!;
    expect(sms.ref_digest).toMatch(/^[0-9a-f]{32}$/);
    expect(tables.app_settings.some(row => row.key === 'sms_identity_salt')).toBe(true);
    const payload = parseBackupJson(
      JSON.stringify({ format: 1, app: APP, schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: NOW.toISOString(), tables }),
      CURRENT_SCHEMA_VERSION,
    );
    const target = freshDb();
    await restoreInto(target, payload);
    const restored = target.rows('transactions').find(row => row.id === sms.id)!;
    expect(restored.sms_content_hash).toBe(sms.sms_content_hash);
    expect(restored.ref_digest).toBe(sms.ref_digest);
    expect(target.rows('sms_deleted_refs')[0].ref_key).toBe(tables.sms_deleted_refs[0].ref_key);
    expect(target.rows('app_settings').find(row => row.key === 'sms_identity_salt')?.value).toBe(
      tables.app_settings.find(row => row.key === 'sms_identity_salt')?.value,
    );
  });

  it('a backup without migration 7 (v6) still restores', async () => {
    const version = 6;
    const tables = rowsAt(version);
    expect(tables.duplicate_pair_dismissals).toBeUndefined();
    const payload = parseBackupJson(
      JSON.stringify({ format: 1, app: APP, schemaVersion: version, createdAt: NOW.toISOString(), tables }),
      CURRENT_SCHEMA_VERSION,
    );
    const target = freshDb();
    await restoreInto(target, payload);
    expect(target.rows('transactions')).toHaveLength(FULL_BACKUP_ROWS.transactions.length);
    expect(target.rows('duplicate_pair_dismissals')).toEqual([]);
  });
});
