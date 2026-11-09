import { DeviceEventEmitter, EmitterSubscription, NativeModules } from 'react-native';

/**
 * R5: typed wrapper around the own native `SmsAutoRead` module
 * (android/app/src/main/java/com/tracker/SmsAutoReadModule.kt).
 *
 * The native SMS_RECEIVED receiver never reads, logs or forwards the message
 * (no body, no sender). It only schedules a run of the normal incremental
 * sync: a `TrackerSmsReceived` event (no payload) when the app is in front,
 * otherwise the headless task below.
 */
export const SMS_RECEIVED_EVENT = 'TrackerSmsReceived';
export const AUTO_READ_HEADLESS_TASK = 'TrackerSmsAutoRead';

interface SmsAutoReadNativeModule {
  setEnabled(enabled: boolean): Promise<boolean>;
}

const { SmsAutoRead } = NativeModules as { SmsAutoRead?: SmsAutoReadNativeModule };

/**
 * Mirror of the effective auto-read state into the receiver's own flag
 * (SharedPreferences, boolean only). Default false: until the app has run
 * once after the update, the receiver does nothing.
 */
export async function setNativeAutoReadEnabled(enabled: boolean): Promise<void> {
  if (!SmsAutoRead) return;
  await SmsAutoRead.setEnabled(enabled).catch(() => false);
}

/** Foreground: called (no payload) a few seconds after an SMS arrived. */
export function subscribeSmsReceived(listener: () => void): EmitterSubscription {
  return DeviceEventEmitter.addListener(SMS_RECEIVED_EVENT, () => listener());
}
