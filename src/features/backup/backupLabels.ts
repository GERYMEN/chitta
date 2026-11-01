import { formatDayMonthYear } from '../insights/insightLabels';
import type { BackupSummary } from '../../domain/backup/backup.payload';

/** R4e copy. Counts and dates only — never row content. */
export const BACKUP_SAVED_MESSAGE = 'Backup saved';
export const BACKUP_RESTORED_MESSAGE = 'Backup restored';
export const FORGOT_PASSWORD_WARNING = "If you forget this password the backup can't be opened.";
export const RESTORE_REPLACES_WARNING =
  "Restoring replaces everything in Tracker on this phone with the backup. This can't be undone.";

/** Settings row caption under "Back up data". */
export function lastBackupLabel(lastBackupAt: string | null): string {
  return lastBackupAt
    ? `Last backup: ${formatDayMonthYear(new Date(lastBackupAt))}`
    : 'No backup saved on this phone yet';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Restore confirm dialog message. */
export function restoreConfirmMessage(summary: BackupSummary): string {
  const date = formatDayMonthYear(new Date(summary.createdAt));
  return `Replace all data in Tracker with this backup (${date}, ${plural(
    summary.transactions,
    'transaction',
  )}, ${plural(summary.accounts, 'account')})?`;
}
