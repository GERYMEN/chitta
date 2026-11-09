/**
 * R5-fix U11 / C10 — the auto-read runtime path: runner, kind mapping into
 * syncSms, setAutoRead, and the hydrate / restore serialisation. No SMS
 * content is involved (syncSms is mocked; the runner never sees a body).
 */
const mockSyncSms = jest.fn();
const mockEstimate = jest.fn(async () => 3);
jest.mock('../../syncSms', () => ({
  syncSms: (options: unknown) => mockSyncSms(options),
  estimateWindowCount: () => mockEstimate(),
  currentSyncWindow: () => ({ sinceMs: 0, beforeMs: 1 }),
}));

const mockPerms = { read: true, receive: true, requestReceive: 'granted' as string };
jest.mock('../../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => mockPerms.read),
  checkReceiveSmsPermission: jest.fn(async () => mockPerms.receive),
  requestReceiveSmsPermission: jest.fn(async () => mockPerms.requestReceive),
}));

const mockSetNative = jest.fn(async (_on: boolean) => undefined);
jest.mock('../../../../native/android/sms/smsAutoRead', () => ({
  setNativeAutoReadEnabled: (on: boolean) => mockSetNative(on),
  subscribeSmsReceived: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockSetMany = jest.fn(async () => undefined);
jest.mock('../../../../data/repositories/settings.repository', () => ({
  settingsRepository: {
    getValue: jest.fn(async () => null),
    setValue: jest.fn(async () => undefined),
    setMany: (...args: unknown[]) => mockSetMany(...(args as [])),
  },
}));
jest.mock('../../../../data/repositories/smsUnparsed.repository', () => ({
  smsUnparsedRepository: { listOpen: jest.fn(async () => []) },
}));
jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));

import { runAutoRead } from '../autoReadRunner';
import { useSyncRunStore } from '../../syncRunner';
import { useSmsReaderStore } from '../../smsReaderStore';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';
import { Account } from '../../../../domain/accounts/account.types';

const ACCOUNT: Account = {
  id: 'acc-qa',
  name: 'QA Bank',
  type: 'bank',
  lastFour: '4242',
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const RESULT = {
  scanned: 2, created: 1, uncategorised: 0, skipped: 1, autoApproved: 0, heldForTransfer: 0,
  heldForDuplicate: 0, cancelled: false, declined: false, notUnderstood: 1, suggestions: [], suggestionRunId: 'r',
};

beforeEach(() => {
  mockSyncSms.mockReset().mockResolvedValue(RESULT);
  mockSetNative.mockClear();
  mockSetMany.mockClear();
  mockPerms.read = true;
  mockPerms.receive = true;
  mockPerms.requestReceive = 'granted';
  useSyncRunStore.setState({ running: false, restoring: false });
  useSmsReaderStore.setState({ loaded: true, autoReadSetting: 'on', receiveGranted: true });
  useTransactionsStore.setState({ isHydrated: true, hasOnboarded: true, accounts: [ACCOUNT] });
});

describe('runAutoRead', () => {
  it("runs the normal incremental sync as kind 'auto' with no permission prompt and no dialogs", async () => {
    const out = await runAutoRead();
    expect(out).toEqual({ kind: 'done', created: 1, notUnderstood: 1 });
    expect(mockSyncSms).toHaveBeenCalledTimes(1);
    const options = mockSyncSms.mock.calls[0][0];
    expect(options.kind).toBe('auto');
    expect(options.requestPermission).toBe(false);
    expect(options.window).toBeUndefined();
    expect(options.confirmLargeScan).toBeUndefined();
  });

  it('skips when auto-read is off, a permission is missing, or the window is large', async () => {
    useSmsReaderStore.setState({ autoReadSetting: 'off' });
    expect((await runAutoRead()).kind).toBe('skipped');
    useSmsReaderStore.setState({ autoReadSetting: 'on' });
    mockPerms.receive = false;
    expect((await runAutoRead()).kind).toBe('skipped');
    mockPerms.receive = true;
    mockEstimate.mockResolvedValueOnce(100_000);
    expect((await runAutoRead()).kind).toBe('skipped');
    expect(mockSyncSms).not.toHaveBeenCalled();
  });

  it('busy while a manual sync runs; failed when the sync throws', async () => {
    useSyncRunStore.setState({ running: true });
    expect(await runAutoRead()).toEqual({ kind: 'busy' });
    useSyncRunStore.setState({ running: false });
    mockSyncSms.mockRejectedValueOnce(new Error('x'));
    expect(await runAutoRead()).toEqual({ kind: 'failed' });
  });

  it('C10: never runs while a backup restore replaces the data', async () => {
    useSyncRunStore.setState({ restoring: true });
    expect(await runAutoRead()).toEqual({ kind: 'busy' });
    expect(mockSyncSms).not.toHaveBeenCalled();
  });

  it('C10: runSmsSync refuses to start while restoring (any kind)', async () => {
    const { runSmsSync } = require('../../syncRunner');
    useSyncRunStore.setState({ restoring: true });
    expect(await runSmsSync({ kind: 'manual' })).toBeNull();
    expect(await runSmsSync({ kind: 'auto' })).toBeNull();
    expect(mockSyncSms).not.toHaveBeenCalled();
  });

  it('C10: waits for the launch hydrate and shares it (one reload, not two)', async () => {
    const reload = jest.fn(async () => undefined);
    useTransactionsStore.setState({ isHydrated: false, reloadFromDatabase: reload });
    const launch = useTransactionsStore.getState().hydrate();
    const auto = runAutoRead();
    await Promise.all([launch, auto]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mockSyncSms).toHaveBeenCalledTimes(1);
    // The sync started only after the store was hydrated.
    expect(useTransactionsStore.getState().isHydrated).toBe(true);
  });
});

describe('setAutoRead', () => {
  it('on: asks RECEIVE_SMS when missing, saves, audits off→on, mirrors the native flag', async () => {
    useSmsReaderStore.setState({ autoReadSetting: 'off', receiveGranted: false });
    mockPerms.receive = false;
    expect(await useSmsReaderStore.getState().setAutoRead(true)).toBe('on');
    expect(mockSetNative).toHaveBeenLastCalledWith(true);
    expect(mockSetMany).toHaveBeenCalledWith(
      [['sms_auto_read', 'on']],
      [expect.objectContaining({ eventType: 'settings_changed', metadata: expect.objectContaining({ from: 'off', to: 'on' }) })],
    );
  });

  it('on but RECEIVE_SMS denied / blocked: stays off, no native flag', async () => {
    useSmsReaderStore.setState({ autoReadSetting: 'off', receiveGranted: false });
    mockPerms.receive = false;
    mockPerms.requestReceive = 'never_ask_again';
    expect(await useSmsReaderStore.getState().setAutoRead(true)).toBe('blocked');
    mockPerms.requestReceive = 'denied';
    expect(await useSmsReaderStore.getState().setAutoRead(true)).toBe('denied');
    expect(mockSetNative).not.toHaveBeenCalled();
  });

  it('off: saves, audits on→off, clears the native flag', async () => {
    expect(await useSmsReaderStore.getState().setAutoRead(false)).toBe('off');
    expect(mockSetNative).toHaveBeenLastCalledWith(false);
    expect(useSmsReaderStore.getState().autoReadSetting).toBe('off');
  });
});
