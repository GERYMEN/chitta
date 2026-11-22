import { Bill } from '../../../domain/bills/bill.types';
import { setRedacted } from '../../../shared/privacy/redaction';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { reconcileNotifications, requestReconcile, RECONCILE_DEBOUNCE_MS } from '../reconcile';

const mockSchedule = jest.fn(async (_items: unknown) => undefined);
const mockCancel = jest.fn(async () => undefined);
jest.mock('../../../native/android/notifications/notificationNative', () => ({
  scheduleNotifications: (items: unknown) => mockSchedule(items),
  cancelNotifications: () => mockCancel(),
}));
const mockGranted = jest.fn();
jest.mock('../../../native/android/permissions/notificationPermission', () => ({
  checkNotificationPermission: () => mockGranted(),
}));
const mockConfig = jest.fn();
const mockKeys = jest.fn();
jest.mock('../notificationConfig', () => ({
  readNotificationSettings: () => mockConfig(),
  readRemindedKeys: () => mockKeys(),
  anyNotificationOn: (s: { bills: boolean; recurring: boolean; weekly: boolean }) =>
    s.bills || s.recurring || s.weekly,
}));
const mockBills = jest.fn();
jest.mock('../../../data/repositories/bill.repository', () => ({
  billRepository: { listAll: () => mockBills() },
}));

const NOW = new Date(2026, 10, 20, 10, 0);
const iso = (d: number) => new Date(2026, 10, d, 12).toISOString();
const ALL_OFF = { bills: false, recurring: false, weekly: false, weeklyDay: 0, weeklyHour: 9 };

function bill(p: Partial<Bill> = {}): Bill {
  return {
    id: 'b1',
    accountId: null,
    kind: 'manual',
    payee: 'QA Biller',
    amountDueMinor: 150000,
    minDueMinor: null,
    statementDate: null,
    dueDate: iso(22),
    status: 'open',
    paidMinor: 0,
    paidTransactionId: null,
    source: 'manual',
    sourceHash: null,
    repeat: 'none',
    createdAt: iso(1),
    updatedAt: iso(1),
    ...p,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  setRedacted(false);
  mockGranted.mockResolvedValue(true);
  mockConfig.mockResolvedValue({ ...ALL_OFF, bills: true });
  mockKeys.mockResolvedValue([]);
  mockBills.mockResolvedValue([bill()]);
  useTransactionsStore.setState({ isHydrated: true, transactions: [] });
});
afterEach(() => jest.useRealTimers());

describe('reconcileNotifications', () => {
  it('every toggle off: cancels the app-owned alarms, schedules nothing', async () => {
    mockConfig.mockResolvedValue(ALL_OFF);
    expect(await reconcileNotifications()).toBe('cleared');
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('permission missing: cancels instead of scheduling', async () => {
    mockGranted.mockResolvedValue(false);
    expect(await reconcileNotifications()).toBe('cleared');
    expect(mockCancel).toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('schedules the planner output (native replaces the old set)', async () => {
    expect(await reconcileNotifications()).toBe('scheduled');
    const items = mockSchedule.mock.calls[0][0] as Array<{ id: string; body: string }>;
    expect(items.map(i => i.id)).toEqual(['bill:b1']);
    expect(items[0].body).toContain('QA Biller bill is due');
  });

  it('a bill paid since the last run is dropped from the new set', async () => {
    await reconcileNotifications();
    mockBills.mockResolvedValue([bill({ status: 'paid', paidMinor: 150000 })]);
    await reconcileNotifications();
    expect(mockSchedule.mock.calls[1][0]).toEqual([]);
  });

  it('Private mode on: the scheduled text carries no amount or name', async () => {
    setRedacted(true);
    await reconcileNotifications();
    const json = JSON.stringify(mockSchedule.mock.calls[0][0]);
    expect(json).not.toMatch(/₹|QA Biller/);
  });

  it('does nothing before the store is hydrated (no clobbering with empty data)', async () => {
    useTransactionsStore.setState({ isHydrated: false });
    expect(await reconcileNotifications()).toBe('skipped');
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('never throws when native fails', async () => {
    mockSchedule.mockRejectedValueOnce(new Error('boom'));
    await expect(reconcileNotifications()).resolves.toBe('skipped');
  });
});

describe('requestReconcile', () => {
  it('coalesces a burst into one run', async () => {
    requestReconcile();
    requestReconcile();
    requestReconcile();
    await jest.advanceTimersByTimeAsync(RECONCILE_DEBOUNCE_MS + 50);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });
});
