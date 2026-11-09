import { getDatabase } from '../../data/db/connection';
import { randomBytesHex } from '../../native/android/backup/backupNative';

/**
 * R5d T1 (owner decision O1, 2026-11-08) — the per-install SMS identity salt.
 *
 * 32 random bytes (64 hex chars) from the native SecureRandom
 * (BackupModule.randomBytes), generated ONCE and kept in app_settings under
 * `sms_identity_salt`. It is NOT a device-local key, so it rides inside the
 * encrypted backup: a restore on a new phone brings the same salt back
 * before any sync runs (the restore replaces app_settings, and every sync
 * reads the salt fresh from the database), and the restored content hashes
 * keep deduping. The salt never leaves the app otherwise and is never logged.
 */
export const SMS_IDENTITY_SALT_KEY = 'sms_identity_salt';
export const SMS_IDENTITY_SALT_BYTES = 32;

const SALT_RE = /^[0-9a-f]{16,128}$/;

/** The stored value: a valid salt, 'invalid' (a damaged row), or null (none). */
async function readSalt(): Promise<string | 'invalid' | null> {
  const result = await getDatabase().execute('SELECT * FROM app_settings WHERE key = ?', [
    SMS_IDENTITY_SALT_KEY,
  ]);
  if (result.rows.length === 0) return null;
  const value = String((result.rows[0] as Record<string, unknown>).value);
  return SALT_RE.test(value) ? value : 'invalid';
}

/** WebCrypto CSPRNG (jest / any host without the native module). */
function webCryptoHex(count: number): string {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('No secure random source');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(count));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function newSalt(): Promise<string> {
  try {
    return await randomBytesHex(SMS_IDENTITY_SALT_BYTES);
  } catch {
    return webCryptoHex(SMS_IDENTITY_SALT_BYTES);
  }
}

/**
 * The salt, created on first use. INSERT OR IGNORE + re-read: if two callers
 * race, both end up with the one row that won.
 */
export async function loadSmsIdentitySalt(): Promise<string> {
  const existing = await readSalt();
  if (existing != null && existing !== 'invalid') return existing;
  const salt = await newSalt();
  // A damaged row is replaced; otherwise the first writer wins.
  const verb = existing === 'invalid' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  await getDatabase().execute(`${verb} INTO app_settings (key, value) VALUES (?, ?)`, [
    SMS_IDENTITY_SALT_KEY,
    salt,
  ]);
  const stored = await readSalt();
  return stored != null && stored !== 'invalid' ? stored : salt;
}
