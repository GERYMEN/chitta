import {
  activeShares,
  canLinkAsRepayment,
  linkRepaymentPatch,
  personNet,
  splitTotalForExpense,
  totals,
  unlinkRepaymentPatch,
  validateManualAmount,
  validateSplit,
} from '../iou.rules';
import { IouShare } from '../iou.types';
import { Transaction } from '../../transactions/transaction.types';

function share(id: string, patch: Partial<IouShare> = {}): IouShare {
  return {
    id,
    personId: 'p-qa-1',
    direction: 'lent',
    sourceTransactionId: 'exp-1',
    amountMinor: 10000,
    note: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    settledAt: null,
    repaymentTransactionId: null,
    ...patch,
  };
}

describe('personNet / totals', () => {
  const shares = [
    share('a', { amountMinor: 30000 }),
    share('b', { amountMinor: 5000, direction: 'borrowed', sourceTransactionId: null }),
    share('c', { amountMinor: 99999, settledAt: '2026-10-02T00:00:00.000Z' }),
  ];
  it('net = unsettled lent minus unsettled borrowed (settled ignored)', () => {
    expect(personNet(shares)).toBe(25000);
    expect(personNet([share('x', { direction: 'borrowed', amountMinor: 700 })])).toBe(-700);
    expect(personNet([])).toBe(0);
  });
  it('totals split into you-get / you-owe over unsettled only', () => {
    expect(totals(shares)).toEqual({ youGetMinor: 30000, youOweMinor: 5000 });
    expect(totals([])).toEqual({ youGetMinor: 0, youOweMinor: 0 });
  });
});

describe('activeShares (30-day rule, now passed in)', () => {
  const now = new Date('2026-11-20T12:00:00.000Z');
  const fresh = share('fresh', { settledAt: '2026-11-01T00:00:00.000Z' });
  const old = share('old', { settledAt: '2026-10-01T00:00:00.000Z' });
  const open = share('open');
  it('keeps unsettled and recently settled, hides settled > 30 days ago', () => {
    expect(activeShares([fresh, old, open], now).map(s => s.id)).toEqual(['fresh', 'open']);
  });
  it('boundary: exactly 30 days ago is still shown; 30 days + 1 ms is hidden', () => {
    const edge = share('edge', { settledAt: new Date(now.getTime() - 30 * 86400000).toISOString() });
    const past = share('past', { settledAt: new Date(now.getTime() - 30 * 86400000 - 1).toISOString() });
    expect(activeShares([edge, past], now).map(s => s.id)).toEqual(['edge']);
  });
});

describe('validateSplit', () => {
  const p = (amountMinor: number) => ({ personId: 'p-qa-1', newName: null, amountMinor });
  it('accepts shares summing to <= the expense (equal is fine)', () => {
    expect(validateSplit([p(60000), p(40000)], 100000)).toBeNull();
    expect(validateSplit([p(25000)], 100000)).toBeNull();
  });
  it('rejects a sum over the expense', () => {
    expect(validateSplit([p(60000), p(40001)], 100000)).toBe('over-expense');
  });
  it('counts shares already recorded against the expense', () => {
    expect(validateSplit([p(30000)], 100000, 80000)).toBe('over-expense');
    expect(validateSplit([p(20000)], 100000, 80000)).toBeNull();
  });
  it('rejects zero / negative / fractional amounts, no shares, and nameless shares', () => {
    expect(validateSplit([p(0)], 100000)).toBe('amount-not-positive');
    expect(validateSplit([p(-5)], 100000)).toBe('amount-not-positive');
    expect(validateSplit([p(10.5)], 100000)).toBe('amount-not-whole');
    expect(validateSplit([], 100000)).toBe('no-shares');
    expect(validateSplit([{ personId: null, newName: '   ', amountMinor: 100 }], 100000)).toBe('no-person');
    expect(validateSplit([{ personId: null, newName: 'QA Person', amountMinor: 100 }], 100000)).toBeNull();
  });
  it('manual amounts must be positive whole paise', () => {
    expect(validateManualAmount(1)).toBeNull();
    expect(validateManualAmount(0)).toBe('amount-not-positive');
    expect(validateManualAmount(1.5)).toBe('amount-not-whole');
  });
});

describe('splitTotalForExpense', () => {
  it('counts lent shares of that expense; owed excludes settled', () => {
    const rows = [
      share('a', { amountMinor: 100 }),
      share('b', { amountMinor: 200, settledAt: '2026-10-02T00:00:00.000Z' }),
      share('c', { amountMinor: 400, sourceTransactionId: 'exp-2' }),
      share('d', { amountMinor: 800, direction: 'borrowed', sourceTransactionId: null }),
    ];
    expect(splitTotalForExpense(rows, 'exp-1')).toEqual({ count: 2, minor: 300, owedMinor: 100, owedCount: 1 });
  });
});

describe('repayment link helpers', () => {
  const credit = {
    id: 'cr-1',
    type: 'income',
    status: 'approved',
    amountMinor: 5000,
    linkKind: null,
    linkedTransactionId: null,
    transferAccountId: null,
    updatedAt: 'x',
  } as unknown as Transaction;
  it('only an approved, unlinked income not already used can be linked', () => {
    expect(canLinkAsRepayment(credit, [])).toBe(true);
    expect(canLinkAsRepayment({ ...credit, status: 'pending' }, [])).toBe(false);
    expect(canLinkAsRepayment({ ...credit, type: 'expense' }, [])).toBe(false);
    expect(canLinkAsRepayment({ ...credit, linkKind: 'refund', linkedTransactionId: 'e' }, [])).toBe(false);
    expect(canLinkAsRepayment(credit, [share('a', { repaymentTransactionId: 'cr-1' })])).toBe(false);
  });
  it('link sets iou_repayment + source id; unlink restores nulls; amount untouched', () => {
    const linked = linkRepaymentPatch(credit, 'exp-1', 'now');
    expect(linked).toMatchObject({ linkKind: 'iou_repayment', linkedTransactionId: 'exp-1', amountMinor: 5000 });
    expect(unlinkRepaymentPatch(linked, 'later')).toMatchObject({ linkKind: null, linkedTransactionId: null });
    // Only touches iou_repayment links.
    const refund = { ...credit, linkKind: 'refund', linkedTransactionId: 'e' } as Transaction;
    expect(unlinkRepaymentPatch(refund, 'later')).toBe(refund);
  });
});
