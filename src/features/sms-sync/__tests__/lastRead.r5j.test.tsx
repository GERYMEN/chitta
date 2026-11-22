/** R5j T7 — "Last read N days ago" Home banner. Synthetic dates only. */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  LAST_READ_KEY,
  LAST_READ_STALE_DAYS,
  lastReadLabel,
  lastReadBannerVisible,
  staleReadDays,
} from '../lastRead';
import { useSmsReaderStore } from '../smsReaderStore';
import { runSmsSync } from '../syncRunner';
import { LastReadBanner } from '../../home/components/LastReadBanner';
import { getDatabase } from '../../../data/db/connection';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
const mockSync = jest.fn();
jest.mock('../syncSms', () => ({ syncSms: (...a: unknown[]) => mockSync(...a) }));
jest.mock('../../../native/android/permissions/smsPermission', () => ({
  checkReceiveSmsPermission: jest.fn(async () => false),
  requestReceiveSmsPermission: jest.fn(async () => 'denied'),
  checkSmsPermission: jest.fn(async () => true),
}));
jest.mock('../../../native/android/sms/smsAutoRead', () => ({ setNativeAutoReadEnabled: jest.fn(async () => undefined) }));

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe('staleReadDays', () => {
  it('N is 3: fresh at exactly 3 days, stale beyond it', () => {
    expect(LAST_READ_STALE_DAYS).toBe(3);
    expect(staleReadDays({ lastReadAt: ago(2), lastSyncedAt: null, nowMs: NOW })).toBeNull();
    expect(staleReadDays({ lastReadAt: ago(3), lastSyncedAt: null, nowMs: NOW })).toBeNull();
    expect(staleReadDays({ lastReadAt: ago(3.5), lastSyncedAt: null, nowMs: NOW })).toBe(3);
    expect(staleReadDays({ lastReadAt: ago(10), lastSyncedAt: null, nowMs: NOW })).toBe(10);
  });
  it('falls back to the sync cursor when no read time is stored; unknown = hidden', () => {
    expect(staleReadDays({ lastReadAt: null, lastSyncedAt: ago(7), nowMs: NOW })).toBe(7);
    expect(staleReadDays({ lastReadAt: null, lastSyncedAt: null, nowMs: NOW })).toBeNull();
    expect(staleReadDays({ lastReadAt: 'junk', lastSyncedAt: null, nowMs: NOW })).toBeNull();
  });
  it('a future time (clock moved back) is never stale', () => {
    expect(staleReadDays({ lastReadAt: new Date(NOW + DAY).toISOString(), lastSyncedAt: null, nowMs: NOW })).toBeNull();
  });
  it('label', () => {
    expect(lastReadLabel(4)).toBe('Last read 4 days ago');
  });
});

describe('lastReadBannerVisible', () => {
  const base = { loaded: true, hasOnboarded: true, hasActiveAccounts: true, syncing: false, staleDays: 5 };
  it('shown only when stale, onboarded, has accounts, not mid-sync', () => {
    expect(lastReadBannerVisible(base)).toBe(true);
    expect(lastReadBannerVisible({ ...base, staleDays: null })).toBe(false);
    expect(lastReadBannerVisible({ ...base, hasOnboarded: false })).toBe(false);
    expect(lastReadBannerVisible({ ...base, hasActiveAccounts: false })).toBe(false);
    expect(lastReadBannerVisible({ ...base, syncing: true })).toBe(false);
    expect(lastReadBannerVisible({ ...base, loaded: false })).toBe(false);
  });
});

describe('a successful read stamps the last-read time', () => {
  let db: FakeDb;
  beforeEach(() => {
    db = createFakeDb({});
    (getDatabase as jest.Mock).mockReturnValue(db);
    useSmsReaderStore.setState({ lastReadAt: null });
    mockSync.mockReset();
  });
  const stored = () => db.tables.get('app_settings')?.get(LAST_READ_KEY)?.value;

  it('a completed run writes it (state + setting)', async () => {
    mockSync.mockResolvedValue({ cancelled: false, declined: false });
    await runSmsSync({ kind: 'auto' });
    expect(useSmsReaderStore.getState().lastReadAt).toEqual(expect.any(String));
    expect(stored()).toBe(useSmsReaderStore.getState().lastReadAt);
  });
  it('cancelled / declined runs and failures do not', async () => {
    mockSync.mockResolvedValueOnce({ cancelled: true, declined: false });
    await runSmsSync({});
    mockSync.mockResolvedValueOnce({ cancelled: false, declined: true });
    await runSmsSync({});
    mockSync.mockRejectedValueOnce(new Error('x'));
    await runSmsSync({}).catch(() => undefined);
    expect(useSmsReaderStore.getState().lastReadAt).toBeNull();
    expect(stored()).toBeUndefined();
  });
  it('load() brings the stored value back', async () => {
    db.tables.get('app_settings') ?? db.tables.set('app_settings', new Map());
    db.tables.get('app_settings')!.set(LAST_READ_KEY, { key: LAST_READ_KEY, value: ago(1) });
    await useSmsReaderStore.getState().load();
    expect(useSmsReaderStore.getState().lastReadAt).toBe(ago(1));
  });
});

describe('LastReadBanner', () => {
  it('shows the age and two actions: Sync now, SMS settings', async () => {
    const onSync = jest.fn();
    const onSettings = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<LastReadBanner days={5} onSync={onSync} onOpenSettings={onSettings} />);
    });
    const text = r.root.findAll(n => (n.type as unknown) === 'Text').map(n => ([] as unknown[]).concat(n.props.children).join(''));
    expect(text.join('|')).toContain('Last read 5 days ago');
    const press = (id: string) => r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0].props.onPress();
    press('last-read-sync');
    press('last-read-settings');
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});
