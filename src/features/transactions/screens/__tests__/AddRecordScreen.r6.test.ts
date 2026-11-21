/** R6 (D-e2/D-f) — "Add missing transaction" pre-fill + PENDING status. Synthetic. */
import { manualRecordStatus, prefillFromReconcile } from '../AddRecordScreen';
import { prefillForDifference } from '../../../../domain/accounts/accountReconcile';

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));

describe('prefillFromReconcile', () => {
  it('amount (rupees string), account and kind come from the difference; user can edit', () => {
    const p = prefillForDifference(-12345)!;
    expect(prefillFromReconcile({ accountId: 'acc-1', ...p })).toEqual({
      type: 'income',
      amount: '123.45',
      accountId: 'acc-1',
      merchantName: 'Balance difference',
      note: 'Added from a bank balance difference',
    });
    expect(prefillFromReconcile({ accountId: 'acc-1', type: 'expense', amountMinor: 50000 }).amount).toBe('500.00');
  });
});

describe('manualRecordStatus', () => {
  it('from a balance difference: PENDING, never approved (D-f)', () => {
    expect(manualRecordStatus({ accountId: 'a', type: 'expense', amountMinor: 1 }, '2026-11-10T00:00:00.000Z')).toEqual({
      status: 'pending',
      approvedAt: null,
    });
  });
  it('a normal manual record stays approved (R5 unchanged)', () => {
    expect(manualRecordStatus(null, '2026-11-10T00:00:00.000Z')).toEqual({
      status: 'approved',
      approvedAt: '2026-11-10T00:00:00.000Z',
    });
  });
});
