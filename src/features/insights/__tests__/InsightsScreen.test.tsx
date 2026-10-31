import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { InsightsScreen } from '../screens/InsightsScreen';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { DEFAULT_TRANSACTION_FILTERS } from '../../transactions/filters/transactionFilters';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { Category } from '../../../domain/categories/category.types';
import { clock } from '../../../shared/utils/clock';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const { useEffect } = require('react');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 9, 20, 15, 0, 0, 0);

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 10000,
    currency: 'INR',
    merchantName: `QA-Merchant-${id}`,
    categoryId: 'cat-a',
    accountId: 'acc-qa',
    paymentMethod: 'upi',
    occurredAt: local(2026, 10, 10),
    detectedAt: local(2026, 10, 10),
    approvedAt: local(2026, 10, 10),
    note: null,
    sourceType: 'manual',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: null,
    parserVersion: null,
    bulkBatchId: null,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: local(2026, 10, 10),
    updatedAt: local(2026, 10, 10),
    ...patch,
  };
}

const category = (id: string, name: string): Category => ({
  id,
  name,
  parentId: null,
  type: 'both',
  icon: 'shape-outline',
  isSystem: false,
  archivedAt: null,
  color: 'green',
});

const ROWS: Transaction[] = [
  tx('1', { categoryId: 'cat-a', amountMinor: 20000, occurredAt: local(2026, 10, 2) }),
  tx('2', { categoryId: 'cat-b', amountMinor: 5000, occurredAt: local(2026, 10, 3) }),
  tx('3', { type: 'income', categoryId: 'cat-c', amountMinor: 100000, occurredAt: local(2026, 10, 4) }),
  tx('4', { categoryId: 'cat-a', amountMinor: 7000, occurredAt: local(2026, 9, 4) }),
];

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function renderScreen() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<InsightsScreen />);
  });
  mounted.push(r);
  return r;
}
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
/** Outermost composite per testID matching a prefix. */
const byPrefix = (r: ReactTestRenderer.ReactTestRenderer, prefix: string) => {
  const seen = new Set<string>();
  return r.root
    .findAll(n => typeof n.type !== 'string' && typeof n.props.testID === 'string' && n.props.testID.startsWith(prefix))
    .filter(n => (seen.has(n.props.testID) ? false : (seen.add(n.props.testID), true)));
};

beforeEach(() => {
  mockNavigate.mockReset();
  jest.spyOn(clock, 'now').mockImplementation(() => new Date(NOW));
  useTransactionsStore.setState({
    transactions: ROWS,
    accounts: [],
    categories: [category('cat-a', 'QA Category A'), category('cat-b', 'QA Category B')],
    selectedPeriod: '1M',
    transactionFilters: DEFAULT_TRANSACTION_FILTERS,
  });
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  jest.restoreAllMocks();
});

describe('Insights screen (R4)', () => {
  it('totals, every category and a 3-month trend (1M context) with the running month marked', async () => {
    const r = await renderScreen();
    const all = texts(r);
    expect(all).toEqual(expect.arrayContaining(['Insights', '₹1,000', '₹250', '+₹750']));
    expect(byPrefix(r, 'chart-bar-cat-').map(b => b.props.accessibilityLabel)).toEqual([
      'QA Category A: ₹200, 1 item, 80% of spend',
      'QA Category B: ₹50, 1 item, 20% of spend',
    ]);
    expect(byPrefix(r, 'chart-bar-2026-').map(b => b.props.accessibilityLabel)).toEqual([
      'August 2026: spent ₹0, income ₹0',
      'September 2026: spent ₹70, income ₹0',
      'October 2026, partial month: spent ₹250, income ₹1,000',
    ]);
    expect(all).toEqual(expect.arrayContaining(['Aug', 'Sep', 'Oct*', 'Aug 2026 – Oct 2026']));
    expect(all.some(t => t.startsWith('* Partial month'))).toBe(true);
  });

  it('tapping a month shows its numbers', async () => {
    const r = await renderScreen();
    expect(texts(r)).toContain('October 2026 · partial');
    await ReactTestRenderer.act(async () => {
      byPrefix(r, 'chart-bar-2026-09')[0].props.onPress();
    });
    expect(texts(r)).toContain('September 2026');
    expect(texts(r)).toContain('Spent ₹70 · Income ₹0');
  });

  it('a category bar opens Transactions filtered to it (+ the period); the selector is shared', async () => {
    const r = await renderScreen();
    await ReactTestRenderer.act(async () => {
      byPrefix(r, 'chart-bar-cat-b')[0].props.onPress();
    });
    expect(useTransactionsStore.getState().transactionFilters).toEqual({
      ...DEFAULT_TRANSACTION_FILTERS,
      categoryId: 'cat-b',
    });
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Transactions' });
    await ReactTestRenderer.act(async () => {
      byPrefix(r, 'period-chip-3M')[0].props.onPress();
    });
    expect(useTransactionsStore.getState().selectedPeriod).toBe('3M');
    expect(byPrefix(r, 'chart-bar-cat-a')[0].props.accessibilityLabel).toBe(
      'QA Category A: ₹270, 2 items, 84% of spend',
    );
  });

  it('48dp Back goes back; empty period shows the empty state', async () => {
    useTransactionsStore.setState({ transactions: [] });
    const r = await renderScreen();
    expect(texts(r)).toContain('No spending this month.');
    const back = byPrefix(r, 'header-back')[0];
    expect(back.props.accessibilityLabel).toBe('Back');
    await ReactTestRenderer.act(async () => {
      back.props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });
});
