import { settingsRepository } from '../../../data/repositories/settings.repository';
import { sanitizeAuditMetadata } from '../../../domain/audit/audit.rules';
import { describeActivity } from '../../activity/activityFeed';
import {
  APP_LOCK_ENABLED_KEY,
  APP_LOCK_TIMEOUT_KEY,
  disableAppLock,
  enableAppLock,
  getAppLockConfig,
  initSecurityOnLaunch,
  setAppLockTimeout,
} from '../securitySettings';
import { shouldLock } from '../appLock';

const mockCanUse = jest.fn();
jest.mock('../../../native/android/security/securityNative', () => ({
  setNativeSecureScreen: jest.fn(async () => undefined),
}));
jest.mock('../../../native/android/security/biometricNative', () => ({
  canUseAppLock: () => mockCanUse(),
  authenticate: jest.fn(),
}));
jest.mock('../../../data/repositories/settings.repository', () => ({
  settingsRepository: { getValue: jest.fn(), setMany: jest.fn(async () => undefined) },
}));

const repo = settingsRepository as unknown as { getValue: jest.Mock; setMany: jest.Mock };

function seed(values: Record<string, string>) {
  const db = { ...values };
  repo.getValue.mockImplementation(async (key: string) => db[key] ?? null);
  repo.setMany.mockImplementation(async (entries: ReadonlyArray<readonly [string, string]>) => {
    for (const [k, v] of entries) db[k] = v;
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  seed({});
  await initSecurityOnLaunch();
  jest.clearAllMocks();
});

describe('R9b T2 enable guard + keys', () => {
  it('defaults to off / immediate', () => {
    expect(getAppLockConfig()).toEqual({ enabled: false, timeout: 'immediate' });
  });

  it('enabling checks availability, then persists + audits', async () => {
    mockCanUse.mockResolvedValue('available');
    expect(await enableAppLock()).toEqual({ ok: true });
    expect(mockCanUse).toHaveBeenCalledTimes(1);
    expect(repo.setMany).toHaveBeenCalledWith(
      [[APP_LOCK_ENABLED_KEY, 'on']],
      [
        {
          eventType: 'settings_changed',
          actor: 'user',
          metadata: { kind: 'settings_changed', key: 'app_lock_enabled', from: 'off', to: 'on' },
        },
      ],
    );
    expect(getAppLockConfig().enabled).toBe(true);
  });

  it.each(['none_enrolled', 'no_hardware', 'unavailable'] as const)(
    '%s blocks enabling: nothing written',
    async reason => {
      mockCanUse.mockResolvedValue(reason);
      expect(await enableAppLock()).toEqual({ ok: false, reason });
      expect(repo.setMany).not.toHaveBeenCalled();
      expect(getAppLockConfig().enabled).toBe(false);
    },
  );

  it('disable persists + audits and updates the live config', async () => {
    mockCanUse.mockResolvedValue('available');
    await enableAppLock();
    await disableAppLock();
    expect(repo.setMany).toHaveBeenLastCalledWith(
      [[APP_LOCK_ENABLED_KEY, 'off']],
      [expect.objectContaining({ metadata: expect.objectContaining({ from: 'on', to: 'off' }) })],
    );
    expect(getAppLockConfig().enabled).toBe(false);
  });

  it('timeout persists + audits; a failed write leaves the live value', async () => {
    await setAppLockTimeout('5');
    expect(repo.setMany).toHaveBeenCalledWith(
      [[APP_LOCK_TIMEOUT_KEY, '5']],
      [
        {
          eventType: 'settings_changed',
          actor: 'user',
          metadata: { kind: 'settings_changed', key: 'app_lock_timeout', from: 'immediate', to: '5' },
        },
      ],
    );
    expect(getAppLockConfig().timeout).toBe('5');
    repo.setMany.mockRejectedValueOnce(new Error('db'));
    await expect(setAppLockTimeout('1')).rejects.toThrow();
    expect(getAppLockConfig().timeout).toBe('5');
  });

  it('launch loads saved config; an unknown timeout falls back to immediate', async () => {
    seed({ [APP_LOCK_ENABLED_KEY]: 'on', [APP_LOCK_TIMEOUT_KEY]: '5' });
    await initSecurityOnLaunch();
    expect(getAppLockConfig()).toEqual({ enabled: true, timeout: '5' });
    seed({ [APP_LOCK_ENABLED_KEY]: 'on', [APP_LOCK_TIMEOUT_KEY]: '99' });
    await initSecurityOnLaunch();
    expect(getAppLockConfig().timeout).toBe('immediate');
  });

  it('keys survive audit sanitising and read as plain sentences', () => {
    const cases: Array<[string, string, string]> = [
      ['app_lock_enabled', 'on', 'You turned on App lock'],
      ['app_lock_enabled', 'off', 'You turned off App lock'],
      ['app_lock_timeout', '5', 'You set App lock to ask after 5 minutes away'],
      ['app_lock_timeout', '1', 'You set App lock to ask after 1 minute away'],
      ['app_lock_timeout', 'immediate', 'You set App lock to ask every time you leave the app'],
    ];
    for (const [key, to, sentence] of cases) {
      const metadata = sanitizeAuditMetadata({
        kind: 'settings_changed',
        key: key as 'app_lock_enabled',
        from: 'off',
        to,
      });
      expect(metadata).toEqual({ kind: 'settings_changed', key, from: 'off', to });
      const item = describeActivity({
        id: 'a1',
        seq: 1,
        transactionId: null,
        accountId: null,
        eventType: 'settings_changed',
        actor: 'user',
        eventAt: '2026-11-20T10:00:00.000Z',
        metadata,
        deletedSnapshot: null,
      });
      expect(item.sentence).toBe(sentence);
    }
  });
});

describe('R9b T3 shouldLock', () => {
  const MIN = 60_000;
  it('never locks when disabled', () => {
    expect(shouldLock(false, 'immediate', null, 1000, true)).toBe(false);
    expect(shouldLock(false, '1', 0, 10 * MIN, false)).toBe(false);
  });
  it('cold launch locks when enabled', () => {
    expect(shouldLock(true, '5', null, 0, true)).toBe(true);
  });
  it('no background timestamp and not cold: stays unlocked', () => {
    expect(shouldLock(true, 'immediate', null, 5000, false)).toBe(false);
  });
  it('immediate locks on any background', () => {
    expect(shouldLock(true, 'immediate', 1000, 1000, false)).toBe(true);
  });
  it('timed: locks at or past the threshold, not before', () => {
    expect(shouldLock(true, '1', 0, MIN - 1, false)).toBe(false);
    expect(shouldLock(true, '1', 0, MIN, false)).toBe(true);
    expect(shouldLock(true, '5', 0, 5 * MIN - 1, false)).toBe(false);
    expect(shouldLock(true, '5', 0, 5 * MIN, false)).toBe(true);
  });
  it('a clock that went backwards fails safe (locks)', () => {
    expect(shouldLock(true, '5', 10 * MIN, 1 * MIN, false)).toBe(true);
  });
});
