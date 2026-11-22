import { NativeModules } from 'react-native';
import { ScheduledItem } from '../../../domain/notifications/notifications.rules';

/**
 * R8b: typed wrapper around the own native `TrackerNotifications` module
 * (android/app/src/main/java/com/tracker/NotificationModule.kt). The native
 * side stores the items in SharedPreferences, sets one INEXACT alarm per item
 * and a receiver posts the pre-built text at fire time (no JS needed then).
 * Items carry only the text built by the planner — never SMS text.
 */
interface NotificationNativeModule {
  /** Cancels every app-owned alarm, then schedules exactly these items. */
  scheduleAll(itemsJson: string): Promise<number>;
  cancelAll(): Promise<boolean>;
}

const { TrackerNotifications } = NativeModules as {
  TrackerNotifications?: NotificationNativeModule;
};

export async function scheduleNotifications(items: ReadonlyArray<ScheduledItem>): Promise<void> {
  if (!TrackerNotifications) return;
  await TrackerNotifications.scheduleAll(JSON.stringify(items));
}

export async function cancelNotifications(): Promise<void> {
  if (!TrackerNotifications) return;
  await TrackerNotifications.cancelAll();
}
