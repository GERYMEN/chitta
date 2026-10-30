import { Transaction } from '../../../domain/transactions/transaction.types';
import { Account } from '../../../domain/accounts/account.types';
import { Category } from '../../../domain/categories/category.types';
import { rowToTransaction, transactionToRow } from '../transaction.mapper';
import { rowToAccount, accountToRow } from '../account.mapper';
import { rowToCategory, categoryToRow } from '../category.mapper';

const transaction: Transaction = {
  id: 'txn-1',
  type: 'expense',
  status: 'pending',
  amountMinor: 45000,
  currency: 'INR',
  merchantName: 'Swiggy',
  categoryId: 'cat-food',
  accountId: 'acc-1',
  paymentMethod: 'upi',
  occurredAt: '2026-10-01T19:32:00.000Z',
  detectedAt: '2026-10-01T19:32:05.000Z',
  approvedAt: null,
  note: null,
  sourceType: 'sms',
  sourceReferenceHash: '427509182341',
  sanitizedPreview: 'INR 450.00 debited',
  confidenceScore: 98,
  parserVersion: 'on-device-sms-v2.4',
  bulkBatchId: null,
  createdAt: '2026-10-01T19:32:05.000Z',
  updatedAt: '2026-10-01T19:32:05.000Z',
};

const account: Account = {
  id: 'acc-1',
  name: 'HDFC Bank',
  type: 'bank',
  lastFour: '4021',
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const category: Category = {
  id: 'cat-food',
  name: 'Food & Dining',
  parentId: null,
  type: 'expense',
  icon: 'silverware-fork-knife',
  isSystem: true,
  archivedAt: null,
  color: null,
};

describe('transaction mapper', () => {
  it('round-trips a transaction through row form', () => {
    expect(rowToTransaction(transactionToRow(transaction))).toEqual(transaction);
  });

  it('maps nullable columns back from null', () => {
    const row = transactionToRow(transaction);
    const mapped = rowToTransaction(row);
    expect(mapped.approvedAt).toBeNull();
    expect(mapped.note).toBeNull();
  });

  it('round-trips a bulkBatchId through row form', () => {
    const batched = { ...transaction, bulkBatchId: 'batch-2026-10-01' };
    expect(rowToTransaction(transactionToRow(batched))).toEqual(batched);
  });

  it('maps an absent bulk_batch_id back to null', () => {
    const mapped = rowToTransaction(transactionToRow(transaction));
    expect(mapped.bulkBatchId).toBeNull();
  });
});

describe('account mapper', () => {
  it('round-trips an account and encodes isActive as 0/1', () => {
    const row = accountToRow(account);
    expect(row.is_active).toBe(1);
    expect(rowToAccount(row)).toEqual(account);
  });

  it('maps is_active 0 back to boolean false', () => {
    const inactive = rowToAccount(accountToRow({ ...account, isActive: false }));
    expect(inactive.isActive).toBe(false);
  });

  it('round-trips balance anchor and deleted_at fields', () => {
    const anchored: Account = {
      ...account,
      balanceAnchorMinor: 500000,
      balanceAnchorAt: '2026-09-15T12:00:00.000Z',
      deletedAt: '2026-09-20T00:00:00.000Z',
    };
    expect(rowToAccount(accountToRow(anchored))).toEqual(anchored);
  });

  it('maps absent balance anchor / deleted_at columns back to null', () => {
    const mapped = rowToAccount(accountToRow(account));
    expect(mapped.balanceAnchorMinor).toBeNull();
    expect(mapped.balanceAnchorAt).toBeNull();
    expect(mapped.deletedAt).toBeNull();
  });

  it('stores balance_anchor_at / deleted_at as epoch ms in the row', () => {
    const row = accountToRow({
      ...account,
      balanceAnchorAt: '2026-09-15T12:00:00.000Z',
      deletedAt: '2026-09-20T00:00:00.000Z',
    });
    expect(row.balance_anchor_at).toBe(Date.parse('2026-09-15T12:00:00.000Z'));
    expect(row.deleted_at).toBe(Date.parse('2026-09-20T00:00:00.000Z'));
  });
});

describe('category mapper', () => {
  it('round-trips a category and encodes isSystem as 0/1', () => {
    const row = categoryToRow(category);
    expect(row.is_system).toBe(1);
    expect(rowToCategory(row)).toEqual(category);
  });

  it('maps is_system 0 back to boolean false', () => {
    const custom = rowToCategory(categoryToRow({ ...category, isSystem: false }));
    expect(custom.isSystem).toBe(false);
  });
});
