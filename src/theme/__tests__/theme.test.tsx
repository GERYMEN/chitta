import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { darkColors, lightColors, stateColorsFor } from '../colors';
import {
  THEME_MODE_KEY,
  initThemeOnLaunch,
  resolveThemeMode,
  setThemeMode,
  useThemeModeStore,
} from '../themeMode';
import { ThemeProvider } from '../ThemeProvider';
import { useColors, useTheme } from '../useTheme';
import { settingsRepository } from '../../data/repositories/settings.repository';
import { sanitizeAuditMetadata } from '../../domain/audit/audit.rules';
import { describeActivity } from '../../features/activity/activityFeed';

jest.mock('../../data/repositories/settings.repository', () => ({
  settingsRepository: { getValue: jest.fn(), setMany: jest.fn(async () => undefined) },
}));
let mockScheme: 'light' | 'dark' | null = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

const repo = settingsRepository as unknown as { getValue: jest.Mock; setMany: jest.Mock };

const live: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => live.splice(0).forEach(r => r.unmount()));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockScheme = 'light';
  useThemeModeStore.setState({ mode: 'system' });
  repo.getValue.mockResolvedValue(null);
});

describe('R12 token parity', () => {
  it('light and dark palettes have exactly the same keys', () => {
    expect(Object.keys(darkColors)).toEqual(Object.keys(lightColors));
  });
  it('every token is a non-empty string in both palettes', () => {
    for (const palette of [lightColors, darkColors]) {
      for (const v of Object.values(palette)) expect(typeof v === 'string' && v.length > 0).toBe(true);
    }
  });
  it('state matrix is derived from the active palette', () => {
    expect(stateColorsFor(darkColors).pending.fg).toBe(darkColors.pendingFg);
    expect(stateColorsFor(lightColors).failed.bg).toBe(lightColors.failedBg);
  });
});

describe('R12 mode resolution', () => {
  it('system follows the OS scheme; light/dark are forced', () => {
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
    expect(resolveThemeMode('system', 'light')).toBe('light');
    expect(resolveThemeMode('system', null)).toBe('light');
    expect(resolveThemeMode('light', 'dark')).toBe('light');
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
  });

  function Probe() {
    const c = useColors();
    const t = useTheme();
    return <Text testID="p">{`${t.mode}:${c.surface}`}</Text>;
  }
  const read = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByProps({ testID: 'p' }).props.children;

  it('without a provider the light palette is used', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(<Probe />);
    });
    live.push(r);
    expect(read(r)).toBe(`light:${lightColors.surface}`);
  });

  it('provider resolves system -> scheme, then light and dark, live', () => {
    mockScheme = 'dark';
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });
    live.push(r);
    expect(read(r)).toBe(`dark:${darkColors.surface}`);
    act(() => useThemeModeStore.setState({ mode: 'light' }));
    expect(read(r)).toBe(`light:${lightColors.surface}`);
    act(() => useThemeModeStore.setState({ mode: 'dark' }));
    expect(read(r)).toBe(`dark:${darkColors.surface}`);
  });
});

describe('R12 theme_mode setting', () => {
  it('launch loads the saved mode; unknown/missing falls back to system', async () => {
    repo.getValue.mockResolvedValue('dark');
    await initThemeOnLaunch();
    expect(useThemeModeStore.getState().mode).toBe('dark');
    repo.getValue.mockResolvedValue('purple');
    await initThemeOnLaunch();
    expect(useThemeModeStore.getState().mode).toBe('system');
    repo.getValue.mockRejectedValue(new Error('db'));
    await expect(initThemeOnLaunch()).resolves.toBeUndefined();
    expect(useThemeModeStore.getState().mode).toBe('system');
  });

  it('setThemeMode persists, audits (enums only) and applies live', async () => {
    await setThemeMode('dark');
    expect(repo.setMany).toHaveBeenCalledWith(
      [[THEME_MODE_KEY, 'dark']],
      [
        {
          eventType: 'settings_changed',
          actor: 'user',
          metadata: { kind: 'settings_changed', key: 'theme_mode', from: 'system', to: 'dark' },
        },
      ],
    );
    expect(useThemeModeStore.getState().mode).toBe('dark');
  });

  it('no audit when unchanged; a failed write leaves the mode as it was', async () => {
    await setThemeMode('system');
    expect(repo.setMany).toHaveBeenCalledWith([[THEME_MODE_KEY, 'system']], []);
    repo.setMany.mockRejectedValueOnce(new Error('db'));
    await expect(setThemeMode('light')).rejects.toThrow();
    expect(useThemeModeStore.getState().mode).toBe('system');
  });

  it('audit metadata survives sanitising and reads as a sentence', () => {
    const meta = { kind: 'settings_changed' as const, key: 'theme_mode' as const, from: 'system', to: 'dark' };
    expect(sanitizeAuditMetadata(meta)).toEqual(meta);
    const d = describeActivity({
      id: 'a1',
      seq: 1,
      transactionId: null,
      accountId: null,
      eventType: 'settings_changed',
      actor: 'user',
      eventAt: '2026-11-20T10:00:00.000Z',
      metadata: meta,
      deletedSnapshot: null,
    });
    expect(d.sentence).toBe('You set the theme to dark');
  });
});
