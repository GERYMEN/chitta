import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { REDACTED_AMOUNT, isRedacted, setRedacted } from '../../../shared/privacy/redaction';
import { AmountText } from '../../../shared/ui/AmountText';
import { settingsRepository } from '../../../data/repositories/settings.repository';
import { sanitizeAuditMetadata } from '../../../domain/audit/audit.rules';
import { describeActivity } from '../../activity/activityFeed';
import {
  HIDE_AMOUNTS_KEY,
  SECURE_SCREEN_KEY,
  initSecurityOnLaunch,
  setHideAmounts,
  setSecureScreen,
} from '../securitySettings';

const mockNativeSecure = jest.fn(async (_on: boolean) => undefined);
jest.mock('../../../native/android/security/securityNative', () => ({
  setNativeSecureScreen: (on: boolean) => mockNativeSecure(on),
}));
jest.mock('../../../data/repositories/settings.repository', () => ({
  settingsRepository: { getValue: jest.fn(), setMany: jest.fn(async () => undefined) },
}));

const repo = settingsRepository as unknown as {
  getValue: jest.Mock;
  setMany: jest.Mock;
};

function seed(values: Record<string, string>) {
  const db = { ...values };
  repo.getValue.mockImplementation(async (key: string) => db[key] ?? null);
  repo.setMany.mockImplementation(async (entries: ReadonlyArray<readonly [string, string]>) => {
    for (const [k, v] of entries) db[k] = v;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setRedacted(false);
});

describe('R9a T1 hide amounts', () => {
  it('launch reads hide_amounts and applies it to the redaction store', async () => {
    seed({ [HIDE_AMOUNTS_KEY]: 'on' });
    await initSecurityOnLaunch();
    expect(isRedacted()).toBe(true);
  });

  it('defaults to OFF when the key is missing or unreadable', async () => {
    seed({});
    await initSecurityOnLaunch();
    expect(isRedacted()).toBe(false);
    repo.getValue.mockRejectedValue(new Error('db'));
    await expect(initSecurityOnLaunch()).resolves.toBeUndefined();
    expect(isRedacted()).toBe(false);
  });

  it('toggle persists the key, writes a settings_changed audit and applies live', async () => {
    seed({});
    await setHideAmounts(true);
    expect(isRedacted()).toBe(true);
    expect(repo.setMany).toHaveBeenCalledWith(
      [[HIDE_AMOUNTS_KEY, 'on']],
      [
        {
          eventType: 'settings_changed',
          actor: 'user',
          metadata: { kind: 'settings_changed', key: 'hide_amounts', from: 'off', to: 'on' },
        },
      ],
    );
    await setHideAmounts(false);
    expect(isRedacted()).toBe(false);
    expect(repo.setMany).toHaveBeenLastCalledWith(
      [[HIDE_AMOUNTS_KEY, 'off']],
      [expect.objectContaining({ metadata: expect.objectContaining({ from: 'on', to: 'off' }) })],
    );
  });

  it('a failed write leaves the live state unchanged', async () => {
    seed({});
    repo.setMany.mockRejectedValueOnce(new Error('db'));
    await expect(setHideAmounts(true)).rejects.toThrow();
    expect(isRedacted()).toBe(false);
  });

  it('AmountText shows the mask while ON and the real figure when OFF', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<AmountText amountMinor={123400} type="expense" />);
    });
    const text = () => renderer.root.findAllByType(Text).map(n => String(n.props.children)).join('');
    expect(text()).not.toContain(REDACTED_AMOUNT);
    act(() => setRedacted(true));
    expect(text()).toContain(REDACTED_AMOUNT);
    act(() => renderer.unmount());
  });
});

describe('R9a T2 secure screen', () => {
  it('launch mirrors secure_screen to the native side', async () => {
    seed({ [SECURE_SCREEN_KEY]: 'on' });
    await initSecurityOnLaunch();
    expect(mockNativeSecure).toHaveBeenCalledWith(true);
  });

  it('launch with the key missing keeps it OFF', async () => {
    seed({});
    await initSecurityOnLaunch();
    expect(mockNativeSecure).toHaveBeenCalledWith(false);
  });

  it('toggle persists, audits and calls the bridge', async () => {
    seed({});
    await setSecureScreen(true);
    expect(repo.setMany).toHaveBeenCalledWith(
      [[SECURE_SCREEN_KEY, 'on']],
      [
        {
          eventType: 'settings_changed',
          actor: 'user',
          metadata: { kind: 'settings_changed', key: 'secure_screen', from: 'off', to: 'on' },
        },
      ],
    );
    expect(mockNativeSecure).toHaveBeenCalledWith(true);
  });
});

describe('R9a audit + Activity wording', () => {
  it('the two keys survive audit sanitising and read as plain sentences', () => {
    for (const key of ['hide_amounts', 'secure_screen'] as const) {
      const metadata = sanitizeAuditMetadata({ kind: 'settings_changed', key, from: 'off', to: 'on' });
      expect(metadata).toEqual({ kind: 'settings_changed', key, from: 'off', to: 'on' });
      const item = describeActivity({
        id: 'a1',
        seq: 1,
        transactionId: null,
        accountId: null,
        eventType: 'settings_changed',
        actor: 'user',
        eventAt: '2026-11-20T10:00:00.000Z',
        metadata,
        deletedSnapshot: null,
      });
      expect(item.sentence).not.toMatch(/threshold/);
      expect(item.sentence).toBe(
        key === 'hide_amounts' ? 'You turned on Hide amounts' : 'You turned on Hide in recents and block screenshots',
      );
    }
  });
});
