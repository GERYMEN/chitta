import { settingsRepository } from '../../data/repositories/settings.repository';
import {
  DEFAULT_WEEKLY_DAY,
  DEFAULT_WEEKLY_HOUR,
  NotificationSettings,
} from '../../domain/notifications/notifications.rules';

/**
 * R8b: persisted notification preferences (app_settings, no migration).
 * Toggles are 'on' | 'off', all default OFF. `notif_recurring_keys` holds a
 * JSON array of the merchant keys the user asked "Remind me?" for.
 */
export const NOTIF_BILLS_KEY = 'notif_bills';
export const NOTIF_RECURRING_KEY = 'notif_recurring';
export const NOTIF_WEEKLY_KEY = 'notif_weekly';
export const NOTIF_WEEKLY_DAY_KEY = 'notif_weekly_day';
export const NOTIF_WEEKLY_HOUR_KEY = 'notif_weekly_hour';
export const NOTIF_RECURRING_KEYS_KEY = 'notif_recurring_keys';

export type NotificationTypeKey =
  | typeof NOTIF_BILLS_KEY
  | typeof NOTIF_RECURRING_KEY
  | typeof NOTIF_WEEKLY_KEY;

async function read(key: string): Promise<string | null> {
  return settingsRepository.getValue(key).catch(() => null);
}

function intInRange(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw == null || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return n >= min && n <= max ? n : fallback;
}

export async function readNotificationSettings(): Promise<NotificationSettings> {
  const [bills, recurring, weekly, day, hour] = await Promise.all([
    read(NOTIF_BILLS_KEY),
    read(NOTIF_RECURRING_KEY),
    read(NOTIF_WEEKLY_KEY),
    read(NOTIF_WEEKLY_DAY_KEY),
    read(NOTIF_WEEKLY_HOUR_KEY),
  ]);
  return {
    bills: bills === 'on',
    recurring: recurring === 'on',
    weekly: weekly === 'on',
    weeklyDay: intInRange(day, 0, 6, DEFAULT_WEEKLY_DAY),
    weeklyHour: intInRange(hour, 0, 23, DEFAULT_WEEKLY_HOUR),
  };
}

export async function readRemindedKeys(): Promise<string[]> {
  const raw = await read(NOTIF_RECURRING_KEYS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function anyNotificationOn(s: NotificationSettings): boolean {
  return s.bills || s.recurring || s.weekly;
}
