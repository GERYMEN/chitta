import React from 'react';
import { SectionList, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { TransactionsScreen } from '../screens/TransactionsScreen';
import { useTransactionsStore } from '../state/transactionsStore';
import { DEFAULT_TRANSACTION_FILTERS, merchantFilterFor } from '../filters/transactionFilters';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { clock } from '../../../shared/utils/clock';

jest.mock('../../../data/db/connection', () => ({
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

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
// 31 Oct 2026 — far from the old fixture "today" (1 Oct 2026).
const NOW = new Date(2026, 9, 31, 10, 0, 0, 0);

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'approved',
    amountMinor: 10000,
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
  tx('today', { amountMinor: 10000, occurredAt: local(2026, 10, 31, 9) }),
  tx('yesterday', { merchantName: 'QA-Merchant-13', amountMinor: 20000, occurredAt: local(2026, 10, 30, 18) }),
  tx('first', { amountMinor: 40000, occurredAt: local(2026, 10, 1, 12) }),
  tx('september', { amountMinor: 80000, occurredAt: local(2026, 9, 15) }),
  tx('pending', { status: 'pending', amountMinor: 5000, occurredAt: local(2026, 10, 20), approvedAt: null }),
];

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function renderScreen() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<TransactionsScreen />);
  });
  mounted.push(r);
  return r;
}

const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string');
/** What the list shows (the SectionList renders lazily, so read its data). */
const sectionsOf = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findByType(SectionList).props.sections as Array<{ title: string; data: Transaction[] }>;
const rowAmounts = (r: ReactTestRenderer.ReactTestRenderer) =>
  sectionsOf(r).flatMap(section => section.data.map(row => row.amountMinor));
const press = async (r: ReactTestRenderer.ReactTestRenderer, id: string) => {
  await ReactTestRenderer.act(async () => {
    byTestId(r, id)[0].props.onPress();
  });
};

beforeEach(() => {
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
  // Unmount before the next test's setState so no stale tree re-renders.
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  jest.restoreAllMocks();
});

describe('Transactions: injected now (B1) + period filter (R4)', () => {
  it('TODAY / YESTERDAY come from the injected device clock', async () => {
    const r = await renderScreen();
    const titles = sectionsOf(r).map(section => section.title);
    expect(titles[0]).toBe('TODAY');
    expect(titles[1]).toBe('YESTERDAY');
    // The old fixture "today" (1 Oct) is just a date now.
    expect(titles[2]).not.toMatch(/TODAY|YESTERDAY/);
    expect(texts(r)).toContain('TODAY');
    // Row subtitles use the same now.
    expect(texts(r).some(t => t.startsWith('Today, '))).toBe(true);
  });

  it('1M lists this month only; totals, subtitle and pending hint follow it', async () => {
    const r = await renderScreen();
    expect(rowAmounts(r)).toEqual([10000, 20000, 40000]);
    const all = texts(r);
    expect(all).toContain('3 Settled · This month');
    expect(all).toContain('₹700'); // SPENT for October only
    expect(all).toContain('1 pending not included');
    expect(byTestId(r, 'filter-reset')).toHaveLength(0);
  });

  it('3M widens the list; Reset puts the period back to 1M (shared with Home)', async () => {
    const r = await renderScreen();
    await press(r, 'period-chip-3M');
    expect(rowAmounts(r)).toEqual([10000, 20000, 40000, 80000]);
    expect(texts(r)).toContain('4 Settled · Last 3 months');
    await press(r, 'filter-reset');
    expect(useTransactionsStore.getState().selectedPeriod).toBe('1M');
    expect(rowAmounts(r)).toEqual([10000, 20000, 40000]);
  });

  it('merchant filter: removable "Merchant: <name> ✕" chip; search box unchanged', async () => {
    useTransactionsStore.setState({ transactionFilters: merchantFilterFor('QA-Merchant-12') });
    const r = await renderScreen();
    expect(texts(r)).toContain('Merchant: QA-Merchant-12 ✕');
    expect(rowAmounts(r)).toEqual([10000, 40000]);
    expect(byTestId(r, 'transactions-search')[0].props.value).toBe('');
    await press(r, 'filter-merchant');
    expect(useTransactionsStore.getState().transactionFilters.merchantKey).toBeNull();
    expect(texts(r)).not.toContain('Merchant: QA-Merchant-12 ✕');
    expect(rowAmounts(r)).toEqual([10000, 20000, 40000]);
  });
});
