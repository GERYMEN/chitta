import { NativeModules } from 'react-native';

/**
 * R9b: typed wrapper around the own native `TrackerBiometric` module
 * (android/app/src/main/java/com/tracker/BiometricModule.kt). A UI gate only:
 * no keys, nothing stored, nothing logged here.
 */
export type AppLockAvailability = 'available' | 'none_enrolled' | 'no_hardware' | 'unavailable';

/** Stable reject codes of `authenticate`. */
export type AuthFailure = 'cancelled' | 'lockout' | 'no_activity' | 'error';

interface BiometricNativeModule {
  canUseAppLock(): Promise<string>;
  authenticate(title: string, subtitle: string): Promise<boolean>;
}

const { TrackerBiometric } = NativeModules as { TrackerBiometric?: BiometricNativeModule };

const KNOWN: ReadonlyArray<AppLockAvailability> = [
  'available',
  'none_enrolled',
  'no_hardware',
  'unavailable',
];

export async function canUseAppLock(): Promise<AppLockAvailability> {
  if (!TrackerBiometric) return 'unavailable';
  try {
    const value = await TrackerBiometric.canUseAppLock();
    return KNOWN.includes(value as AppLockAvailability) ? (value as AppLockAvailability) : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Resolves true on success, false otherwise (never throws). Biometric or device PIN. */
export async function authenticate(title: string, subtitle: string): Promise<boolean> {
  if (!TrackerBiometric) return false;
  try {
    return (await TrackerBiometric.authenticate(title, subtitle)) === true;
  } catch {
    return false;
  }
}
