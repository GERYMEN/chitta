/** R5j T1 — Hidden accounts screen: list + Un-ignore. Synthetic. */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { IgnoredAccountsScreen } from '../IgnoredAccountsScreen';
import { accountRepository } from '../../../../data/repositories/account.repository';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

const row = (lastFour: string, decision: string) => ({
  key: `hdfc:bank:${lastFour}:3`, decision, accountId: null, bankCanonical: 'hdfc', accountKind: 'bank', lastFour,
});

it('lists ignored keys only; Un-ignore calls the store with that key and refreshes', async () => {
  let rows = [row('4242', 'ignored'), row('5555', 'added')];
  jest.spyOn(accountRepository, 'listSuggestionDecisions').mockImplementation(async () => rows as never);
  const unignore = jest.fn(async (key: { lastFour: string }) => {
    rows = rows.filter(r => r.lastFour !== key.lastFour);
  });
  useTransactionsStore.setState({ unignoreSuggestion: unignore as never });
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<IgnoredAccountsScreen />);
  });
  const rowsNow = () => r.root.findAll(n => n.props.testID === 'ignored-account-row' && (n.type as unknown) === 'View');
  expect(rowsNow()).toHaveLength(1);
  const btn = r.root.findAll(n => n.props.testID === 'ignored-account-unignore' && typeof n.props.onPress === 'function')[0];
  await ReactTestRenderer.act(async () => {
    await btn.props.onPress();
  });
  expect(unignore).toHaveBeenCalledWith(expect.objectContaining({ bankCanonical: 'hdfc', accountKind: 'bank', lastFour: '4242' }));
  expect(rowsNow()).toHaveLength(0);
  expect(r.root.findAll(n => n.props.testID === 'ignored-accounts-empty').length).toBeGreaterThan(0);
  r.unmount();
});
