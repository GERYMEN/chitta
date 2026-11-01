import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { HomeScreen } from '../screens/HomeScreen';
import { StatTile } from '../components/StatTile';
import { BalanceCard } from '../components/BalanceCard';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { DEFAULT_TRANSACTION_FILTERS } from '../../transactions/filters/transactionFilters';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { Account } from '../../../domain/accounts/account.types';
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
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const { useEffect } = require('react');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), push: jest.fn() }),
    // Focus = mount in these tests.
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 9, 20, 15, 0, 0, 0); // 20 Oct 2026 15:00 local

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 10000,
    currency: 'INR',
    merchantName: `QA-Merchant-${id}`,
    categoryId: 'cat-food',
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

const account = (id: string, name: string): Account => ({
  id,
  name,
  type: 'bank',
  lastFour: '9999',
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: local(2026, 1, 1),
  updatedAt: local(2026, 1, 1),
});

const category = (id: string, name: string, type: Category['type']): Category => ({
  id,
  name,
  parentId: null,
  type,
  icon: 'shape-outline',
  isSystem: true,
  archivedAt: null,
  color: null,
});

const ROWS: Transaction[] = [
  tx('h1', { type: 'income', amountMinor: 100000, categoryId: 'cat-salary', occurredAt: local(2026, 10, 5) }),
  tx('h2', { amountMinor: 30000, categoryId: 'cat-food', occurredAt: local(2026, 10, 10) }),
  tx('h3', { amountMinor: 20000, categoryId: 'cat-shopping', occurredAt: local(2026, 10, 12) }),
  tx('h4', { amountMinor: 50000, categoryId: 'cat-food', occurredAt: local(2026, 9, 15) }),
  tx('h5', { type: 'income', amountMinor: 200000, categoryId: 'cat-salary', occurredAt: local(2026, 8, 20) }),
  tx('h6', { status: 'pending', amountMinor: 9900, occurredAt: local(2026, 10, 18), approvedAt: null }),
  tx('h7', {
    type: 'transfer',
    amountMinor: 70000,
    categoryId: 'cat-transfer',
    transferAccountId: 'acc-qa-2',
    occurredAt: local(2026, 10, 11),
  }),
  tx('h8', { type: 'income', amountMinor: 400000, categoryId: 'cat-salary', occurredAt: local(2026, 6, 10) }),
];

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function renderHome() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<HomeScreen />);
  });
  mounted.push(r);
  return r;
}

const tiles = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(StatTile).map(t => [t.props.label, t.props.amountMinor, t.props.caption]);
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string');

async function choosePeriod(r: ReactTestRenderer.ReactTestRenderer, period: string) {
  await ReactTestRenderer.act(async () => {
    byTestId(r, `period-chip-${period}`)[0].props.onPress();
  });
}

beforeEach(() => {
  mockNavigate.mockReset();
  jest.spyOn(clock, 'now').mockImplementation(() => new Date(NOW));
  useTransactionsStore.setState({
    transactions: ROWS,
    accounts: [account('acc-qa', 'QA Delete Bank 9999'), account('acc-qa-2', 'QA Wallet 8888')],
    categories: [
      category('cat-food', 'QA Food', 'expense'),
      category('cat-shopping', 'QA Shopping', 'expense'),
      category('cat-salary', 'QA Salary', 'income'),
    ],
    selectedPeriod: '1M',
    transactionFilters: DEFAULT_TRANSACTION_FILTERS,
    userName: 'QA',
  });
});

afterEach(async () => {
  // Unmount before the next test's setState so no stale tree re-renders.
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  jest.restoreAllMocks();
});

describe('Home tiles follow the selected period (B5)', () => {
  it('1M (default): this month only — not every approved row ever', async () => {
    const r = await renderHome();
    expect(tiles(r)).toEqual([
      ['INCOME', 100000, 'This month'],
      ['EXPENSES', 50000, 'This month'],
    ]);
  });

  it('switching chips changes amounts AND captions; the store holds the shared period', async () => {
    const r = await renderHome();
    await choosePeriod(r, '3M');
    expect(useTransactionsStore.getState().selectedPeriod).toBe('3M');
    expect(tiles(r)).toEqual([
      ['INCOME', 300000, 'Last 3 months'],
      ['EXPENSES', 100000, 'Last 3 months'],
    ]);
    await choosePeriod(r, '1Y');
    expect(tiles(r)).toEqual([
      ['INCOME', 700000, 'Last 12 months'],
      ['EXPENSES', 100000, 'Last 12 months'],
    ]);
  });

  it('total balance stays all-time whatever the period', async () => {
    const r = await renderHome();
    const balance = () => r.root.findByType(BalanceCard).props.totalBalanceMinor;
    expect(balance()).toBe(600000);
    await choosePeriod(r, '3M');
    expect(balance()).toBe(600000);
  });

  it('the selected chip announces "selected"', async () => {
    const r = await renderHome();
    expect(byTestId(r, 'period-chip-1M')[0].props.accessibilityState).toEqual({ selected: true });
    expect(byTestId(r, 'period-chip-3M')[0].props.accessibilityState).toEqual({ selected: false });
  });

  it('pending hint (count only) and the partial-data notice', async () => {
    const r = await renderHome();
    expect(texts(r)).toContain('1 pending not included');
    expect(byTestId(r, 'period-partial-notice')).toHaveLength(0);
    await choosePeriod(r, '6M'); // starts 1 May; first approved row is 10 Jun
    expect(texts(r)).toContain('Records start 10 Jun 2026 — earlier months may be incomplete.');
  });

  it('the date line comes from the injected clock', async () => {
    const r = await renderHome();
    expect(texts(r)).toContain('October 2026');
  });
});

describe('Home "Where it went" card', () => {
  it('R4e donut: legend rows for the period; the centre total equals the EXPENSES tile', async () => {
    const r = await renderHome();
    const legend = r.root.findAll(
      n =>
        typeof n.type !== 'string' &&
        typeof n.props.testID === 'string' &&
        n.props.testID.startsWith('where-it-went-legend-') &&
        n.props.accessibilityRole === 'button',
    );
    const seen = new Set<string>();
    const labels = legend
      .filter(n => (seen.has(n.props.testID) ? false : (seen.add(n.props.testID), true)))
      .map(n => n.props.accessibilityLabel);
    expect(labels).toEqual(['QA Food, 60%, ₹300', 'QA Shopping, 40%, ₹200']);
    const donut = byTestId(r, 'where-it-went-donut')[0];
    expect(donut.props.accessibilityLabel).toBe(
      'Spending by category, ₹500 in total: QA Food 60%, QA Shopping 40%',
    );
    const expenseTile = tiles(r).find(t => t[0] === 'EXPENSES');
    expect(expenseTile?.[1]).toBe(50000);
    expect(texts(r)).toContain('₹500');
  });

  it('a legend row AND a slice open Transactions filtered by that category (period unchanged); See all opens Insights', async () => {
    const r = await renderHome();
    await ReactTestRenderer.act(async () => {
      byTestId(r, 'where-it-went-legend-cat-food')[0].props.onPress();
    });
    expect(useTransactionsStore.getState().transactionFilters).toEqual({
      ...DEFAULT_TRANSACTION_FILTERS,
      categoryId: 'cat-food',
    });
    expect(useTransactionsStore.getState().selectedPeriod).toBe('1M');
    expect(mockNavigate).toHaveBeenCalledWith('Transactions');

    mockNavigate.mockReset();
    useTransactionsStore.getState().resetTransactionFilters();
    await ReactTestRenderer.act(async () => {
      byTestId(r, 'chart-donut-slice-cat-shopping')[0].props.onPress();
    });
    expect(useTransactionsStore.getState().transactionFilters).toEqual({
      ...DEFAULT_TRANSACTION_FILTERS,
      categoryId: 'cat-shopping',
    });
    expect(mockNavigate).toHaveBeenCalledWith('Transactions');

    await ReactTestRenderer.act(async () => {
      byTestId(r, 'where-it-went-see-all')[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Insights');
  });

  it('empty state when nothing was spent in the period', async () => {
    useTransactionsStore.setState({ transactions: ROWS.filter(t => t.type !== 'expense') });
    const r = await renderHome();
    expect(texts(r)).toContain('No spending this month.');
  });
});
