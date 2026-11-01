import { NativeModules } from 'react-native';
import { sanitizeAuditMetadata } from '../../../../domain/audit/audit.rules';
import { describeActivity } from '../../../../features/activity/activityFeed';

const mockModule = {
  saveBackup: jest.fn(),
  pickBackup: jest.fn(),
  decryptBackup: jest.fn(),
  forgetPickedBackup: jest.fn(async () => true),
};

function load() {
  (NativeModules as Record<string, unknown>).TrackerBackup = mockModule;
  let mod!: typeof import('../backupNative');
  jest.isolateModules(() => {
    mod = require('../backupNative');
  });
  return mod;
}

const rejectWith = (code: string) => Object.assign(new Error('native text with details'), { code });

describe('R4e backupNative wrapper', () => {
  it('passes json/password/name straight through and returns the native result', async () => {
    const native = load();
    mockModule.saveBackup.mockResolvedValueOnce({ saved: true, name: 'a.trkbak', bytes: 5 });
    await expect(native.saveBackupFile('{"format":1}', 'qa-password', 'a.trkbak')).resolves.toEqual({
      saved: true,
      name: 'a.trkbak',
      bytes: 5,
    });
    expect(mockModule.saveBackup).toHaveBeenCalledWith('{"format":1}', 'qa-password', 'a.trkbak');
  });

  it.each([
    ['E_CANCELLED', 'cancelled'],
    ['E_NOT_BACKUP', 'not_backup'],
    ['E_TOO_NEW', 'too_new'],
    ['E_BAD_PASSWORD', 'bad_password'],
    ['E_BUSY', 'busy'],
    ['E_IO', 'io'],
    ['E_SOMETHING_ELSE', 'io'],
  ])('native %s → BackupError %s with a fixed message (native text dropped)', async (code, mapped) => {
    const native = load();
    mockModule.decryptBackup.mockRejectedValueOnce(rejectWith(code));
    const error = await native.decryptBackupFile('content://qa', 'qa-password').catch(e => e);
    expect(error.name).toBe('BackupError');
    expect(error.code).toBe(mapped);
    expect(error.message).not.toContain('native text');
  });

  it('missing native module → io error, forget is a no-op', async () => {
    delete (NativeModules as Record<string, unknown>).TrackerBackup;
    let mod!: typeof import('../backupNative');
    jest.isolateModules(() => {
      mod = require('../backupNative');
    });
    await expect(mod.pickBackupFile()).rejects.toMatchObject({ code: 'io' });
    await expect(mod.forgetPickedBackup()).resolves.toBeUndefined();
  });
});

describe('R4e backup_restored audit + Activity', () => {
  it('the sanitizer keeps table counts only (integers, table-like keys)', () => {
    expect(
      sanitizeAuditMetadata({
        kind: 'backup_restored',
        counts: { transactions: 4, accounts: 2, 'QA-Merchant name': 9, bad: -1, frac: 1.5 } as Record<string, number>,
      }),
    ).toEqual({ kind: 'backup_restored', counts: { transactions: 4, accounts: 2 } });
  });

  it('Activity says what happened with a count only', () => {
    const item = describeActivity({
      id: 'qa-a1',
      seq: 1,
      transactionId: null,
      accountId: null,
      eventType: 'backup_restored',
      eventAt: '2026-11-01T09:00:00.000Z',
      actor: 'user',
      metadata: { kind: 'backup_restored', counts: { transactions: 4 } },
      deletedSnapshot: null,
    });
    expect(item.sentence).toBe('You restored Tracker from a backup');
    expect(item.impact?.text).toBe('All data replaced · 4 transactions');
    expect(item.icon).toBe('database-import-outline');
  });
});
