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
