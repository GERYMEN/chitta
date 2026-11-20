/**
 * Regression: AddBillScreen must mount without an infinite render loop.
 *
 * The screen used to select `activeAccounts(state.accounts)` straight out of the
 * Zustand selector. `activeAccounts` calls `.filter(...)`, which returns a NEW
 * array on every render, so the store snapshot changed every render and React
 * threw "Maximum update depth exceeded" — the app crashed the moment Add bill
 * was opened on the device (JS FATAL, mqt_v_native). The fix selects the raw
 * accounts array and derives the active list in a useMemo. This test renders the
 * screen with the real stores and fails if that loop comes back.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() }),
    useRoute: () => ({ params: undefined }),
  };
});
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

import { AddBillScreen } from '../AddBillScreen';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';

describe('AddBillScreen render', () => {
  it('mounts without an infinite update loop (empty accounts)', () => {
    useTransactionsStore.setState({ accounts: [] });
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    expect(() => {
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<AddBillScreen />);
      });
    }).not.toThrow();
    ReactTestRenderer.act(() => tree?.unmount());
  });
});
