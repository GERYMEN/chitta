/**
 * R5d T1 (O1): the per-install SMS identity salt — generated once from the
 * native SecureRandom, kept in app_settings, carried by backups.
 */
import { getDatabase } from '../../../data/db/connection';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { DEVICE_LOCAL_SETTING_KEYS } from '../../../domain/backup/backup.tables';
import { loadSmsIdentitySalt, SMS_IDENTITY_SALT_KEY } from '../smsIdentitySalt';
import { randomBytesHex } from '../../../native/android/backup/backupNative';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn() }));
jest.mock('../../../native/android/backup/backupNative', () => ({ randomBytesHex: jest.fn() }));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const mockRandom = randomBytesHex as jest.MockedFunction<typeof randomBytesHex>;
let db: FakeDb;

beforeEach(() => {
  db = createFakeDb();
  mockGetDatabase.mockReturnValue(db as never);
  mockRandom.mockReset();
});

describe('loadSmsIdentitySalt', () => {
  it('generates 32 random bytes once and stores them under sms_identity_salt', async () => {
    mockRandom.mockResolvedValueOnce('a1'.repeat(32));
    const first = await loadSmsIdentitySalt();
    const second = await loadSmsIdentitySalt();
    expect(first).toBe('a1'.repeat(32));
    expect(second).toBe(first);
    expect(mockRandom).toHaveBeenCalledTimes(1);
    expect(mockRandom).toHaveBeenCalledWith(32);
    expect(db.tables.get('app_settings')!.get(SMS_IDENTITY_SALT_KEY)!.value).toBe(first);
  });

  it('uses a restored salt as-is (never regenerates it)', async () => {
    db = createFakeDb({ app_settings: [{ key: SMS_IDENTITY_SALT_KEY, value: 'b2'.repeat(32) }] });
    mockGetDatabase.mockReturnValue(db as never);
    await expect(loadSmsIdentitySalt()).resolves.toBe('b2'.repeat(32));
    expect(mockRandom).not.toHaveBeenCalled();
  });

  it('falls back to WebCrypto when the native module is missing (tests / no native)', async () => {
    mockRandom.mockRejectedValueOnce(new Error('io'));
    const salt = await loadSmsIdentitySalt();
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is backed up: the key is not device-local', () => {
    expect(DEVICE_LOCAL_SETTING_KEYS).not.toContain(SMS_IDENTITY_SALT_KEY);
  });

  it('writes the salt with a parameter (never interpolated) and no audit row', async () => {
    mockRandom.mockResolvedValueOnce('c3'.repeat(32));
    await loadSmsIdentitySalt();
    const insert = db.calls.find(c => /INTO app_settings/.test(c.sql))!;
    expect(insert.sql).not.toContain('c3c3');
    expect(db.auditInserts()).toHaveLength(0);
  });
});
