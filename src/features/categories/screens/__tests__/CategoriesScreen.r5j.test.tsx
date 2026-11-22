/** R5j T2 — archived categories list a Restore action. Synthetic. */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { CategoriesScreen } from '../CategoriesScreen';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

const cat = (id: string, name: string, archivedAt: string | null) => ({
  id, name, parentId: null, type: 'expense' as const, icon: 'shape-outline', isSystem: false, archivedAt, color: null,
});

it('an archived category shows Restore; pressing it calls restoreCategory with its id', async () => {
  const restore = jest.fn(async () => undefined);
  useTransactionsStore.setState({
    categories: [cat('cat-live', 'QA Live', null), cat('cat-old', 'QA Old', '2026-10-30T00:00:00.000Z')],
    merchantRules: {},
    restoreCategory: restore,
  });
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<CategoriesScreen />);
  });
  const buttons = r.root.findAll(n => n.props.label === 'Restore' && typeof n.props.onPress === 'function');
  expect(buttons).toHaveLength(1);
  await ReactTestRenderer.act(async () => {
    await buttons[0].props.onPress();
  });
  expect(restore).toHaveBeenCalledWith('cat-old');
  r.unmount();
});
