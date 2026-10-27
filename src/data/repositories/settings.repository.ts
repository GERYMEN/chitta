import { getDatabase } from '../db/connection';

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

export const settingsRepository = {
  getValue,
  setValue,
};
