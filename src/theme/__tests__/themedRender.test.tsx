import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { HomeScreen } from '../../features/home/screens/HomeScreen';
import { TransactionsScreen } from '../../features/transactions/screens/TransactionsScreen';
import { useTransactionsStore } from '../../features/transactions/state/transactionsStore';
import { DEFAULT_TRANSACTION_FILTERS } from '../../features/transactions/filters/transactionFilters';
import { BottomSheet, Button, Card, Chip } from '../../shared/ui';
import { ThemeProvider } from '../ThemeProvider';
import { ResolvedMode, useThemeModeStore } from '../themeMode';
import { darkColors, lightColors } from '../colors';

jest.mock('../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const { useEffect } = require('react');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), push: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function renderIn(mode: ResolvedMode, ui: React.ReactElement) {
  useThemeModeStore.setState({ mode });
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(<ThemeProvider>{ui}</ThemeProvider>);
  });
  mounted.push(r);
  return r;
}

beforeEach(() => {
  useTransactionsStore.setState({
    transactions: [],
    accounts: [],
    categories: [],
    selectedPeriod: '1M',
    transactionFilters: DEFAULT_TRANSACTION_FILTERS,
  });
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  useThemeModeStore.setState({ mode: 'system' });
});

const PALETTES = { light: lightColors, dark: darkColors } as const;

describe.each(['light', 'dark'] as const)('R12 renders in %s mode without throwing', mode => {
  it('Home', async () => {
    const r = await renderIn(mode, <HomeScreen />);
    expect(r.root.findAllByType(Text).length).toBeGreaterThan(0);
  });

  it('Transactions', async () => {
    const r = await renderIn(mode, <TransactionsScreen />);
    expect(r.root.findAllByType(Text).length).toBeGreaterThan(0);
  });

  it('BottomSheet', async () => {
    const r = await renderIn(
      mode,
      <BottomSheet visible onClose={jest.fn()}>
        <Text>QA sheet body</Text>
      </BottomSheet>,
    );
    expect(r.root.findAllByType(Text).map(t => t.props.children)).toContain('QA sheet body');
  });

  it('Card, Chip and Button read the active palette', async () => {
    const r = await renderIn(
      mode,
      <>
        <Card testID="card">
          <Text>QA</Text>
        </Card>
        <Chip label="QA chip" tone="approved" />
        <Button label="QA button" onPress={jest.fn()} />
      </>,
    );
    const card = r.root.findAllByType(View).find(v => v.props.testID === 'card')!;
    expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(
      PALETTES[mode].surfaceContainerLowest,
    );
    const chipBox = r.root.findAllByType(View).find(v => {
      const s = StyleSheet.flatten(v.props.style);
      return s && s.backgroundColor === PALETTES[mode].approvedBg;
    });
    expect(chipBox).toBeDefined();
  });
});
