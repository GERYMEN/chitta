import { backupRepository } from '../../data/repositories/backup.repository';
import { CURRENT_SCHEMA_VERSION } from '../../data/db/restoreUpgrade';
import {
  BackupError,
  BackupPayload,
  BackupSummary,
  buildBackupPayload,
  defaultBackupFileName,
  parseBackupJson,
  summarizeBackup,
} from '../../domain/backup/backup.payload';
import { backupPasswordError } from '../../domain/backup/backupPassword';
import {
  decryptBackupFile,
  forgetPickedBackup,
  PickedBackup,
  pickBackupFile,
  saveBackupFile,
} from '../../native/android/backup/backupNative';
import { getFeedbackDeviceInfo } from '../../native/android/feedback/feedbackNative';
import { useSyncRunStore } from '../sms-sync/syncRunner';
import { useBackupStore } from './backupStore';
import { reloadAfterRestore } from './reloadAfterRestore';

/**
 * R4e backup / restore flow (feature layer): DB rows → payload JSON →
 * native encrypt + save; native pick + decrypt → validated payload →
 * one-transaction replace → store reload.
 *
 * Privacy: the password and the JSON are local variables only — never
 * logged, stored, audited or put in an error. Errors are BackupError with
 * fixed messages.
 */

/** The backup JSON for the current database (exported for tests). */
export async function createBackupJson(now: Date = new Date()): Promise<string> {
  const tables = await backupRepository.readAllTables();
  const info = getFeedbackDeviceInfo();
  const payload = buildBackupPayload({
    tables,
    app: { versionName: info.versionName, versionCode: info.versionCode },
    schemaVersion: CURRENT_SCHEMA_VERSION,
    now,
  });
  return JSON.stringify(payload);
}

export type SaveOutcome = { saved: true; name: string } | { saved: false };

/** Settings → Back up data → Save backup file. */
export async function saveBackup(password: string, now: Date = new Date()): Promise<SaveOutcome> {
  if (backupPasswordError(password)) throw new BackupError('io', 'Choose a valid password first.');
  const json = await createBackupJson(now);
  const result = await saveBackupFile(json, password, defaultBackupFileName(now));
  if (!result.saved) return { saved: false };
  await useBackupStore.getState().markBackedUp(now);
  return { saved: true, name: result.name ?? '' };
}

/** Restore step 1: the user picks a file (header checked natively). */
export function pickBackup(): Promise<PickedBackup> {
  if (useSyncRunStore.getState().running) return Promise.reject(new BackupError('busy'));
  return pickBackupFile();
}

export interface OpenedBackup {
  payload: BackupPayload;
  summary: BackupSummary;
}

/** Restore step 2: decrypt with the password and validate the payload. */
export async function openBackup(picked: PickedBackup, password: string): Promise<OpenedBackup> {
  const json = await decryptBackupFile(picked.uri, password);
  const payload = parseBackupJson(json, CURRENT_SCHEMA_VERSION);
  return { payload, summary: summarizeBackup(payload) };
}

/**
 * Restore step 3 (after the user confirmed): replace everything in one
 * transaction, then reload every store. A failure leaves the data unchanged
 * (rolled back) and the stores untouched.
 */
export async function restoreBackup(opened: OpenedBackup, now: Date = new Date()): Promise<void> {
  if (useSyncRunStore.getState().running) throw new BackupError('busy');
  try {
    await backupRepository.replaceAllData(opened.payload, { counts: opened.summary.counts, now });
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('incomplete', 'The backup could not be restored. Your data was not changed.');
  }
  await forgetPickedBackup();
  await reloadAfterRestore();
}

/** Restore abandoned (Back / Cancel). */
export function abandonRestore(): Promise<void> {
  return forgetPickedBackup();
}
