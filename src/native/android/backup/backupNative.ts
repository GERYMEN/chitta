import { NativeModules } from 'react-native';
import { BackupError, BackupErrorCode } from '../../../domain/backup/backup.payload';

/**
 * R4e: typed wrapper around the own native `TrackerBackup` module
 * (android/app/src/main/java/com/tracker/BackupModule.kt + BackupCrypto.kt).
 *
 * Save:    saveBackup(json, password, name) → SAF "create document", encrypt, write.
 * Restore: pickBackup() → SAF "open document" + header check, then
 *          decryptBackup(uri, password) → the JSON string.
 *
 * Privacy: the password and JSON are passed straight through — never logged,
 * stored or put in an error message. Native errors are mapped to fixed
 * BackupError codes; the native message is dropped.
 */
export interface SaveBackupResult {
  saved: boolean;
  name?: string;
  bytes?: number;
}

export interface PickedBackup {
  uri: string;
  name: string;
  /** -1 when the provider does not report a size. */
  bytes: number;
}

interface BackupNativeModule {
  saveBackup(json: string, password: string, suggestedName: string): Promise<SaveBackupResult>;
  pickBackup(): Promise<PickedBackup>;
  decryptBackup(uri: string, password: string): Promise<string>;
  forgetPickedBackup(): Promise<boolean>;
}

const { TrackerBackup } = NativeModules as { TrackerBackup?: BackupNativeModule };

function nativeModule(): BackupNativeModule {
  if (!TrackerBackup) throw new BackupError('io');
  return TrackerBackup;
}

const CODE_MAP: Record<string, BackupErrorCode> = {
  E_CANCELLED: 'cancelled',
  E_NOT_BACKUP: 'not_backup',
  E_TOO_NEW: 'too_new',
  E_BAD_PASSWORD: 'bad_password',
  E_BUSY: 'busy',
};

/** Native rejection → BackupError (fixed message; the native text is dropped). */
export function toBackupError(error: unknown): BackupError {
  if (error instanceof BackupError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  return new BackupError(typeof code === 'string' && CODE_MAP[code] ? CODE_MAP[code] : 'io');
}

export async function saveBackupFile(
  json: string,
  password: string,
  suggestedName: string,
): Promise<SaveBackupResult> {
  try {
    return await nativeModule().saveBackup(json, password, suggestedName);
  } catch (error) {
    throw toBackupError(error);
  }
}

export async function pickBackupFile(): Promise<PickedBackup> {
  try {
    return await nativeModule().pickBackup();
  } catch (error) {
    throw toBackupError(error);
  }
}

export async function decryptBackupFile(uri: string, password: string): Promise<string> {
  try {
    return await nativeModule().decryptBackup(uri, password);
  } catch (error) {
    throw toBackupError(error);
  }
}

export async function forgetPickedBackup(): Promise<void> {
  if (!TrackerBackup) return;
  await TrackerBackup.forgetPickedBackup().catch(() => false);
}
