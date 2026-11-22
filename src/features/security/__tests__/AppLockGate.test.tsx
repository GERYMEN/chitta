import React from 'react';
import { AppState, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { clock } from '../../../shared/utils/clock';
import { AppLockGate } from '../components/AppLockGate';

const mockConfig = { enabled: true, timeout: 'immediate' as 'immediate' | '1' | '5' };
jest.mock('../securitySettings', () => ({ getAppLockConfig: () => mockConfig }));
const mockAuth = jest.fn();
const mockCan = jest.fn();
jest.mock('../../../native/android/security/biometricNative', () => ({
  authenticate: (...a: unknown[]) => mockAuth(...a),
  canUseAppLock: () => mockCan(),
}));

let now = 1_000_000;
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const handlers = () =>
  (AppState.addEventListener as jest.Mock).mock.calls.map(c => c[1] as (s: string) => void);
async function emit(state: string) {
  const all = handlers();
  await act(async () => {
    all[all.length - 1](state);
  });
  await flush();
}
async function render(ready = true) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(
      <AppLockGate ready={ready}>
        <Text testID="secret">content</Text>
      </AppLockGate>,
    );
  });
  await flush();
  return r;
}
const overlay = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAllByProps({ testID: 'app-lock-overlay' });
const unlockBtn = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAllByProps({ testID: 'app-lock-unlock' });

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.enabled = true;
  mockConfig.timeout = 'immediate';
  mockCan.mockResolvedValue('available');
  mockAuth.mockResolvedValue(false);
  now = 1_000_000;
  jest.spyOn(clock, 'now').mockImplementation(() => new Date(now));
});
afterEach(() => jest.restoreAllMocks());

describe('R9b T3 AppLockGate', () => {
  it('disabled: no overlay, content visible', async () => {
    mockConfig.enabled = false;
    const r = await render();
    expect(overlay(r)).toHaveLength(0);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it('cold launch while enabled: overlay up and the system prompt is requested', async () => {
    const r = await render();
    expect(overlay(r).length).toBeGreaterThan(0);
    expect(unlockBtn(r).length).toBeGreaterThan(0);
    expect(mockAuth).toHaveBeenCalledTimes(1);
  });

  it('opaque but button-less until ready: no content flash, no prompt', async () => {
    const r = await render(false);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(overlay(r).length).toBeGreaterThan(0);
    expect(unlockBtn(r)).toHaveLength(0);
  });

  it('success unlocks', async () => {
    mockAuth.mockResolvedValue(true);
    const r = await render();
    expect(overlay(r)).toHaveLength(0);
  });

  it('cancel keeps it locked and Unlock re-triggers the prompt', async () => {
    const r = await render();
    expect(overlay(r).length).toBeGreaterThan(0);
    mockAuth.mockResolvedValue(true);
    await act(async () => {
      unlockBtn(r)[0].props.onPress();
    });
    await flush();
    expect(mockAuth).toHaveBeenCalledTimes(2);
    expect(overlay(r)).toHaveLength(0);
  });

  it('immediate: locks on any background -> foreground', async () => {
    mockAuth.mockResolvedValue(true);
    const r = await render();
    expect(overlay(r)).toHaveLength(0);
    mockAuth.mockResolvedValue(false);
    await emit('background');
    await emit('active');
    expect(overlay(r).length).toBeGreaterThan(0);
  });

  it('timed: short absence stays open, long absence locks', async () => {
    mockConfig.timeout = '5';
    mockAuth.mockResolvedValue(true);
    const r = await render();
    mockAuth.mockResolvedValue(false);
    await emit('background');
    now += 60_000;
    await emit('active');
    expect(overlay(r)).toHaveLength(0);
    await emit('background');
    now += 5 * 60_000;
    await emit('active');
    expect(overlay(r).length).toBeGreaterThan(0);
  });

  it('a phone with no screen lock is never locked out', async () => {
    mockCan.mockResolvedValue('none_enrolled');
    const r = await render();
    expect(overlay(r)).toHaveLength(0);
    expect(mockAuth).not.toHaveBeenCalled();
  });
});
