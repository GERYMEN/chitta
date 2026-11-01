import { create } from 'zustand';
import { settingsRepository } from '../../data/repositories/settings.repository';

/**
 * R4e: when this phone last saved a backup (`last_backup_at`, ISO). It is a
 * device-local setting: never written into a backup and never overwritten
 * by a restore. Plain app_settings row, not audited.
 */
export const LAST_BACKUP_AT_KEY = 'last_backup_at';

interface BackupState {
  lastBackupAt: string | null;
  load: () => Promise<void>;
  markBackedUp: (at: Date) => Promise<void>;
}

export const useBackupStore = create<BackupState>(set => ({
  lastBackupAt: null,
  load: async () => {
    const value = await settingsRepository.getValue(LAST_BACKUP_AT_KEY).catch(() => null);
    set({ lastBackupAt: value && !Number.isNaN(Date.parse(value)) ? value : null });
  },
  markBackedUp: async at => {
    const iso = at.toISOString();
    await settingsRepository.setValue(LAST_BACKUP_AT_KEY, iso);
    set({ lastBackupAt: iso });
  },
}));
