import {
  canResetFilters,
  DEFAULT_TRANSACTION_FILTERS,
  filterTransactions,
  hasActiveFilters,
} from '../transactionFilters';
import { DEFAULT_PERIOD } from '../../../../domain/periods/period.rules';

const base = {
  type: 'expense' as const,
  accountId: 'acc-a',
  categoryId: 'cat-food',
  merchantName: 'QA-Merchant',
  note: null,
  occurredAt: '2026-10-10T10:00:00.000Z',
};
const ROWS = [
  { ...base, id: '1', paymentMethod: 'upi' as const, customTagKeys: ['qa trip'] },
  { ...base, id: '2', paymentMethod: 'card' as const, customTagKeys: [] },
  { ...base, id: '3', paymentMethod: 'other' as const, customTagKeys: ['qa trip', 'qa other'] },
  { ...base, id: '4', paymentMethod: 'upi' as const },
];
const withTag = (tagKey: string | null) => ({ ...DEFAULT_TRANSACTION_FILTERS, tagKey, tagLabel: tagKey });

describe('R11 tag filter', () => {
  it('a custom tag matches rows carrying it', () => {
    expect(filterTransactions(ROWS, withTag('qa trip')).map(r => r.id)).toEqual(['1', '3']);
  });
  it('an auto tag matches rows whose payment method derives it', () => {
    expect(filterTransactions(ROWS, withTag('#UPI')).map(r => r.id)).toEqual(['1', '4']);
    expect(filterTransactions(ROWS, withTag('#Card')).map(r => r.id)).toEqual(['2']);
    expect(filterTransactions(ROWS, withTag('#Bank'))).toEqual([]);
  });
  it('no tag selected = no narrowing; a tag counts as an active filter and enables Reset', () => {
    expect(filterTransactions(ROWS, withTag(null))).toHaveLength(4);
    expect(hasActiveFilters(withTag('#UPI'))).toBe(true);
    expect(canResetFilters(withTag('#UPI'), DEFAULT_PERIOD)).toBe(true);
    expect(hasActiveFilters(withTag(null))).toBe(false);
  });
});
