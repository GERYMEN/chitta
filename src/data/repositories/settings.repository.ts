import { getDatabase } from '../db/connection';
import { AuditEventInput } from '../../domain/audit/audit.types';
import { auditRepository } from './audit.repository';

async function getValue(key: string): Promise<string | null> {
  const result = await getDatabase().execute(
    'SELECT value FROM app_settings WHERE key = ?',
    [key],
  );
  return result.rows.length > 0 ? String(result.rows[0].value) : null;
}

async function setValue(key: string, value: string): Promise<void> {
  await getDatabase().execute(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
    [key, value],
  );
}

/**
 * Write several settings and their audit events in ONE transaction, so a
 * saved approval-settings change and its `settings_changed` rows land
 * together or not at all.
 */
async function setMany(
  entries: ReadonlyArray<readonly [key: string, value: string]>,
  audit: ReadonlyArray<AuditEventInput> = [],
): Promise<void> {
  if (entries.length === 0 && audit.length === 0) return;
  await getDatabase().transaction(async tx => {
    for (const [key, value] of entries) {
      await tx.execute('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
        key,
        value,
      ]);
    }
    for (const event of audit) {
      await auditRepository.insert(tx, event);
    }
  });
}

export const settingsRepository = {
  getValue,
  setValue,
  setMany,
};
