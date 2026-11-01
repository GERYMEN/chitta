import {
  BACKUP_PASSWORD_MIN_LENGTH,
  canTryRestorePassword,
  checkNewBackupPassword,
} from '../backupPassword';

describe('backup password rules', () => {
  it('needs at least 8 characters', () => {
    expect(BACKUP_PASSWORD_MIN_LENGTH).toBe(8);
    expect(checkNewBackupPassword('qa-1234', 'qa-1234')).toEqual({
      passwordError: 'Use at least 8 characters.',
      confirmError: null,
      valid: false,
    });
    expect(checkNewBackupPassword('qa-12345', 'qa-12345').valid).toBe(true);
  });

  it('the confirmation must match exactly', () => {
    const check = checkNewBackupPassword('qa-password', 'qa-Password');
    expect(check.passwordError).toBeNull();
    expect(check.confirmError).toBe("Passwords don't match.");
    expect(check.valid).toBe(false);
  });

  it('caps the length at 128', () => {
    const long = 'q'.repeat(129);
    expect(checkNewBackupPassword(long, long).passwordError).toBe('Use at most 128 characters.');
  });

  it('restore accepts any non-empty password (the file decides)', () => {
    expect(canTryRestorePassword('')).toBe(false);
    expect(canTryRestorePassword('x')).toBe(true);
  });
});
