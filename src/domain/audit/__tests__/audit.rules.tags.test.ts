import { sanitizeAuditMetadata } from '../audit.rules';
import type { AuditMetadata } from '../audit.types';

describe('R11 audit metadata sanitize', () => {
  it('keeps ids only for tag events (drops a smuggled name)', () => {
    expect(
      sanitizeAuditMetadata({ kind: 'tag_added', tagId: 't', transactionId: 'x', name: 'Secret' } as unknown as AuditMetadata),
    ).toEqual({ kind: 'tag_added', tagId: 't', transactionId: 'x' });
    expect(
      sanitizeAuditMetadata({ kind: 'tag_removed', tagId: 't', transactionId: 'x' }),
    ).toEqual({ kind: 'tag_removed', tagId: 't', transactionId: 'x' });
  });
  it('keeps the transaction id only for receipt events (drops a smuggled path)', () => {
    expect(
      sanitizeAuditMetadata({ kind: 'receipt_added', transactionId: 'x', path: '/a/b.jpg' } as unknown as AuditMetadata),
    ).toEqual({ kind: 'receipt_added', transactionId: 'x' });
    expect(sanitizeAuditMetadata({ kind: 'receipt_removed', transactionId: 'x' })).toEqual({
      kind: 'receipt_removed',
      transactionId: 'x',
    });
  });
});
