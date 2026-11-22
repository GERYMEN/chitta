import { create } from 'zustand';
import { readNotificationSettings, readRemindedKeys, NOTIF_RECURRING_KEY } from '../notificationConfig';
import { setNotificationType, setRemindedKey, SetNotificationTypeResult } from '../notificationSettings';

/**
 * R8b (D-d): which recurring series the user asked "Remind me?" for. The
 * persisted truth is the `notif_recurring_keys` setting; this store mirrors it
 * for the Upcoming screen.
 */
interface RemindersState {
  keys: string[];
  load: () => Promise<void>;
  /**
   * Turn the reminder for one series on/off. Turning ON also switches the
   * recurring-reminders type on (asking for notification permission if needed).
   */
  toggle: (merchantKey: string, on: boolean) => Promise<SetNotificationTypeResult>;
}

export const useRemindersStore = create<RemindersState>((set, get) => ({
  keys: [],
  load: async () => {
    set({ keys: await readRemindedKeys() });
  },
  toggle: async (merchantKey, on) => {
    if (on) {
      const settings = await readNotificationSettings();
      if (!settings.recurring) {
        const result = await setNotificationType(NOTIF_RECURRING_KEY, true);
        if (!result.ok) return result;
      }
    }
    await setRemindedKey(merchantKey, on);
    await get().load();
    return { ok: true };
  },
}));
