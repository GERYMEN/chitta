import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ActivityScreen } from '../screens/ActivityScreen';
import { regainedFocus } from '../../../shared/hooks/useOnFocusRegained';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { auditRepository } from '../../../data/repositories/audit.repository';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
jest.mock('../../../data/repositories/audit.repository', () => ({
  auditRepository: { listRecent: jest.fn(async () => []) },
}));
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
const mockNav = { focused: true, focusEffect: null as null | (() => void) };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const { useEffect } = require('react');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), push: jest.fn() }),
    useIsFocused: () => mockNav.focused,
    useFocusEffect: (effect: () => void) => {
      mockNav.focusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});

const listRecent = auditRepository.listRecent as jest.Mock;

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<ActivityScreen />);
  });
  mounted.push(r);
  return r;
}

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});
const eye = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => n.props.testID === 'activity-toggle-amounts' && typeof n.type !== 'string')[0];
const rerender = async (r: ReactTestRenderer.ReactTestRenderer) => {
  await ReactTestRenderer.act(async () => {
    r.update(<ActivityScreen />);
  });
};

beforeEach(() => {
  mockNav.focused = true;
  listRecent.mockClear();
});

describe('B3: Activity re-masks only on an unfocused → focused transition', () => {
  it('regainedFocus is true only for false → true', () => {
    expect(regainedFocus(false, true)).toBe(true);
    expect(regainedFocus(true, true)).toBe(false);
    expect(regainedFocus(true, false)).toBe(false);
    expect(regainedFocus(false, false)).toBe(false);
  });

  it('revealed amounts survive re-renders, store refreshes, data reloads and repeated focus events', async () => {
    const r = await render();
    expect(eye(r).props.accessibilityLabel).toBe('Show amounts'); // hidden on open
    await ReactTestRenderer.act(async () => {
      eye(r).props.onPress();
    });
    expect(eye(r).props.accessibilityLabel).toBe('Hide amounts');

    await rerender(r);
    await ReactTestRenderer.act(async () => {
      useTransactionsStore.setState({ transactions: [] }); // store refresh
    });
    await ReactTestRenderer.act(async () => {
      mockNav.focusEffect?.(); // the focus effect firing again while focused (data reload)
    });
    expect(listRecent.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(eye(r).props.accessibilityLabel).toBe('Hide amounts');
  });

  it('leaving and coming back hides them again', async () => {
    const r = await render();
    await ReactTestRenderer.act(async () => {
      eye(r).props.onPress();
    });
    mockNav.focused = false; // e.g. opened a Transaction detail
    await rerender(r);
    expect(eye(r).props.accessibilityLabel).toBe('Hide amounts');
    mockNav.focused = true; // back
    await rerender(r);
    expect(eye(r).props.accessibilityLabel).toBe('Show amounts');
  });
});
