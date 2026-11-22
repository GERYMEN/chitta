import { settingsRepository } from '../../data/repositories/settings.repository';
import { setRedacted } from '../../shared/privacy/redaction';
import { setNativeSecureScreen } from '../../native/android/security/securityNative';

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

async function writeFlag(key: SecurityKey, on: boolean): Promise<void> {
  const before = await readFlag(key);
  await settingsRepository.setMany(
    [[key, on ? 'on' : 'off']],
    before === on
      ? []
      : [
          {
            eventType: 'settings_changed',
            actor: 'user',
            metadata: {
              kind: 'settings_changed',
              key,
              from: before ? 'on' : 'off',
              to: on ? 'on' : 'off',
            },
          },
        ],
  );
}

/** Launch / after restore: apply both saved preferences. Never throws. */
export async function initSecurityOnLaunch(): Promise<void> {
  const [hide, secure] = await Promise.all([readFlag(HIDE_AMOUNTS_KEY), readFlag(SECURE_SCREEN_KEY)]);
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
