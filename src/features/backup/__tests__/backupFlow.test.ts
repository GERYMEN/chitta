/**
 * R4e backup → restore flow on a REAL SQLite (node:sqlite) with the native
 * file/crypto layer mocked: save, restore + every store reloaded, onboarding
 * path + tour rule, rollback, busy guard, and privacy (no password / JSON in
 * the console or the audit table).
 */
import {
  openTestSqlite,
  migrateTo,
  sqliteAvailable,
  TestSqlite,
} from '../../../test/sqliteDb';
import { FULL_BACKUP_ROWS } from '../../../test/fixtures/backupRows.fixture';
import { BACKUP_TABLES } from '../../../domain/backup/backup.tables';
import { BackupError, BackupTables } from '../../../domain/backup/backup.payload';
import { CURRENT_SCHEMA_VERSION } from '../../../data/db/restoreUpgrade';

const mockDb: { current: TestSqlite | null } = { current: null };
jest.mock('../../../data/db/connection', () => ({
  getDatabase: () => mockDb.current!.db,
  runMigrations: jest.fn(async () => undefined),
}));

const mockNative = {
  saveBackupFile: jest.fn(),
  pickBackupFile: jest.fn(),
  decryptBackupFile: jest.fn(),
  forgetPickedBackup: jest.fn<Promise<void>, unknown[]>(async () => undefined),
};
jest.mock('../../../native/android/backup/backupNative', () => ({
  saveBackupFile: (...args: unknown[]) => mockNative.saveBackupFile(...args),
  pickBackupFile: (...args: unknown[]) => mockNative.pickBackupFile(...args),
  decryptBackupFile: (...args: unknown[]) => mockNative.decryptBackupFile(...args),
  forgetPickedBackup: (...args: unknown[]) => mockNative.forgetPickedBackup(...args),
}));

// Imported after the mocks.
import { openBackup, pickBackup, restoreBackup, saveBackup } from '../backupService';
import { useBackupStore } from '../backupStore';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { DEFAULT_TRANSACTION_FILTERS } from '../../transactions/filters/transactionFilters';
import { useTourStore } from '../../tour/tourStore';
import { useSuggestionSession } from '../../sms-sync/suggestionSession';
import { useSyncRunStore } from '../../sms-sync/syncRunner';
import { useDataEpochStore } from '../../../shared/state/dataEpoch';

const describeSql = sqliteAvailable() ? describe : describe.skip;

const PASSWORD = 'qa-secret-password-77';
const PICKED = { uri: 'content://qa/backup', name: 'tracker-backup-2026-11-01.trkbak', bytes: 1234 };
const NOW = new Date(2026, 10, 1, 9, 30);

function seed(t: TestSqlite, tables: BackupTables) {
  for (const spec of BACKUP_TABLES) {
    for (const row of tables[spec.name] ?? []) {
      const columns = Object.keys(row);
      t.raw
        .prepare(`INSERT OR REPLACE INTO ${spec.name} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...columns.map(c => row[c]));
    }
  }
}

function newDb(tables?: BackupTables): TestSqlite {
  mockDb.current?.close();
  const t = openTestSqlite();
  migrateTo(t, CURRENT_SCHEMA_VERSION);
  if (tables) seed(t, tables);
  mockDb.current = t;
  return t;
}

/** Make a backup of `tables` through the real service; returns the JSON the native layer got. */
async function backupJsonOf(tables: BackupTables): Promise<string> {
  newDb(tables);
  let captured = '';
  mockNative.saveBackupFile.mockImplementationOnce(async (json: string) => {
    captured = json;
    return { saved: true, name: PICKED.name, bytes: 10 };
  });
  await saveBackup(PASSWORD, NOW);
  return captured;
}

const settingsOf = (t: TestSqlite) =>
  Object.fromEntries(t.rows('app_settings').map(r => [String(r.key), String(r.value)]));

let consoleSpies: jest.SpyInstance[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level =>
    jest.spyOn(console, level).mockImplementation(() => undefined),
  );
  useSyncRunStore.setState({ running: false });
  useTourStore.setState({ active: false, index: 0, requested: false });
});
afterEach(() => {
  consoleSpies.forEach(spy => spy.mockRestore());
  mockDb.current?.close();
  mockDb.current = null;
});

function expectNothingSecretLogged(...secrets: string[]) {
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      const text = call.map(String).join(' ');
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  }
}

describeSql('R4e backup flow', () => {
  it('Save: every table goes to the native layer with the password + default name; last backup date is kept locally', async () => {
    newDb(FULL_BACKUP_ROWS);
    mockNative.saveBackupFile.mockResolvedValueOnce({ saved: true, name: PICKED.name, bytes: 99 });
    const outcome = await saveBackup(PASSWORD, NOW);
    expect(outcome).toEqual({ saved: true, name: PICKED.name });

    const [json, password, name] = mockNative.saveBackupFile.mock.calls[0];
    expect(password).toBe(PASSWORD);
    expect(name).toBe('tracker-backup-2026-11-01.trkbak');
    const payload = JSON.parse(json);
    expect(payload).toMatchObject({ format: 1, schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: NOW.toISOString() });
    expect(Object.keys(payload.tables)).toEqual(BACKUP_TABLES.map(t => t.name));
    expect(payload.tables.transactions).toHaveLength(FULL_BACKUP_ROWS.transactions.length);
    expect(JSON.stringify(payload)).not.toContain(PASSWORD);

    expect(settingsOf(mockDb.current!).last_backup_at).toBe(NOW.toISOString());
    expect(useBackupStore.getState().lastBackupAt).toBe(NOW.toISOString());
    expectNothingSecretLogged(PASSWORD, json);
  });

  it('Save cancelled in the picker: nothing recorded', async () => {
    const t = newDb(FULL_BACKUP_ROWS);
    mockNative.saveBackupFile.mockResolvedValueOnce({ saved: false });
    expect(await saveBackup(PASSWORD, NOW)).toEqual({ saved: false });
    expect(settingsOf(t).last_backup_at).toBeUndefined();
  });

  it('Save refuses a password under 8 characters before touching the native layer', async () => {
    newDb(FULL_BACKUP_ROWS);
    await expect(saveBackup('short', NOW)).rejects.toBeInstanceOf(BackupError);
    expect(mockNative.saveBackupFile).not.toHaveBeenCalled();
  });

  it('Restore replaces everything and reloads every store (rows, settings, sync start/cursor, tour, widget, session)', async () => {
    const json = await backupJsonOf(FULL_BACKUP_ROWS);

    // The phone now holds different data and some session state.
    const target = newDb({
      accounts: [{ id: 'acc-old', name: 'QA Old Bank', type: 'bank', last_four: null, opening_balance_minor: 0, currency: 'INR', is_active: 1, created_at: 'x', updated_at: 'x' }],
      app_settings: [
        { key: 'has_onboarded', value: 'true' },
        { key: 'user_name', value: 'QA Old' },
        { key: 'last_backup_at', value: '2026-10-20T00:00:00.000Z' },
      ],
    });
    await useTransactionsStore.getState().hydrate();
    useTransactionsStore.getState().setTransactionFilters({ categoryId: 'cat-old' });
    useTransactionsStore.getState().setSelectedPeriod('1Y');
    useSuggestionSession.getState().start([]);
    useTourStore.setState({ active: true, index: 3, requested: false });
    const epochBefore = useDataEpochStore.getState().epoch;
    expect(useTransactionsStore.getState().accounts.map(a => a.id)).toEqual(['acc-old']);

    mockNative.pickBackupFile.mockResolvedValueOnce(PICKED);
    mockNative.decryptBackupFile.mockResolvedValueOnce(json);
    const picked = await pickBackup();
    const opened = await openBackup(picked, PASSWORD);
    expect(mockNative.decryptBackupFile).toHaveBeenCalledWith(PICKED.uri, PASSWORD);
    expect(opened.summary).toMatchObject({ transactions: 4, accounts: 2 });
    await restoreBackup(opened, NOW);

    const state = useTransactionsStore.getState();
    expect(state.transactions.map(t => t.id).sort()).toEqual(['qa-t1', 'qa-t2', 'qa-t3', 'qa-t4']);
    expect(state.accounts.map(a => a.id).sort()).toEqual(['acc-qa-1', 'acc-qa-2']);
    expect(state.userName).toBe('QA');
    expect(state.hasOnboarded).toBe(true);
    expect(state.smsSyncStartMode).toBe('custom');
    expect(state.smsSyncStartAt).toBe('2026-10-01T09:00:00.000Z');
    expect(state.smsLastSyncedAt).toBe('2026-10-05T10:30:00.000Z');
    expect(state.merchantRules).toEqual({ 'qa merchant': 'cat-qa-custom' });
    expect(state.transactionFilters).toEqual(DEFAULT_TRANSACTION_FILTERS);
    expect(state.selectedPeriod).toBe('1M');
    expect(useSuggestionSession.getState().runId).toBeNull();
    expect(useTourStore.getState()).toMatchObject({ active: false, requested: false });
    expect(useDataEpochStore.getState().epoch).toBe(epochBefore + 1);
    expect(mockNative.forgetPickedBackup).toHaveBeenCalled();

    // Device-local: this phone's last backup date survives the restore.
    expect(settingsOf(target).last_backup_at).toBe('2026-10-20T00:00:00.000Z');
    expect(useBackupStore.getState().lastBackupAt).toBe('2026-10-20T00:00:00.000Z');

    // Audit: one backup_restored row with counts only; no password, no JSON.
    const audit = target.rows('audit_events');
    const restored = audit.filter(r => r.event_type === 'backup_restored');
    expect(restored).toHaveLength(1);
    expect(JSON.parse(String(restored[0].metadata_json)).counts.transactions).toBe(4);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(String(restored[0].metadata_json)).not.toContain('QA-Merchant');
    expectNothingSecretLogged(PASSWORD, json);
  });

  it('Onboarding path: a new install restores, setup completes and the tour is NOT shown (backup has tour_completed_at)', async () => {
    const json = await backupJsonOf(FULL_BACKUP_ROWS);
    newDb();
    await useTransactionsStore.getState().hydrate();
    expect(useTransactionsStore.getState().hasOnboarded).toBe(false);

    mockNative.decryptBackupFile.mockResolvedValueOnce(json);
    await restoreBackup(await openBackup(PICKED, PASSWORD), NOW);

    expect(useTransactionsStore.getState().hasOnboarded).toBe(true);
    expect(useTourStore.getState().requested).toBe(false);
    expect(settingsOf(mockDb.current!).tour_completed_at).toBe('2026-10-05T10:30:00.000Z');
  });

  it('tour rule after restore: owed ("") → requested; key missing → marked done silently', async () => {
    const owed = {
      ...FULL_BACKUP_ROWS,
      app_settings: FULL_BACKUP_ROWS.app_settings.map(r => (r.key === 'tour_completed_at' ? { ...r, value: '' } : r)),
    };
    let json = await backupJsonOf(owed);
    newDb();
    mockNative.decryptBackupFile.mockResolvedValueOnce(json);
    await restoreBackup(await openBackup(PICKED, PASSWORD), NOW);
    expect(useTourStore.getState().requested).toBe(true);

    useTourStore.setState({ requested: false });
    const missing = {
      ...FULL_BACKUP_ROWS,
      app_settings: FULL_BACKUP_ROWS.app_settings.filter(r => r.key !== 'tour_completed_at'),
    };
    json = await backupJsonOf(missing);
    newDb();
    mockNative.decryptBackupFile.mockResolvedValueOnce(json);
    await restoreBackup(await openBackup(PICKED, PASSWORD), NOW);
    expect(useTourStore.getState().requested).toBe(false);
    expect(settingsOf(mockDb.current!).tour_completed_at).toBeTruthy();
  });

  it('a failing restore rolls back: data AND stores unchanged, fixed message', async () => {
    const json = await backupJsonOf(FULL_BACKUP_ROWS);
    const broken = JSON.parse(json);
    delete broken.tables.transactions[2].merchant_name;

    const target = newDb({ app_settings: [{ key: 'has_onboarded', value: 'true' }, { key: 'user_name', value: 'QA Old' }] });
    await useTransactionsStore.getState().hydrate();
    const before = BACKUP_TABLES.map(spec => target.rows(spec.name));

    mockNative.decryptBackupFile.mockResolvedValueOnce(JSON.stringify(broken));
    const opened = await openBackup(PICKED, PASSWORD);
    await expect(restoreBackup(opened, NOW)).rejects.toMatchObject({
      code: 'incomplete',
      message: 'The backup could not be restored. Your data was not changed.',
    });
    expect(BACKUP_TABLES.map(spec => target.rows(spec.name))).toEqual(before);
    expect(useTransactionsStore.getState().userName).toBe('QA Old');
    expectNothingSecretLogged(PASSWORD);
  });

  it('wrong password / newer backup / not a backup surface as fixed BackupErrors', async () => {
    newDb();
    mockNative.decryptBackupFile.mockRejectedValueOnce(new BackupError('bad_password'));
    await expect(openBackup(PICKED, 'qa-wrong-password')).rejects.toMatchObject({
      code: 'bad_password',
      message: 'Wrong password or damaged file.',
    });
    mockNative.decryptBackupFile.mockResolvedValueOnce(
      JSON.stringify({ format: 1, app: { versionName: 'x', versionCode: 9 }, schemaVersion: CURRENT_SCHEMA_VERSION + 1, createdAt: NOW.toISOString(), tables: {} }),
    );
    await expect(openBackup(PICKED, PASSWORD)).rejects.toMatchObject({ code: 'too_new' });
    mockNative.decryptBackupFile.mockResolvedValueOnce('not json at all');
    await expect(openBackup(PICKED, PASSWORD)).rejects.toMatchObject({ code: 'not_backup' });
  });

  it('refuses to pick or restore while an SMS sync is running', async () => {
    newDb();
    useSyncRunStore.setState({ running: true });
    await expect(pickBackup()).rejects.toMatchObject({ code: 'busy' });
    expect(mockNative.pickBackupFile).not.toHaveBeenCalled();
  });
});
