import { Bill } from '../bill.types';
import {
  billUrgency,
  remainingMinor,
  isBillPaid,
  dueBannerModel,
  billSections,
  creditUsage,
  DUE_SOON_DAYS,
} from '../bill.rules';

const NOW = new Date('2026-11-15T10:00:00+05:30');

function bill(partial: Partial<Bill>): Bill {
  return {
    id: partial.id ?? 'bill-1',
    accountId: partial.accountId ?? null,
    kind: partial.kind ?? 'manual',
    payee: partial.payee ?? 'QA Biller',
    amountDueMinor: partial.amountDueMinor ?? 100000,
    minDueMinor: partial.minDueMinor ?? null,
    statementDate: partial.statementDate ?? null,
    dueDate: partial.dueDate ?? null,
    status: partial.status ?? 'open',
    paidMinor: partial.paidMinor ?? 0,
    paidTransactionId: partial.paidTransactionId ?? null,
    source: partial.source ?? 'manual',
    sourceHash: partial.sourceHash ?? null,
    repeat: partial.repeat ?? 'none',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

describe('billUrgency (D-f)', () => {
  it('overdue: open and due_date before today', () => {
    expect(billUrgency(bill({ dueDate: '2026-11-14T00:00:00+05:30' }), NOW)).toBe('overdue');
  });

  it('due_soon: open and due within 7 days (inclusive)', () => {
    expect(billUrgency(bill({ dueDate: '2026-11-15T23:00:00+05:30' }), NOW)).toBe('due_soon');
    expect(billUrgency(bill({ dueDate: '2026-11-22T09:00:00+05:30' }), NOW)).toBe('due_soon');
  });

  it('later: open and due more than 7 days away', () => {
    expect(billUrgency(bill({ dueDate: '2026-11-23T09:00:00+05:30' }), NOW)).toBe('later');
  });

  it('later: open with no due date', () => {
    expect(billUrgency(bill({ dueDate: null }), NOW)).toBe('later');
  });

  it('done: paid or dismissed is never overdue / due soon', () => {
    expect(billUrgency(bill({ status: 'paid', dueDate: '2026-11-01T00:00:00+05:30' }), NOW)).toBe('done');
    expect(billUrgency(bill({ status: 'dismissed', dueDate: '2026-11-01T00:00:00+05:30' }), NOW)).toBe('done');
  });

  it('DUE_SOON_DAYS is 7', () => {
    expect(DUE_SOON_DAYS).toBe(7);
  });
});

describe('remainingMinor / isBillPaid', () => {
  it('remaining = amount due − paid, floored at 0', () => {
    expect(remainingMinor(bill({ amountDueMinor: 100000, paidMinor: 30000 }))).toBe(70000);
    expect(remainingMinor(bill({ amountDueMinor: 100000, paidMinor: 150000 }))).toBe(0);
  });

  it('isBillPaid when paid_minor >= amount_due_minor', () => {
    expect(isBillPaid(bill({ amountDueMinor: 100000, paidMinor: 100000 }))).toBe(true);
    expect(isBillPaid(bill({ amountDueMinor: 100000, paidMinor: 99999 }))).toBe(false);
  });
});

describe('dueBannerModel (D-g)', () => {
  it('hidden when nothing is overdue or due soon', () => {
    expect(dueBannerModel([bill({ dueDate: '2026-12-30T00:00:00+05:30' })], NOW)).toBeNull();
    expect(dueBannerModel([], NOW)).toBeNull();
  });

  it('counts overdue + due-soon bills, sums remaining, next date, overdue flag', () => {
    const model = dueBannerModel(
      [
        bill({ id: 'a', dueDate: '2026-11-14T00:00:00+05:30', amountDueMinor: 50000 }), // overdue
        bill({ id: 'b', dueDate: '2026-11-18T00:00:00+05:30', amountDueMinor: 100000, paidMinor: 40000 }), // due soon, partial
        bill({ id: 'c', dueDate: '2026-12-30T00:00:00+05:30', amountDueMinor: 9999 }), // later — excluded
        bill({ id: 'd', status: 'paid', dueDate: '2026-11-10T00:00:00+05:30' }), // done — excluded
      ],
      NOW,
    );
    expect(model).not.toBeNull();
    expect(model!.count).toBe(2);
    expect(model!.totalMinor).toBe(50000 + 60000);
    expect(model!.nextDueDate).toBe('2026-11-14T00:00:00+05:30');
    expect(model!.hasOverdue).toBe(true);
  });
});

describe('billSections (D-h)', () => {
  it('splits into overdue / dueSoon / later / paidDismissed', () => {
    const sections = billSections(
      [
        bill({ id: 'o', dueDate: '2026-11-10T00:00:00+05:30' }),
        bill({ id: 's', dueDate: '2026-11-18T00:00:00+05:30' }),
        bill({ id: 'l', dueDate: '2026-12-20T00:00:00+05:30' }),
        bill({ id: 'p', status: 'paid' }),
        bill({ id: 'x', status: 'dismissed' }),
      ],
      NOW,
    );
    expect(sections.overdue.map(b => b.id)).toEqual(['o']);
    expect(sections.dueSoon.map(b => b.id)).toEqual(['s']);
    expect(sections.later.map(b => b.id)).toEqual(['l']);
    expect(sections.paidDismissed.map(b => b.id).sort()).toEqual(['p', 'x']);
  });
});

describe('creditUsage (D-b)', () => {
  it('used = outstanding, available = limit − used', () => {
    expect(creditUsage(200000, -50000)).toEqual({ usedMinor: 50000, limitMinor: 200000, availableMinor: 150000 });
  });

  it('available floors at 0 when over limit', () => {
    expect(creditUsage(100000, -150000)).toEqual({ usedMinor: 150000, limitMinor: 100000, availableMinor: 0 });
  });

  it('null when no limit set', () => {
    expect(creditUsage(null, -50000)).toBeNull();
  });
});
