import { PermissionsAndroid } from 'react-native';

export type SmsPermissionRequestResult = 'granted' | 'denied' | 'never_ask_again';

export async function checkSmsPermission(): Promise<boolean> {
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
}

export async function requestSmsPermission(): Promise<SmsPermissionRequestResult> {
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  );
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'never_ask_again';
  return 'denied';
}

/** R5 auto-read: RECEIVE_SMS (the only permission R5 adds). */
export async function checkReceiveSmsPermission(): Promise<boolean> {
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
}

export async function requestReceiveSmsPermission(): Promise<SmsPermissionRequestResult> {
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'never_ask_again';
  return 'denied';
}

/**
 * Onboarding (new installs): READ_SMS + RECEIVE_SMS in one request — both are
 * in the SMS permission group, so Android shows a single dialog.
 */
export async function requestSmsPermissions(): Promise<{
  read: SmsPermissionRequestResult;
  receive: SmsPermissionRequestResult;
}> {
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  const map = (value: string | undefined): SmsPermissionRequestResult =>
    value === PermissionsAndroid.RESULTS.GRANTED
      ? 'granted'
      : value === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
      ? 'never_ask_again'
      : 'denied';
  return {
    read: map(results[PermissionsAndroid.PERMISSIONS.READ_SMS]),
    receive: map(results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS]),
  };
}
