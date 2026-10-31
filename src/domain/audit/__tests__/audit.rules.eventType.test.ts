import { editedMetadata, sanitizeAuditMetadata } from '../audit.rules';
import { AuditMetadata } from '../audit.types';

describe('B4 audit metadata: type at event time (enum only)', () => {
  it('created / approved / rejected keep only a known type; junk is dropped', () => {
    for (const kind of ['created', 'approved', 'rejected'] as const) {
      const leaky = { kind, transactionType: 'expense', merchantName: 'SECRET', amountMinor: 5000 } as unknown as AuditMetadata;
      expect(sanitizeAuditMetadata(leaky)).toEqual({ kind, transactionType: 'expense' });
      const bad = { kind, transactionType: 'SECRET-TEXT' } as unknown as AuditMetadata;
      expect(sanitizeAuditMetadata(bad)).toBeNull();
    }
  });

  it('detected / auto_approved / edited accept an optional valid type and drop anything else', () => {
    expect(
      sanitizeAuditMetadata({ kind: 'detected', confidence: 90, transactionType: 'income' }),
    ).toEqual({ kind: 'detected', confidence: 90, transactionType: 'income' });
    expect(
      sanitizeAuditMetadata({ kind: 'detected', confidence: 90, transactionType: 'nope' } as unknown as AuditMetadata),
    ).toEqual({ kind: 'detected', confidence: 90 });
    expect(
      sanitizeAuditMetadata({ kind: 'auto_approved', confidence: 90, threshold: 85, transactionType: 'expense' }),
    ).toEqual({ kind: 'auto_approved', confidence: 90, threshold: 85, transactionType: 'expense' });
    const edited = {
      kind: 'edited',
      fields: ['type'],
      transactionType: 'transfer',
      fromType: 'expense',
      toType: 'transfer',
      note: 'SECRET',
    } as unknown as AuditMetadata;
    const clean = sanitizeAuditMetadata(edited);
    expect(clean).toEqual({
      kind: 'edited',
      fields: ['type'],
      transactionType: 'transfer',
      fromType: 'expense',
      toType: 'transfer',
    });
    expect(JSON.stringify(clean)).not.toContain('SECRET');
    // Pre-R4 rows stay valid.
    expect(sanitizeAuditMetadata({ kind: 'edited', fields: ['note'] })).toEqual({ kind: 'edited', fields: ['note'] });
  });

  it('editedMetadata: from/to only when the type changes', () => {
    expect(editedMetadata({ type: 'expense' }, { type: 'transfer' }, ['type', 'transferAccountId'])).toEqual({
      kind: 'edited',
      fields: ['type', 'transferAccountId'],
      transactionType: 'transfer',
      fromType: 'expense',
      toType: 'transfer',
    });
    expect(editedMetadata({ type: 'income' }, {}, ['note'])).toEqual({
      kind: 'edited',
      fields: ['note'],
      transactionType: 'income',
    });
  });
});
