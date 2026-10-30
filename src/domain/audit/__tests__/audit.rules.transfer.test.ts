import { changedTransactionFields, sanitizeAuditMetadata } from '../audit.rules';
import { AuditMetadata } from '../audit.types';

const SNAP = {
  type: 'expense' as const,
  status: 'pending' as const,
  categoryId: 'cat-uncategorised',
  approvedAt: null,
  transferAccountId: null,
  linkedTransactionId: null,
  linkKind: null,
};

describe('R3a audit metadata', () => {
  it('transfer_paired keeps ids + previous enum/id fields only — extra properties (SMS text) are dropped', () => {
    const leaky = {
      kind: 'transfer_paired',
      debit_id: 'd1',
      credit_id: 'c1',
      sanitizedPreview: 'Rs.500 debited SECRET-SMS',
      previous: {
        debit: { ...SNAP, merchantName: 'SECRET-MERCHANT', sanitizedPreview: 'SECRET-SMS' },
        credit: { ...SNAP, type: 'income' as const, status: 'approved' as const, approvedAt: '2026-10-30T00:00:00.000Z' },
      },
    } as unknown as AuditMetadata;
    const clean = sanitizeAuditMetadata(leaky);
    const json = JSON.stringify(clean);
    expect(json).not.toMatch(/SECRET|debited|merchantName|sanitizedPreview/);
    expect(clean).toEqual({
      kind: 'transfer_paired',
      debit_id: 'd1',
      credit_id: 'c1',
      previous: {
        debit: SNAP,
        credit: { ...SNAP, type: 'income', status: 'approved', approvedAt: '2026-10-30T00:00:00.000Z' },
      },
    });
  });

  it('transfer_unpaired keeps the two ids only', () => {
    const leaky = { kind: 'transfer_unpaired', debit_id: 'd1', credit_id: 'c1', note: 'SECRET' } as unknown as AuditMetadata;
    expect(sanitizeAuditMetadata(leaky)).toEqual({ kind: 'transfer_unpaired', debit_id: 'd1', credit_id: 'c1' });
  });

  it('a deleted transfer snapshot keeps its "to" account id', () => {
    expect(
      sanitizeAuditMetadata({
        kind: 'deleted',
        merchantName: 'Transfer',
        amountMinor: 50000,
        type: 'transfer',
        status: 'approved',
        transferAccountId: 'acc-w',
      }),
    ).toMatchObject({ type: 'transfer', transferAccountId: 'acc-w' });
  });

  it('changedTransactionFields reports transferAccountId and treats undefined as null', () => {
    const before = {
      type: 'expense' as const,
      amountMinor: 100,
      merchantName: 'QA',
      categoryId: 'cat-x',
      accountId: 'a',
      paymentMethod: 'upi' as const,
      occurredAt: 'x',
      note: null,
    };
    expect(
      changedTransactionFields(before, { type: 'transfer', transferAccountId: 'b', categoryId: 'cat-transfer', accountId: 'a' }),
    ).toEqual(['type', 'categoryId', 'transferAccountId']);
    expect(changedTransactionFields(before, { transferAccountId: null })).toEqual([]);
  });
});
