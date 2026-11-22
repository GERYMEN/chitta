import { AuditedSettingKey } from '../../domain/audit/audit.types';
import { settingsRepository } from '../../data/repositories/settings.repository';
import {
  checkNotificationPermission,
  NotificationPermissionResult,
  requestNotificationPermission,
} from '../../native/android/permissions/notificationPermission';
import {
  NOTIF_RECURRING_KEYS_KEY,
  NOTIF_WEEKLY_DAY_KEY,
  NOTIF_WEEKLY_HOUR_KEY,
  NotificationTypeKey,
  readRemindedKeys,
} from './notificationConfig';
import { requestReconcile } from './reconcile';

/**
 * R8b: writers for the notification preferences. Every change is ONE
 * transaction (value + `settings_changed` audit: key and from/to enums or
 * numbers only — never a merchant key, payee or amount) and then asks for a
 * reconcile so the scheduled alarms follow.
 */
async function write(
  key: string,
  value: string,
  audit: { key: AuditedSettingKey; from: string; to: string },
): Promise<void> {
  await settingsRepository.setMany(
    [[key, value]],
    audit.from === audit.to
      ? []
      : [
          {
            eventType: 'settings_changed',
            actor: 'user',
            metadata: { kind: 'settings_changed', key: audit.key, from: audit.from, to: audit.to },
          },
        ],
  );
}

export type SetNotificationTypeResult =
  | { ok: true }
  | { ok: false; reason: Exclude<NotificationPermissionResult, 'granted'> };

/**
 * Turning a type ON first makes sure POST_NOTIFICATIONS is granted (the system
 * dialog appears here, never at launch). Denied/blocked: nothing is written, so
 * the toggle stays OFF. Turning OFF never asks.
 */
export async function setNotificationType(
  key: NotificationTypeKey,
  on: boolean,
): Promise<SetNotificationTypeResult> {
  if (on && !(await checkNotificationPermission())) {
    const result = await requestNotificationPermission();
    if (result !== 'granted') return { ok: false, reason: result };
  }
  const before = (await settingsRepository.getValue(key).catch(() => null)) === 'on';
  const to = on ? 'on' : 'off';
  await write(key, to, { key, from: before ? 'on' : 'off', to });
  requestReconcile();
  return { ok: true };
}

export async function setWeeklyDay(day: number): Promise<void> {
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('invalid weekday');
  const before = await settingsRepository.getValue(NOTIF_WEEKLY_DAY_KEY).catch(() => null);
  await write(NOTIF_WEEKLY_DAY_KEY, String(day), {
    key: NOTIF_WEEKLY_DAY_KEY,
    from: before ?? '0',
    to: String(day),
  });
  requestReconcile();
}

export async function setWeeklyHour(hour: number): Promise<void> {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('invalid hour');
  const before = await settingsRepository.getValue(NOTIF_WEEKLY_HOUR_KEY).catch(() => null);
  await write(NOTIF_WEEKLY_HOUR_KEY, String(hour), {
    key: NOTIF_WEEKLY_HOUR_KEY,
    from: before ?? '9',
    to: String(hour),
  });
  requestReconcile();
}

/** "Remind me?" opt-in for one series. The audit records only the count of reminded series. */
export async function setRemindedKey(merchantKey: string, on: boolean): Promise<void> {
  const keys = await readRemindedKeys();
  if (keys.includes(merchantKey) === on) return;
  const next = on ? [...keys, merchantKey] : keys.filter(k => k !== merchantKey);
  await write(NOTIF_RECURRING_KEYS_KEY, JSON.stringify(next), {
    key: 'notif_recurring_series',
    from: String(keys.length),
    to: String(next.length),
  });
  requestReconcile();
}
