import { PermissionsAndroid, Platform } from 'react-native';

/**
 * R8b: POST_NOTIFICATIONS is a runtime permission only on Android 13+ (API 33);
 * below that it is granted at install. Asked ONLY when the user turns on their
 * first notification type (never at launch).
 */
export type NotificationPermissionResult = 'granted' | 'denied' | 'blocked';

export const NOTIFICATION_PERMISSION_API = 33;
const PERMISSION = 'android.permission.POST_NOTIFICATIONS' as const;

export function needsRuntimePermission(apiLevel: number): boolean {
  return apiLevel >= NOTIFICATION_PERMISSION_API;
}

function currentApiLevel(): number {
  return typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
}

export async function checkNotificationPermission(): Promise<boolean> {
  if (!needsRuntimePermission(currentApiLevel())) return true;
  return PermissionsAndroid.check(PERMISSION);
}

/** 'blocked' = the system will no longer show the dialog (enable it in system settings). */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  if (!needsRuntimePermission(currentApiLevel())) return 'granted';
  const result = await PermissionsAndroid.request(PERMISSION);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  return 'denied';
}
