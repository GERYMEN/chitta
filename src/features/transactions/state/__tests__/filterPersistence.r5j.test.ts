/**
 * R5j T6 — Transactions filters persist across a restart (owner-optional).
 * Synthetic ids only.
 */
import { useTransactionsStore } from '../transactionsStore';
import { getDatabase } from '../../../../data/db/connection';
import { createFakeDb, FakeDb } from '../../../../test/fakeDb';
import { DEFAULT_TRANSACTION_FILTERS } from '../../filters/transactionFilters';
import { DEFAULT_PERIOD } from '../../../../domain/periods/period.rules';
import {
  FILTERS_SETTING_KEY,
  flushFilterPersistence,
  noteLoadedFilters,
  parsePersistedFilters,
  serializeFilters,
} from '../../filters/filterPersistence';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const account = (id: string) => ({
  id,
  name: `QA ${id}`,
  type: 'bank',
  last_four: '9999',
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
});
const category = (id: string) => ({
  id, name: id, parent_id: null, type: 'expense', icon: 'x', is_system: 1, archived_at: null, color: null,
});

let db: FakeDb;
function seed(settings: Array<{ key: string; value: string }> = []) {
  db = createFakeDb({ accounts: [account('acc-a')], categories: [category('cat-food')], app_settings: settings });
  mockGetDatabase.mockReturnValue(db as never);
}
const stored = () => db.tables.get('app_settings')?.get(FILTERS_SETTING_KEY)?.value as string | undefined;

beforeEach(() => {
  noteLoadedFilters(null);
  seed();
  useTransactionsStore.setState({
    transactionFilters: DEFAULT_TRANSACTION_FILTERS,
    selectedPeriod: DEFAULT_PERIOD,
  });
});
afterEach(() => mockGetDatabase.mockReset());

describe('serialize / parse', () => {
  it('keeps type, account, category and period; never the search text or merchant', () => {
    const raw = serializeFilters(
      { ...DEFAULT_TRANSACTION_FILTERS, type: 'expense', accountId: 'acc-a', categoryId: 'cat-food', query: 'qa secret', merchantKey: 'qa', merchantLabel: 'QA' },
      '3M',
    );
    expect(raw).not.toContain('qa secret');
    expect(raw).not.toContain('merchant');
    const parsed = parsePersistedFilters(raw, { accountIds: ['acc-a'], categoryIds: ['cat-food'] });
    expect(parsed).toEqual({
      filters: { ...DEFAULT_TRANSACTION_FILTERS, type: 'expense', accountId: 'acc-a', categoryId: 'cat-food' },
      period: '3M',
    });
  });

  it('garbage, unknown enums and vanished ids fall back to defaults', () => {
    const known = { accountIds: ['acc-a'], categoryIds: ['cat-food'] };
    expect(parsePersistedFilters(null, known)).toBeNull();
    expect(parsePersistedFilters('not json', known)).toBeNull();
    expect(parsePersistedFilters('{"v":1,"type":"nope","period":"7Y","accountId":"gone","categoryId":"gone"}', known)).toEqual({
      filters: DEFAULT_TRANSACTION_FILTERS,
      period: DEFAULT_PERIOD,
    });
  });
});

describe('store wiring', () => {
  it('an applied filter is written and restored on the next launch', async () => {
    const store = useTransactionsStore.getState();
    store.setTransactionFilters({ type: 'expense', accountId: 'acc-a' });
    store.setSelectedPeriod('6M');
    await flushFilterPersistence();
    expect(stored()).toBeDefined();

    // "restart": fresh in-memory state, same database
    useTransactionsStore.setState({ transactionFilters: DEFAULT_TRANSACTION_FILTERS, selectedPeriod: DEFAULT_PERIOD });
    await useTransactionsStore.getState().reloadFromDatabase();
    const state = useTransactionsStore.getState();
    expect(state.transactionFilters).toMatchObject({ type: 'expense', accountId: 'acc-a', query: '' });
    expect(state.selectedPeriod).toBe('6M');
  });

  it('typing a search does not write anything', async () => {
    useTransactionsStore.getState().setTransactionFilters({ query: 'qa' });
    await flushFilterPersistence();
    expect(stored()).toBeUndefined();
  });

  it('Reset clears the saved filters, so the next launch starts empty', async () => {
    const store = useTransactionsStore.getState();
    store.setTransactionFilters({ type: 'income' });
    await flushFilterPersistence();
    useTransactionsStore.getState().resetTransactionFilters();
    await flushFilterPersistence();

    useTransactionsStore.setState({ transactionFilters: { ...DEFAULT_TRANSACTION_FILTERS, type: 'expense' } });
    await useTransactionsStore.getState().reloadFromDatabase();
    expect(useTransactionsStore.getState().transactionFilters).toEqual(DEFAULT_TRANSACTION_FILTERS);
    expect(useTransactionsStore.getState().selectedPeriod).toBe(DEFAULT_PERIOD);
  });

  it('a saved account that no longer exists is dropped on launch', async () => {
    seed([{ key: FILTERS_SETTING_KEY, value: '{"v":1,"type":"expense","accountId":"acc-gone","categoryId":null,"period":"1M"}' }]);
    await useTransactionsStore.getState().reloadFromDatabase();
    expect(useTransactionsStore.getState().transactionFilters).toMatchObject({ type: 'expense', accountId: null });
  });
});

describe('R11 tag filter persistence', () => {
  const known = { accountIds: [], categoryIds: [], tagKeys: ['qa trip'] };
  it('round-trips a custom tag and an auto tag; drops a custom tag that no longer exists', () => {
    const custom = { ...DEFAULT_TRANSACTION_FILTERS, tagKey: 'qa trip', tagLabel: 'QA Trip' };
    expect(
      parsePersistedFilters(serializeFilters(custom, DEFAULT_PERIOD), known)?.filters,
    ).toMatchObject({ tagKey: 'qa trip', tagLabel: 'QA Trip' });
    const auto = { ...DEFAULT_TRANSACTION_FILTERS, tagKey: '#UPI', tagLabel: '#UPI' };
    expect(parsePersistedFilters(serializeFilters(auto, DEFAULT_PERIOD), known)?.filters.tagKey).toBe('#UPI');
    expect(
      parsePersistedFilters(serializeFilters(custom, DEFAULT_PERIOD), { ...known, tagKeys: [] })?.filters.tagKey,
    ).toBeNull();
  });
  it('an old stored value without a tag loads with none', () => {
    const old = JSON.stringify({ v: 1, type: 'all', accountId: null, categoryId: null, period: DEFAULT_PERIOD });
    expect(parsePersistedFilters(old, known)?.filters.tagKey).toBeNull();
  });
});
