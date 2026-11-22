/** R6 — pure reconcile helper. Synthetic numbers only. */
import {
  reconcileBalance,
  isDifferenceDismissed,
  differenceDirection,
  prefillForDifference,
  formatAsOf,
} from '../accountReconcile';
import { calculateBalance } from '../account.rules';
import { Account } from '../account.types';

type Snap = Pick<
  Account,
  | 'type'
  | 'openingBalanceMinor'
  | 'balanceAnchorMinor'
  | 'balanceAnchorAt'
  | 'smsBalanceMinor'
  | 'smsBalanceAt'
  | 'smsBalanceDismissedAt'
>;

const SMS_AT = '2026-11-10T10:00:00.000Z';
const base: Snap = {
  type: 'bank',
  openingBalanceMinor: 100000,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  smsBalanceMinor: 90000,
  smsBalanceAt: SMS_AT,
  smsBalanceDismissedAt: null,
};
const approved = (type: 'income' | 'expense', amountMinor: number, occurredAt = '2026-11-01T00:00:00.000Z') => ({
  status: 'approved' as const,
  type,
  amountMinor,
  accountId: 'acc-1',
  occurredAt,
});

describe('reconcileBalance', () => {
  it('returns null when there is no snapshot', () => {
    expect(reconcileBalance({ ...base, smsBalanceMinor: null, smsBalanceAt: null }, [], 'acc-1')).toBeNull();
    expect(reconcileBalance({ ...base, smsBalanceMinor: undefined, smsBalanceAt: undefined }, [], 'acc-1')).toBeNull();
  });

  it('positive diff: tracked is higher than the bank', () => {
    const r = reconcileBalance(base, [], 'acc-1');
    expect(r).toEqual({ trackedMinor: 100000, bankMinor: 90000, diffMinor: 10000, asOf: SMS_AT });
    expect(differenceDirection(r!.diffMinor)).toBe('higher');
  });

  it('negative diff: tracked is lower than the bank', () => {
    const r = reconcileBalance(base, [approved('expense', 20000)], 'acc-1');
    expect(r!.trackedMinor).toBe(80000);
    expect(r!.diffMinor).toBe(-10000);
    expect(differenceDirection(r!.diffMinor)).toBe('lower');
  });

  it('zero diff is reconciled', () => {
    const r = reconcileBalance(base, [approved('expense', 10000)], 'acc-1');
    expect(r!.diffMinor).toBe(0);
    expect(differenceDirection(0)).toBe('none');
  });

  it('uses calculateBalance (anchor included) for the tracked side, cut off at the snapshot time', () => {
    const anchored: Snap = { ...base, balanceAnchorMinor: 90000, balanceAnchorAt: '2026-11-05T00:00:00.000Z' };
    const txns = [approved('expense', 5000, '2026-11-01T00:00:00.000Z'), approved('income', 700, '2026-11-12T00:00:00.000Z')];
    const r = reconcileBalance(anchored, txns, 'acc-1');
    expect(r!.trackedMinor).toBe(calculateBalance(anchored, txns, 'acc-1', Date.parse(SMS_AT)));
    expect(r!.trackedMinor).toBe(90000); // anchor 90000 (row 11-01 is pre-anchor history; 11-12 is after the SMS)
  });

  it('after "Use bank balance" (anchor = bank, at the snapshot time) the difference is zero', () => {
    const txns = [approved('expense', 2000)];
    const before = reconcileBalance(base, txns, 'acc-1')!;
    expect(before.diffMinor).not.toBe(0);
    const anchored: Snap = { ...base, balanceAnchorMinor: before.bankMinor, balanceAnchorAt: SMS_AT };
    expect(reconcileBalance(anchored, txns, 'acc-1')!.diffMinor).toBe(0);
    // Activity after the snapshot then counts toward the CURRENT balance only.
    const later = [...txns, approved('expense', 700, '2026-11-12T00:00:00.000Z')];
    expect(reconcileBalance(anchored, later, 'acc-1')!.diffMinor).toBe(0);
    expect(calculateBalance(anchored, later, 'acc-1')).toBe(90000 - 700);
  });

  describe('like-for-like at the snapshot instant (no phantom difference)', () => {
    it('a transaction dated AFTER the snapshot does not create a difference', () => {
      // opening 100000, SMS says 90000 at SMS_AT after a 10000 expense (before it).
      const txns = [approved('expense', 10000, '2026-11-09T00:00:00.000Z'), approved('expense', 4000, '2026-11-12T00:00:00.000Z')];
      const r = reconcileBalance(base, txns, 'acc-1')!;
      expect(r.trackedMinor).toBe(90000);
      expect(r.diffMinor).toBe(0);
      // The current balance (now) still includes the later row.
      expect(calculateBalance(base, txns, 'acc-1')).toBe(86000);
    });

    it('a missing transaction dated BEFORE the snapshot still shows the real gap', () => {
      const txns = [approved('expense', 4000, '2026-11-12T00:00:00.000Z')];
      const r = reconcileBalance(base, txns, 'acc-1')!;
      expect(r.trackedMinor).toBe(100000);
      expect(r.diffMinor).toBe(10000);
    });

    it('a row at exactly the snapshot time is included (the SMS row itself)', () => {
      const r = reconcileBalance(base, [approved('expense', 10000, SMS_AT)], 'acc-1')!;
      expect(r.diffMinor).toBe(0);
    });

    it('pending / rejected rows never count', () => {
      const pending = { ...approved('expense', 10000), status: 'pending' as const };
      expect(reconcileBalance(base, [pending], 'acc-1')!.diffMinor).toBe(10000);
    });

    it('anchor BEFORE the snapshot: anchor + rows after the anchor up to the snapshot', () => {
      const anchored: Snap = { ...base, balanceAnchorMinor: 95000, balanceAnchorAt: '2026-11-05T00:00:00.000Z' };
      const txns = [
        approved('expense', 99999, '2026-11-01T00:00:00.000Z'), // before anchor: history only
        approved('expense', 5000, '2026-11-08T00:00:00.000Z'), // after anchor, before SMS
        approved('expense', 3000, '2026-11-11T00:00:00.000Z'), // after SMS: ignored here
      ];
      const r = reconcileBalance(anchored, txns, 'acc-1')!;
      expect(r.trackedMinor).toBe(90000);
      expect(r.diffMinor).toBe(0);
    });

    it('anchor AFTER the snapshot: compared from the pre-anchor baseline up to the snapshot', () => {
      const anchored: Snap = { ...base, balanceAnchorMinor: 12345, balanceAnchorAt: '2026-11-14T00:00:00.000Z' };
      const txns = [approved('expense', 10000, '2026-11-09T00:00:00.000Z'), approved('expense', 700, '2026-11-12T00:00:00.000Z')];
      const r = reconcileBalance(anchored, txns, 'acc-1')!;
      expect(r.trackedMinor).toBe(90000); // opening 100000 - 10000, anchor ignored
      expect(r.diffMinor).toBe(0);
    });

    it('calculateBalance without a cutoff is unchanged by an anchor/cutoff-free call', () => {
      const txns = [approved('expense', 10000, '2026-11-12T00:00:00.000Z')];
      expect(calculateBalance(base, txns, 'acc-1')).toBe(90000);
      expect(calculateBalance(base, txns, 'acc-1', Date.parse('2026-11-11T00:00:00.000Z'))).toBe(100000);
    });
  });

  it('liability accounts are not reconciled (an SMS "balance" there is not the ledger)', () => {
    expect(reconcileBalance({ ...base, type: 'credit_card' }, [], 'acc-1')).toBeNull();
    expect(reconcileBalance({ ...base, type: 'pay_later' }, [], 'acc-1')).toBeNull();
  });
});

describe('isDifferenceDismissed', () => {
  it('is dismissed only for the exact snapshot', () => {
    expect(isDifferenceDismissed(base)).toBe(false);
    expect(isDifferenceDismissed({ ...base, smsBalanceDismissedAt: SMS_AT })).toBe(true);
  });
  it('a newer snapshot re-surfaces the difference', () => {
    expect(
      isDifferenceDismissed({ ...base, smsBalanceAt: '2026-11-12T00:00:00.000Z', smsBalanceDismissedAt: SMS_AT }),
    ).toBe(false);
  });
});

describe('prefillForDifference', () => {
  it('tracked < bank -> income of abs(diff)', () => {
    expect(prefillForDifference(-10000)).toEqual({ type: 'income', amountMinor: 10000 });
  });
  it('tracked > bank -> expense of abs(diff)', () => {
    expect(prefillForDifference(2550)).toEqual({ type: 'expense', amountMinor: 2550 });
  });
  it('zero -> null', () => {
    expect(prefillForDifference(0)).toBeNull();
  });
});

describe('formatAsOf', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it('relative buckets', () => {
    expect(formatAsOf(ago(10_000), now)).toBe('just now');
    expect(formatAsOf(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(formatAsOf(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(formatAsOf(ago(30 * 3_600_000), now)).toBe('yesterday');
    expect(formatAsOf(ago(5 * 86_400_000), now)).toBe('5 days ago');
  });
  it('a future time clamps to just now; garbage is empty', () => {
    expect(formatAsOf(new Date(now.getTime() + 5000).toISOString(), now)).toBe('just now');
    expect(formatAsOf('nope', now)).toBe('');
  });
});
