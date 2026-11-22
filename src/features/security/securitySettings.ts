import { settingsRepository } from '../../data/repositories/settings.repository';
import { setRedacted } from '../../shared/privacy/redaction';
import { setNativeSecureScreen } from '../../native/android/security/securityNative';
import { canUseAppLock, AppLockAvailability } from '../../native/android/security/biometricNative';

/**
 * R9a: the two persisted security preferences (app_settings, 'on' | 'off',
 * default off).
 * - hide_amounts: the global redaction flag, set at launch and live.
 * - secure_screen: FLAG_SECURE (hidden in recents, no screenshots). The
 *   source of truth is this row; the native side keeps a SharedPreferences
 *   mirror so MainActivity can apply it before any JS runs.
 * Audit metadata is the key and on/off only.
 */
export const HIDE_AMOUNTS_KEY = 'hide_amounts';
export const SECURE_SCREEN_KEY = 'secure_screen';

type SecurityKey = typeof HIDE_AMOUNTS_KEY | typeof SECURE_SCREEN_KEY;

async function readFlag(key: SecurityKey): Promise<boolean> {
  const value = await settingsRepository.getValue(key).catch(() => null);
  return value === 'on';
}

/** Persist one value; a settings_changed audit (key + from/to enums only) when it changed. */
async function writeValue(
  key: SecurityKey | typeof APP_LOCK_ENABLED_KEY | typeof APP_LOCK_TIMEOUT_KEY,
  from: string,
  to: string,
): Promise<void> {
  await settingsRepository.setMany(
    [[key, to]],
    from === to
      ? []
      : [
          {
            eventType: 'settings_changed',
            actor: 'user',
            metadata: { kind: 'settings_changed', key, from, to },
          },
        ],
  );
}

async function writeFlag(key: SecurityKey, on: boolean): Promise<void> {
  const before = await readFlag(key);
  await writeValue(key, before ? 'on' : 'off', on ? 'on' : 'off');
}

/**
 * R9b: app lock (UI gate only). app_lock_enabled 'on' | 'off' (default off);
 * app_lock_timeout 'immediate' | '1' | '5' minutes (default immediate).
 */
export const APP_LOCK_ENABLED_KEY = 'app_lock_enabled';
export const APP_LOCK_TIMEOUT_KEY = 'app_lock_timeout';
export type AppLockTimeout = 'immediate' | '1' | '5';
export const APP_LOCK_TIMEOUTS: ReadonlyArray<AppLockTimeout> = ['immediate', '1', '5'];
export interface AppLockConfig {
  enabled: boolean;
  timeout: AppLockTimeout;
}

let appLockConfig: AppLockConfig = { enabled: false, timeout: 'immediate' };

/** The live (already loaded) app-lock config, read by the lock gate. */
export function getAppLockConfig(): AppLockConfig {
  return appLockConfig;
}

export async function loadAppLockConfig(): Promise<AppLockConfig> {
  const [enabled, timeout] = await Promise.all([
    settingsRepository.getValue(APP_LOCK_ENABLED_KEY).catch(() => null),
    settingsRepository.getValue(APP_LOCK_TIMEOUT_KEY).catch(() => null),
  ]);
  appLockConfig = {
    enabled: enabled === 'on',
    timeout: APP_LOCK_TIMEOUTS.includes(timeout as AppLockTimeout) ? (timeout as AppLockTimeout) : 'immediate',
  };
  return appLockConfig;
}

export type EnableAppLockResult = { ok: true } | { ok: false; reason: Exclude<AppLockAvailability, 'available'> };

/** Turning it on first needs a screen lock / biometric on the phone; otherwise nothing is written. */
export async function enableAppLock(): Promise<EnableAppLockResult> {
  const availability = await canUseAppLock();
  if (availability !== 'available') return { ok: false, reason: availability };
  await writeValue(APP_LOCK_ENABLED_KEY, appLockConfig.enabled ? 'on' : 'off', 'on');
  appLockConfig = { ...appLockConfig, enabled: true };
  return { ok: true };
}

export async function disableAppLock(): Promise<void> {
  await writeValue(APP_LOCK_ENABLED_KEY, appLockConfig.enabled ? 'on' : 'off', 'off');
  appLockConfig = { ...appLockConfig, enabled: false };
}

export async function setAppLockTimeout(timeout: AppLockTimeout): Promise<void> {
  await writeValue(APP_LOCK_TIMEOUT_KEY, appLockConfig.timeout, timeout);
  appLockConfig = { ...appLockConfig, timeout };
}

/** Launch / after restore: apply both saved preferences. Never throws. */
export async function initSecurityOnLaunch(): Promise<void> {
  const [hide, secure] = await Promise.all([
    readFlag(HIDE_AMOUNTS_KEY),
    readFlag(SECURE_SCREEN_KEY),
    loadAppLockConfig(),
  ]);
  setRedacted(hide);
  await setNativeSecureScreen(secure).catch(() => undefined);
}

export async function readSecuritySettings(): Promise<{ hideAmounts: boolean; secureScreen: boolean }> {
  const [hideAmounts, secureScreen] = await Promise.all([
    readFlag(HIDE_AMOUNTS_KEY),
    readFlag(SECURE_SCREEN_KEY),
  ]);
  return { hideAmounts, secureScreen };
}

/** Settings toggle: persist + audit, then apply live (only after the write succeeded). */
export async function setHideAmounts(on: boolean): Promise<void> {
  await writeFlag(HIDE_AMOUNTS_KEY, on);
  setRedacted(on);
}

export async function setSecureScreen(on: boolean): Promise<void> {
  await writeFlag(SECURE_SCREEN_KEY, on);
  await setNativeSecureScreen(on);
}
