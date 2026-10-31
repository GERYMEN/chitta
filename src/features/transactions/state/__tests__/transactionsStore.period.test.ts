import { useTransactionsStore } from '../transactionsStore';
import { DEFAULT_TRANSACTION_FILTERS } from '../../filters/transactionFilters';
import { getDatabase } from '../../../../data/db/connection';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

describe('R4 selected period in the store (session-only)', () => {
  it('starts at 1M', () => {
    expect(useTransactionsStore.getState().selectedPeriod).toBe('1M');
  });

  it('is set in memory only: no database write, no setting, no audit row', () => {
    useTransactionsStore.getState().setSelectedPeriod('6M');
    expect(useTransactionsStore.getState().selectedPeriod).toBe('6M');
    expect(getDatabase).not.toHaveBeenCalled();
  });

  it('Reset puts the filters AND the period back to the defaults', () => {
    const store = useTransactionsStore.getState();
    store.setSelectedPeriod('1Y');
    store.setTransactionFilters({ categoryId: 'cat-food', merchantKey: 'qa merchant 12', merchantLabel: 'QA-Merchant-12' });
    useTransactionsStore.getState().resetTransactionFilters();
    expect(useTransactionsStore.getState().selectedPeriod).toBe('1M');
    expect(useTransactionsStore.getState().transactionFilters).toEqual(DEFAULT_TRANSACTION_FILTERS);
  });

  it('changing filters never touches the period', () => {
    useTransactionsStore.getState().setSelectedPeriod('3M');
    useTransactionsStore.getState().setTransactionFilters({ query: 'qa' });
    expect(useTransactionsStore.getState().selectedPeriod).toBe('3M');
  });
});
