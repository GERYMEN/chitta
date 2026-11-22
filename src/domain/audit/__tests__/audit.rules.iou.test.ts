import { sanitizeAuditMetadata } from '../audit.rules';
import { AuditMetadata } from '../audit.types';

describe('R10 IOU audit metadata sanitizer', () => {
  it('keeps ids / enum / numbers and drops planted extra fields (a person name or note)', () => {
    const planted = {
      kind: 'iou_share_added',
      shareId: 's1',
      personId: 'p1',
      direction: 'lent',
      amountMinor: 75000,
      sourceTransactionId: 't1',
      name: 'QA Person Planted',
      note: 'planted note',
    } as unknown as AuditMetadata;
    const clean = sanitizeAuditMetadata(planted);
    expect(clean).toEqual({
      kind: 'iou_share_added',
      shareId: 's1',
      personId: 'p1',
      direction: 'lent',
      amountMinor: 75000,
      sourceTransactionId: 't1',
    });
    expect(JSON.stringify(clean)).not.toMatch(/Planted|planted/);
  });

  it('round-trips person_added, repayment recorded/undone and share_deleted; clamps a bad direction', () => {
    expect(sanitizeAuditMetadata({ kind: 'iou_person_added', personId: 'p1', name: 'x' } as unknown as AuditMetadata)).toEqual({
      kind: 'iou_person_added',
      personId: 'p1',
    });
    for (const kind of ['iou_repayment_recorded', 'iou_repayment_undone'] as const) {
      expect(
        sanitizeAuditMetadata({ kind, shareId: 's', personId: 'p', direction: 'borrowed', amountMinor: 5, transactionId: null }),
      ).toEqual({ kind, shareId: 's', personId: 'p', direction: 'borrowed', amountMinor: 5, transactionId: null });
    }
    expect(
      sanitizeAuditMetadata({ kind: 'iou_share_deleted', shareId: 's', personId: 'p', direction: 'weird' as never, amountMinor: 9 }),
    ).toEqual({ kind: 'iou_share_deleted', shareId: 's', personId: 'p', direction: 'lent', amountMinor: 9 });
  });
});
