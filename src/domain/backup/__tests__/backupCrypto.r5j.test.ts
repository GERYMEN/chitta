/**
 * R5j T5 — the backup-crypto logic reachable from Jest (the TypeScript side).
 *
 * NOT covered here (no harness exists): the Kotlin PBKDF2WithHmacSHA256 +
 * AES-256-GCM implementation (BackupCrypto.kt). It was verified once by hand
 * in R4e; there is no Kotlin unit-test source set or JUnit dependency in this
 * repo, so a repo test for it is flagged, not invented.
 *
 * Characterisation tests: they pin the current behaviour. Synthetic passwords.
 */
import { NativeModules } from 'react-native';
import {
  BACKUP_PASSWORD_MAX_LENGTH,
  BACKUP_PASSWORD_MIN_LENGTH,
  backupPasswordError,
  canTryRestorePassword,
  checkNewBackupPassword,
} from '../backupPassword';
import { BACKUP_ERROR_MESSAGES } from '../backup.payload';

const mockModule = {
  saveBackup: jest.fn(),
  pickBackup: jest.fn(),
  decryptBackup: jest.fn(),
  forgetPickedBackup: jest.fn(async () => true),
};

function load() {
  (NativeModules as Record<string, unknown>).TrackerBackup = mockModule;
  let mod!: typeof import('../../../native/android/backup/backupNative');
  jest.isolateModules(() => {
    mod = require('../../../native/android/backup/backupNative');
  });
  return mod;
}

describe('password length boundaries', () => {
  it('7 fails, 8 passes, 128 passes, 129 fails', () => {
    expect(backupPasswordError('q'.repeat(BACKUP_PASSWORD_MIN_LENGTH - 1))).not.toBeNull();
    expect(backupPasswordError('q'.repeat(BACKUP_PASSWORD_MIN_LENGTH))).toBeNull();
    expect(backupPasswordError('q'.repeat(BACKUP_PASSWORD_MAX_LENGTH))).toBeNull();
    expect(backupPasswordError('q'.repeat(BACKUP_PASSWORD_MAX_LENGTH + 1))).not.toBeNull();
  });

  it('restore: 1 and 128 may be tried, 0 and 129 may not', () => {
    expect(canTryRestorePassword('q')).toBe(true);
    expect(canTryRestorePassword('q'.repeat(BACKUP_PASSWORD_MAX_LENGTH))).toBe(true);
    expect(canTryRestorePassword('')).toBe(false);
    expect(canTryRestorePassword('q'.repeat(BACKUP_PASSWORD_MAX_LENGTH + 1))).toBe(false);
  });

  it('spaces count (no trim) and non-ASCII passwords are accepted as typed', () => {
    expect(backupPasswordError('        ')).toBeNull();
    expect(checkNewBackupPassword('qa pass 1', 'qa pass 1 ').confirmError).toBe("Passwords don't match.");
    expect(backupPasswordError('pässwörd-1')).toBeNull();
  });

  it('an empty confirmation never matches a real password', () => {
    expect(checkNewBackupPassword('qa-password', '').valid).toBe(false);
  });

  it('error text never contains the password', () => {
    const secret = 'qa-secret-xyz';
    const check = checkNewBackupPassword(secret, secret + '1');
    expect(JSON.stringify(check)).not.toContain(secret);
  });
});

describe('native error mapping (password handling around the Kotlin crypto)', () => {
  const rejectWith = (code: string) =>
    Object.assign(new Error('native text with qa-secret-xyz'), { code });

  it.each([
    ['E_BAD_PASSWORD', 'bad_password'],
    ['E_NOT_BACKUP', 'not_backup'],
    ['E_TOO_NEW', 'too_new'],
    ['E_CANCELLED', 'cancelled'],
    ['E_BUSY', 'busy'],
    ['E_SOMETHING_ELSE', 'io'],
  ])('%s → %s, fixed message, native text and password dropped', async (nativeCode, code) => {
    mockModule.decryptBackup.mockRejectedValueOnce(rejectWith(nativeCode));
    const { decryptBackupFile } = load();
    const error = await decryptBackupFile('content://qa/backup', 'qa-secret-xyz').catch(e => e);
    expect(error.code).toBe(code);
    expect(error.message).toBe(BACKUP_ERROR_MESSAGES[code as keyof typeof BACKUP_ERROR_MESSAGES]);
    expect(error.message).not.toContain('qa-secret-xyz');
  });

  it('a non-object rejection maps to io', async () => {
    mockModule.saveBackup.mockRejectedValueOnce('boom');
    const { saveBackupFile } = load();
    const error = await saveBackupFile('{}', 'qa-password', 'qa.bak').catch(e => e);
    expect(error.code).toBe('io');
  });

  it('the password reaches the native call unchanged, once', async () => {
    mockModule.decryptBackup.mockResolvedValueOnce('{}');
    const { decryptBackupFile } = load();
    await decryptBackupFile('content://qa/backup', ' qa pass ');
    expect(mockModule.decryptBackup).toHaveBeenLastCalledWith('content://qa/backup', ' qa pass ');
  });
});
