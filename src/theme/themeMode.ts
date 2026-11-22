import { create } from 'zustand';
import { settingsRepository } from '../data/repositories/settings.repository';

/**
 * R12: the persisted theme preference (app_settings 'theme_mode', default
 * 'system'). 'system' follows the OS light/dark scheme live. Audit metadata
 * is the key and the enum only.
 */
export const THEME_MODE_KEY = 'theme_mode';
export type ThemeModeSetting = 'system' | 'light' | 'dark';
export type ResolvedMode = 'light' | 'dark';
export const THEME_MODES: ReadonlyArray<ThemeModeSetting> = ['system', 'light', 'dark'];

export function isThemeModeSetting(value: unknown): value is ThemeModeSetting {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Pure: the setting + the OS scheme -> the palette to use. */
export function resolveThemeMode(
  setting: ThemeModeSetting,
  scheme: 'light' | 'dark' | null | undefined,
): ResolvedMode {
  if (setting === 'light' || setting === 'dark') return setting;
  return scheme === 'dark' ? 'dark' : 'light';
}

interface ThemeModeState {
  mode: ThemeModeSetting;
}

export const useThemeModeStore = create<ThemeModeState>(() => ({ mode: 'system' }));

/** Launch / after restore: load the saved preference. Never throws. */
export async function initThemeOnLaunch(): Promise<void> {
  const value = await settingsRepository.getValue(THEME_MODE_KEY).catch(() => null);
  useThemeModeStore.setState({ mode: isThemeModeSetting(value) ? value : 'system' });
}

/** Settings control: persist + audit, then apply live (only after the write succeeded). */
export async function setThemeMode(next: ThemeModeSetting): Promise<void> {
  const from = useThemeModeStore.getState().mode;
  await settingsRepository.setMany(
    [[THEME_MODE_KEY, next]],
    from === next
      ? []
      : [
          {
            eventType: 'settings_changed',
            actor: 'user',
            metadata: { kind: 'settings_changed', key: THEME_MODE_KEY, from, to: next },
          },
        ],
  );
  useThemeModeStore.setState({ mode: next });
}
