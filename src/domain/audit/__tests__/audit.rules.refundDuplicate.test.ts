import { sanitizeAuditMetadata } from '../audit.rules';
import { AuditMetadata } from '../audit.types';

describe('R3b audit metadata sanitizer', () => {
  it('keeps only the whitelisted id/enum fields of refund events', () => {
    const dirty = {
      kind: 'refund_linked',
      refund_id: 'r1',
      expense_id: 'e1',
      previous_category_id: null,
      category_id: 'cat-shopping',
      sanitizedPreview: 'Rs.100 refunded QA-SECRET',
      merchantName: 'QA-Merchant-10',
      amountMinor: 10000,
    } as unknown as AuditMetadata;
    expect(sanitizeAuditMetadata(dirty)).toEqual({
      kind: 'refund_linked',
      refund_id: 'r1',
      expense_id: 'e1',
      previous_category_id: null,
      category_id: 'cat-shopping',
    });
    expect(
      sanitizeAuditMetadata({ kind: 'refund_unlinked', refund_id: 'r1', expense_id: 'e1', note: 'x' } as unknown as AuditMetadata),
    ).toEqual({ kind: 'refund_unlinked', refund_id: 'r1', expense_id: 'e1' });
  });

  it('keeps only ids + the previous snapshot fields of duplicate events', () => {
    const dirty = {
      kind: 'duplicate_marked',
      kept_id: 'a',
      duplicate_id: 'b',
      previous: {
        type: 'expense',
        status: 'pending',
        categoryId: 'cat-food',
        approvedAt: null,
        transferAccountId: null,
        linkedTransactionId: null,
        linkKind: null,
        sanitizedPreview: 'QA-SECRET',
        amountMinor: 5000,
      },
    } as unknown as AuditMetadata;
    const clean = sanitizeAuditMetadata(dirty);
    expect(JSON.stringify(clean)).not.toMatch(/SECRET|5000/);
    expect(clean).toEqual({
      kind: 'duplicate_marked',
      kept_id: 'a',
      duplicate_id: 'b',
      previous: {
        type: 'expense',
        status: 'pending',
        categoryId: 'cat-food',
        approvedAt: null,
        transferAccountId: null,
        linkedTransactionId: null,
        linkKind: null,
      },
    });
    expect(
      sanitizeAuditMetadata({ kind: 'duplicate_restored', kept_id: 'a', duplicate_id: 'b' }),
    ).toEqual({ kind: 'duplicate_restored', kept_id: 'a', duplicate_id: 'b' });
  });
});
