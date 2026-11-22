import { settingsRepository } from '../../../data/repositories/settings.repository';
import { sanitizeAuditMetadata } from '../../../domain/audit/audit.rules';
import {
  NOTIF_BILLS_KEY,
  NOTIF_RECURRING_KEY,
  NOTIF_RECURRING_KEYS_KEY,
  NOTIF_WEEKLY_DAY_KEY,
  NOTIF_WEEKLY_HOUR_KEY,
  NOTIF_WEEKLY_KEY,
  readNotificationSettings,
  readRemindedKeys,
} from '../notificationConfig';
import {
  setNotificationType,
  setRemindedKey,
  setWeeklyDay,
  setWeeklyHour,
} from '../notificationSettings';

const mockCheck = jest.fn();
const mockRequest = jest.fn();
jest.mock('../../../native/android/permissions/notificationPermission', () => ({
  checkNotificationPermission: () => mockCheck(),
  requestNotificationPermission: () => mockRequest(),
}));
const mockReconcile = jest.fn();
jest.mock('../reconcile', () => ({ requestReconcile: () => mockReconcile() }));
jest.mock('../../../data/repositories/settings.repository', () => ({
  settingsRepository: { getValue: jest.fn(), setMany: jest.fn() },
}));

const repo = settingsRepository as unknown as { getValue: jest.Mock; setMany: jest.Mock };
let db: Record<string, string>;
let audits: Array<{ metadata: Record<string, unknown> }>;

beforeEach(() => {
  jest.clearAllMocks();
  db = {};
  audits = [];
  repo.getValue.mockImplementation(async (k: string) => db[k] ?? null);
  repo.setMany.mockImplementation(
    async (entries: ReadonlyArray<readonly [string, string]>, audit: Array<{ metadata: Record<string, unknown> }> = []) => {
      for (const [k, v] of entries) db[k] = v;
      audits.push(...audit);
    },
  );
});

describe('notification settings', () => {
  it('everything defaults OFF; weekly = Sunday 09:00', async () => {
    expect(await readNotificationSettings()).toEqual({
      bills: false,
      recurring: false,
      weekly: false,
      weeklyDay: 0,
      weeklyHour: 9,
    });
    expect(await readRemindedKeys()).toEqual([]);
  });

  it('bad stored values fall back to defaults', async () => {
    db[NOTIF_WEEKLY_DAY_KEY] = '9';
    db[NOTIF_WEEKLY_HOUR_KEY] = 'abc';
    db[NOTIF_RECURRING_KEYS_KEY] = '{not json';
    const s = await readNotificationSettings();
    expect([s.weeklyDay, s.weeklyHour]).toEqual([0, 9]);
    expect(await readRemindedKeys()).toEqual([]);
  });

  it('turning ON asks for the permission first; denied keeps it OFF and writes nothing', async () => {
    mockCheck.mockResolvedValue(false);
    mockRequest.mockResolvedValue('blocked');
    expect(await setNotificationType(NOTIF_BILLS_KEY, true)).toEqual({ ok: false, reason: 'blocked' });
    expect(db[NOTIF_BILLS_KEY]).toBeUndefined();
    expect(audits).toEqual([]);
    expect(mockReconcile).not.toHaveBeenCalled();
    mockRequest.mockResolvedValue('denied');
    expect(await setNotificationType(NOTIF_BILLS_KEY, true)).toEqual({ ok: false, reason: 'denied' });
  });

  it('already granted: no dialog; writes on, audits key + on/off only, then reconciles', async () => {
    mockCheck.mockResolvedValue(true);
    expect(await setNotificationType(NOTIF_WEEKLY_KEY, true)).toEqual({ ok: true });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(db[NOTIF_WEEKLY_KEY]).toBe('on');
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ kind: 'settings_changed', key: NOTIF_WEEKLY_KEY, from: 'off', to: 'on' });
    expect(sanitizeAuditMetadata(audits[0].metadata as never)).toEqual(audits[0].metadata);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  it('turning OFF never asks for permission and reconciles', async () => {
    db[NOTIF_RECURRING_KEY] = 'on';
    expect(await setNotificationType(NOTIF_RECURRING_KEY, false)).toEqual({ ok: true });
    expect(mockCheck).not.toHaveBeenCalled();
    expect(db[NOTIF_RECURRING_KEY]).toBe('off');
    expect(mockReconcile).toHaveBeenCalled();
  });

  it('weekly day / hour: validated, persisted, audited, reconciled', async () => {
    await setWeeklyDay(3);
    await setWeeklyHour(18);
    expect(db[NOTIF_WEEKLY_DAY_KEY]).toBe('3');
    expect(db[NOTIF_WEEKLY_HOUR_KEY]).toBe('18');
    expect(audits.map(a => a.metadata.to)).toEqual(['3', '18']);
    await expect(setWeeklyDay(7)).rejects.toThrow();
    await expect(setWeeklyHour(24)).rejects.toThrow();
    expect(mockReconcile).toHaveBeenCalledTimes(2);
  });

  it('reminded series: add / remove, audit carries counts never the merchant key', async () => {
    await setRemindedKey('qa streamer', true);
    await setRemindedKey('qa streamer', true);
    await setRemindedKey('qa gym', true);
    expect(await readRemindedKeys()).toEqual(['qa streamer', 'qa gym']);
    await setRemindedKey('qa streamer', false);
    expect(await readRemindedKeys()).toEqual(['qa gym']);
    const json = JSON.stringify(audits);
    expect(json).not.toMatch(/qa streamer|qa gym/);
    expect(audits.map(a => [a.metadata.from, a.metadata.to])).toEqual([
      ['0', '1'],
      ['1', '2'],
      ['2', '1'],
    ]);
    expect(mockReconcile).toHaveBeenCalled();
  });
});
