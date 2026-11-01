/**
 * R4e: backup password rules. The password lives only in component state
 * and is handed straight to the native encrypt/decrypt call — never stored,
 * never logged, never audited.
 */
export const BACKUP_PASSWORD_MIN_LENGTH = 8;
/** Generous cap so a pasted blob cannot freeze the key derivation. */
export const BACKUP_PASSWORD_MAX_LENGTH = 128;

export interface BackupPasswordCheck {
  passwordError: string | null;
  confirmError: string | null;
  valid: boolean;
}

export function backupPasswordError(password: string): string | null {
  if (password.length < BACKUP_PASSWORD_MIN_LENGTH) {
    return `Use at least ${BACKUP_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > BACKUP_PASSWORD_MAX_LENGTH) {
    return `Use at most ${BACKUP_PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

/** New backup: min length + the confirmation must match exactly. */
export function checkNewBackupPassword(password: string, confirm: string): BackupPasswordCheck {
  const passwordError = backupPasswordError(password);
  const confirmError = confirm === password ? null : "Passwords don't match.";
  return { passwordError, confirmError, valid: passwordError === null && confirmError === null };
}

/** Opening a backup: anything non-empty may be tried (the file decides). */
export function canTryRestorePassword(password: string): boolean {
  return password.length > 0 && password.length <= BACKUP_PASSWORD_MAX_LENGTH;
}
