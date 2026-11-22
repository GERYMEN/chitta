import { sanitizeAuditMetadata } from '../audit.rules';
import type { AuditMetadata } from '../audit.types';

// Regression: R5c budget audits previously hit the sanitizer's `default` case
// and lost ALL metadata (returned null), so the Activity feed showed budget
// changes with no amount/category. The sanitizer now keeps the safe fields.
describe('R5c budget audit metadata sanitize', () => {
  it('keeps categoryId + amount for budget_set (drops a smuggled name)', () => {
    expect(
      sanitizeAuditMetadata({
        kind: 'budget_set',
        categoryId: 'cat-food',
        amountMinor: 500000,
        name: 'Secret',
      } as unknown as AuditMetadata),
    ).toEqual({ kind: 'budget_set', categoryId: 'cat-food', amountMinor: 500000 });
  });

  it('maps a null categoryId (overall budget) to null, keeps amount', () => {
    expect(
      sanitizeAuditMetadata({ kind: 'budget_set', categoryId: null, amountMinor: 1200000 }),
    ).toEqual({ kind: 'budget_set', categoryId: null, amountMinor: 1200000 });
  });

  it('keeps categoryId + amount for budget_deleted', () => {
    expect(
      sanitizeAuditMetadata({ kind: 'budget_deleted', categoryId: 'cat-fuel', amountMinor: 300000 }),
    ).toEqual({ kind: 'budget_deleted', categoryId: 'cat-fuel', amountMinor: 300000 });
  });

  it('keeps categoryId + amount + changed fields for budget_updated', () => {
    expect(
      sanitizeAuditMetadata({
        kind: 'budget_updated',
        categoryId: 'cat-food',
        amountMinor: 600000,
        fields: ['amountMinor'],
      }),
    ).toEqual({
      kind: 'budget_updated',
      categoryId: 'cat-food',
      amountMinor: 600000,
      fields: ['amountMinor'],
    });
  });

  it('does not return null for a budget event (the old bug)', () => {
    expect(
      sanitizeAuditMetadata({ kind: 'budget_set', categoryId: null, amountMinor: 1 }),
    ).not.toBeNull();
  });
});
