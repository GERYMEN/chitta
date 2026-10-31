import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TransactionDetailScreen } from '../screens/TransactionDetailScreen';
import { useTransactionsStore } from '../state/transactionsStore';
import { DEFAULT_TRANSACTION_FILTERS } from '../filters/transactionFilters';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { clock } from '../../../shared/utils/clock';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
const mockNavigate = jest.fn();
const mockRoute: { params: { transactionId: string } } = { params: { transactionId: 'm1' } };
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const { useEffect } = require('react');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), push: jest.fn() }),
    useRoute: () => mockRoute,
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
    amountMinor: 20000,
    currency: 'INR',
    merchantName: 'QA-Merchant-12',
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

const ROWS: Transaction[] = [
  tx('m1', {}),
  tx('m2', { amountMinor: 30000, occurredAt: local(2026, 9, 15) }),
  tx('p1', { status: 'pending', approvedAt: null, occurredAt: local(2026, 10, 12) }),
  tx('t1', { type: 'transfer', categoryId: 'cat-transfer', transferAccountId: 'acc-qa-2' }),
  tx('i1', { type: 'income', merchantName: 'QA-Employer', amountMinor: 100000, categoryId: 'cat-salary' }),
];

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function renderDetail(transactionId: string) {
  mockRoute.params = { transactionId };
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<TransactionDetailScreen />);
  });
  mounted.push(r);
  return r;
}
const chip = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => n.props.testID === 'merchant-history-chip' && typeof n.type !== 'string')[0];

beforeEach(() => {
  mockNavigate.mockReset();
  jest.spyOn(clock, 'now').mockImplementation(() => new Date(NOW));
  useTransactionsStore.setState({
    transactions: ROWS,
    accounts: [],
    categories: [],
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

describe('Transaction detail merchant chip (R4 T5)', () => {
  it('approved expense: "N visits · ₹X <period>" for the selected period', async () => {
    const r = await renderDetail('m1');
    expect(chip(r).props.accessibilityLabel).toBe('1 visit · ₹200 this month. Show these transactions');
  });

  it('follows the shared period', async () => {
    useTransactionsStore.setState({ selectedPeriod: '3M' });
    const r = await renderDetail('m1');
    expect(chip(r).props.accessibilityLabel).toBe('2 visits · ₹500 last 3 months. Show these transactions');
  });

  it('approved income shows what came in', async () => {
    const r = await renderDetail('i1');
    expect(chip(r).props.accessibilityLabel).toBe('1 visit · ₹1,000 received this month. Show these transactions');
  });

  it('no chip on pending rows or transfers', async () => {
    expect(chip(await renderDetail('p1'))).toBeUndefined();
    expect(chip(await renderDetail('t1'))).toBeUndefined();
  });

  it('tap → Transactions filtered by the merchant key (other filters cleared, period kept)', async () => {
    useTransactionsStore.setState({
      transactionFilters: { ...DEFAULT_TRANSACTION_FILTERS, query: 'old', categoryId: 'cat-x' },
    });
    const r = await renderDetail('m1');
    await ReactTestRenderer.act(async () => {
      chip(r).props.onPress();
    });
    expect(useTransactionsStore.getState().transactionFilters).toEqual({
      ...DEFAULT_TRANSACTION_FILTERS,
      merchantKey: 'qa merchant 12',
      merchantLabel: 'QA-Merchant-12',
    });
    expect(useTransactionsStore.getState().selectedPeriod).toBe('1M');
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Transactions' });
  });
});
