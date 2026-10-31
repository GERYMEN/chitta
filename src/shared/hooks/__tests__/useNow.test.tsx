import React from 'react';
import { AppState, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { useNow } from '../useNow';
import { clock } from '../../utils/clock';

const mockFocus: { effect: (() => void) | null } = { effect: null };
jest.mock('@react-navigation/native', () => ({
  // Captured so the test can play "the screen gained focus".
  useFocusEffect: (effect: () => void) => {
    mockFocus.effect = effect;
  },
}));

function Probe({ refreshKey }: { refreshKey: unknown }) {
  const now = useNow(refreshKey);
  return <Text>{now.toISOString()}</Text>;
}

const T = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
let current = T(1);

async function render(refreshKey: unknown = 'a') {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<Probe refreshKey={refreshKey} />);
  });
  return r;
}
const shown = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findByType(Text).props.children;

beforeEach(() => {
  current = T(1);
  jest.spyOn(clock, 'now').mockImplementation(() => current);
});
afterEach(() => jest.restoreAllMocks());

describe('useNow (R4 / B1 injected clock)', () => {
  it('reads the clock on mount and again when the screen gains focus', async () => {
    const r = await render();
    expect(shown(r)).toBe(T(1).toISOString());
    current = T(2);
    await ReactTestRenderer.act(async () => {
      mockFocus.effect?.();
    });
    expect(shown(r)).toBe(T(2).toISOString());
  });

  it('re-reads when the app comes back to the foreground, not on background', async () => {
    const r = await render();
    const calls = (AppState.addEventListener as jest.Mock).mock.calls;
    const onChange = calls[calls.length - 1][1] as (state: string) => void;
    current = T(3);
    await ReactTestRenderer.act(async () => {
      onChange('background');
    });
    expect(shown(r)).toBe(T(1).toISOString());
    await ReactTestRenderer.act(async () => {
      onChange('active');
    });
    expect(shown(r)).toBe(T(3).toISOString());
  });

  it('re-reads when the refresh key (the store rows) changes', async () => {
    const r = await render('a');
    current = T(4);
    await ReactTestRenderer.act(async () => {
      r.update(<Probe refreshKey="a" />);
    });
    expect(shown(r)).toBe(T(1).toISOString());
    await ReactTestRenderer.act(async () => {
      r.update(<Probe refreshKey="b" />);
    });
    expect(shown(r)).toBe(T(4).toISOString());
  });
});
