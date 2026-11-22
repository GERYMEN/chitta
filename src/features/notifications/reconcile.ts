import { AppState } from 'react-native';
import { billRepository } from '../../data/repositories/bill.repository';
import { detectRecurring } from '../../domain/recurring/recurring.rules';
import { buildScheduledNotifications } from '../../domain/notifications/notifications.rules';
import { cancelNotifications, scheduleNotifications } from '../../native/android/notifications/notificationNative';
import { checkNotificationPermission } from '../../native/android/permissions/notificationPermission';
import { isRedacted, useRedactionStore } from '../../shared/privacy/redaction';
import { useBillsStore } from '../bills/state/billsStore';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { anyNotificationOn, readNotificationSettings, readRemindedKeys } from './notificationConfig';

/**
 * R8b: recompute what to notify (pure planner) and hand native the full set.
 * Native cancels every app-owned alarm first and then schedules exactly this
 * set, so nothing goes stale (a paid bill's reminder disappears on the next run).
 */
export const RECONCILE_DEBOUNCE_MS = 1500;

export type ReconcileOutcome = 'scheduled' | 'cleared' | 'skipped';

export async function reconcileNotifications(): Promise<ReconcileOutcome> {
  try {
    const tx = useTransactionsStore.getState();
    // Not loaded yet: planning from empty data would wrongly clear the alarms.
    if (!tx.isHydrated) return 'skipped';
    const settings = await readNotificationSettings();
    if (!anyNotificationOn(settings) || !(await checkNotificationPermission())) {
      await cancelNotifications();
      return 'cleared';
    }
    const [bills, remindedKeys] = await Promise.all([
      settings.bills ? billRepository.listAll() : Promise.resolve([]),
      settings.recurring ? readRemindedKeys() : Promise.resolve([]),
    ]);
    const now = new Date();
    const transactions = useTransactionsStore.getState().transactions;
    const recurring = remindedKeys.length > 0 ? detectRecurring(transactions, now) : [];
    const items = buildScheduledNotifications({
      bills,
      recurring,
      remindedKeys,
      transactions,
      settings,
      now,
      hideAmounts: isRedacted(),
    });
    await scheduleNotifications(items);
    return 'scheduled';
  } catch {
    return 'skipped';
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;

async function run(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    await reconcileNotifications();
  } finally {
    running = false;
    if (again) {
      again = false;
      requestReconcile();
    }
  }
}

/** Debounced trigger: a burst of changes (a sync adding rows) runs once. */
export function requestReconcile(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    run().catch(() => undefined);
  }, RECONCILE_DEBOUNCE_MS);
}

/**
 * Trigger points: app launch (once hydrated), every return to foreground,
 * transactions changing (a sync or an edit), bills changing, Private mode
 * flipping. Setting/toggle changes call requestReconcile() themselves.
 */
export function startNotificationReconciler(): () => void {
  requestReconcile();
  const appState = AppState.addEventListener('change', status => {
    if (status === 'active') requestReconcile();
  });
  const unsubTx = useTransactionsStore.subscribe((state, prev) => {
    if (state.transactions !== prev.transactions || state.isHydrated !== prev.isHydrated) requestReconcile();
  });
  const unsubBills = useBillsStore.subscribe((state, prev) => {
    if (state.bills !== prev.bills) requestReconcile();
  });
  const unsubRedaction = useRedactionStore.subscribe((state, prev) => {
    if (state.redacted !== prev.redacted) requestReconcile();
  });
  return () => {
    appState.remove();
    unsubTx();
    unsubBills();
    unsubRedaction();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
