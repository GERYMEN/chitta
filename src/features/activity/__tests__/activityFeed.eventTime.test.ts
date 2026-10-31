import { describeActivity, typesAtEventTime } from '../activityFeed';
import { AuditFeedEvent } from '../../../domain/audit/audit.types';
import { TransactionType } from '../../../domain/transactions/transaction.types';
import { TransferRowSnapshot } from '../../../domain/transfers/transfer.rules';

/**
 * B4: Activity describes each row as it was AT EVENT TIME (its type), not as
 * the live row is now. Events are given newest first, like the feed.
 */
let seq = 100;
function event(partial: Partial<AuditFeedEvent>): AuditFeedEvent {
  seq -= 1;
  return {
    id: `aud-${seq}`,
    seq,
    transactionId: 'e1',
    accountId: 'acc-bank',
    eventType: 'approved',
    eventAt: '2026-10-28T10:00:00.000Z',
    actor: 'user',
    metadata: null,
    deletedSnapshot: null,
    ...partial,
  };
}

const BANK = { name: 'QA Delete Bank', lastFour: '9999' };
const WALLET = { name: 'QA Wallet 8888', lastFour: null };
/** Live row: an expense that was later marked as a transfer. */
const LIVE_TRANSFER = { merchantName: 'QA-Merchant-09', amountMinor: 10000, type: 'transfer' as const };
const live = (types: Record<string, TransactionType>) => (id: string) => types[id] ?? null;

function sentences(events: AuditFeedEvent[], liveType: TransactionType = 'transfer') {
  const types = typesAtEventTime(events, live({ e1: liveType }));
  return events.map(e =>
    describeActivity(
      e,
      {
        transaction: { ...LIVE_TRANSFER, type: liveType },
        account: BANK,
        transferAccount: WALLET,
        typeAtEvent: types.get(e.id) ?? null,
      },
      { showAmounts: true },
    ),
  );
}

const snapshot = (type: TransactionType): TransferRowSnapshot => ({
  type,
  status: 'pending',
  categoryId: 'cat-uncategorised',
  approvedAt: null,
  transferAccountId: null,
  linkedTransactionId: null,
  linkKind: null,
});

describe('B4: sentences use the type at event time', () => {
  it('new events (R4 metadata): created/approved stay expense, the mark-as-transfer edit reads "moved"', () => {
    const events = [
      event({
        eventType: 'edited',
        metadata: {
          kind: 'edited',
          fields: ['type', 'categoryId', 'transferAccountId'],
          transactionType: 'transfer',
          fromType: 'expense',
          toType: 'transfer',
        },
      }),
      event({ eventType: 'approved', metadata: { kind: 'approved', transactionType: 'expense' } }),
      event({ eventType: 'created', metadata: { kind: 'created', transactionType: 'expense' } }),
    ];
    const [edited, approved, created] = sentences(events);
    expect(edited.sentence).toBe('You moved ₹100.00 from QA Delete Bank ••9999 to QA Wallet 8888');
    expect(edited.impact?.text).toBe('Marked as a transfer · not income or expense');
    expect(approved.sentence).toBe('You approved QA-Merchant-09 ₹100.00');
    expect(approved.impact).toEqual({ text: 'Balance -₹100.00', tone: 'expense' });
    expect(created.sentence).toBe('You added QA-Merchant-09 ₹100.00');
    expect(created.impact?.text).toBe('Waiting for approval');
  });

  it('pre-R4 events: derived from the later mark-as-transfer edit (expense: account unchanged)', () => {
    const events = [
      event({ eventType: 'edited', metadata: { kind: 'edited', fields: ['type', 'categoryId', 'transferAccountId'] } }),
      event({ eventType: 'approved' }),
      event({ eventType: 'created' }),
    ];
    const types = typesAtEventTime(events, live({ e1: 'transfer' }));
    expect(events.map(e => types.get(e.id))).toEqual(['transfer', 'expense', 'expense']);
    const [, approved, created] = sentences(events);
    expect(created.sentence).toBe('You added QA-Merchant-09 ₹100.00');
    expect(approved.impact?.tone).toBe('expense');
  });

  it('pre-R4 events: an income marked as transfer (its account moved too) was income', () => {
    const events = [
      event({
        eventType: 'edited',
        metadata: { kind: 'edited', fields: ['type', 'categoryId', 'accountId', 'transferAccountId'] },
      }),
      event({ eventType: 'approved' }),
    ];
    const types = typesAtEventTime(events, live({ e1: 'transfer' }));
    expect(types.get(events[1].id)).toBe('income');
    expect(sentences(events)[1].impact).toEqual({ text: 'Balance +₹100.00', tone: 'income' });
  });

  it('pre-R4 income ↔ expense edit flips the older events', () => {
    const events = [
      event({ eventType: 'edited', metadata: { kind: 'edited', fields: ['type', 'amountMinor'] } }),
      event({ eventType: 'created' }),
    ];
    const types = typesAtEventTime(events, live({ e1: 'income' }));
    expect(events.map(e => types.get(e.id))).toEqual(['income', 'expense']);
  });

  it('pre-R4 events: derived from the transfer_paired previous snapshot (both rows)', () => {
    const events = [
      event({
        eventType: 'transfer_paired',
        metadata: {
          kind: 'transfer_paired',
          debit_id: 'e1',
          credit_id: 'c1',
          previous: { debit: snapshot('expense'), credit: snapshot('income') },
        },
      }),
      event({ eventType: 'approved' }),
      event({ eventType: 'detected', transactionId: 'c1', metadata: { kind: 'detected', confidence: 95 } }),
      event({ eventType: 'detected', metadata: { kind: 'detected', confidence: 95 } }),
    ];
    const types = typesAtEventTime(events, live({ e1: 'transfer', c1: 'income' }));
    expect(events.map(e => types.get(e.id))).toEqual(['transfer', 'expense', 'income', 'expense']);
    const [paired, approved] = sentences(events);
    expect(paired.sentence).toContain('You moved');
    expect(approved.impact).toEqual({ text: 'Balance -₹100.00', tone: 'expense' });
  });

  it('a transfer that was undone: events between pairing and undo were the transfer', () => {
    const events = [
      event({ eventType: 'transfer_unpaired', metadata: { kind: 'transfer_unpaired', debit_id: 'e1', credit_id: 'c1' } }),
      event({ eventType: 'edited', metadata: { kind: 'edited', fields: ['note'] } }),
      event({
        eventType: 'transfer_paired',
        metadata: {
          kind: 'transfer_paired',
          debit_id: 'e1',
          credit_id: 'c1',
          previous: { debit: snapshot('expense'), credit: snapshot('income') },
        },
      }),
      event({ eventType: 'detected', metadata: { kind: 'detected', confidence: 95 } }),
    ];
    const types = typesAtEventTime(events, live({ e1: 'expense' }));
    expect(events.map(e => types.get(e.id))).toEqual(['expense', 'transfer', 'transfer', 'expense']);
  });

  it('no type-changing event and no recorded type → the current row', () => {
    const events = [event({ eventType: 'approved' }), event({ eventType: 'created' })];
    const types = typesAtEventTime(events, live({ e1: 'income' }));
    expect(events.map(e => types.get(e.id))).toEqual(['income', 'income']);
    // A transfer created as one keeps reading "You moved".
    expect(sentences([event({ eventType: 'created' })])[0].sentence).toContain('You moved');
  });

  it('a deleted row falls back to its deleted snapshot type', () => {
    const deleted = {
      kind: 'deleted' as const,
      merchantName: 'QA-Merchant-10',
      amountMinor: 2500,
      type: 'income' as const,
      status: 'approved' as const,
    };
    const events = [
      event({ eventType: 'deleted', transactionId: 'gone', metadata: deleted }),
      event({ eventType: 'approved', transactionId: 'gone', deletedSnapshot: deleted }),
    ];
    const types = typesAtEventTime(events, live({}));
    expect(types.get(events[1].id)).toBe('income');
  });
});
