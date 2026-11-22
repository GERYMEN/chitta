import { Bill } from '../../bills/bill.types';
import { RecurringSeries } from '../../recurring/recurring.types';
import { Transaction } from '../../transactions/transaction.types';
import {
  buildScheduledNotifications,
  NotificationSettings,
  PlanInput,
} from '../notifications.rules';

const NOW = new Date(2026, 10, 20, 10, 0); // Fri 20 Nov 2026, 10:00 local
const local = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h, 0, 0, 0).getTime();
const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

const OFF: NotificationSettings = {
  bills: false,
  recurring: false,
  weekly: false,
  weeklyDay: 0,
  weeklyHour: 9,
};

function bill(p: Partial<Bill> & { id: string }): Bill {
  return {
    accountId: null,
    kind: 'manual',
    payee: 'QA Biller',
    amountDueMinor: 150000,
    minDueMinor: null,
    statementDate: null,
    dueDate: iso(2026, 11, 22),
    status: 'open',
    paidMinor: 0,
    paidTransactionId: null,
    source: 'manual',
    sourceHash: null,
    repeat: 'none',
    createdAt: iso(2026, 11, 1),
    updatedAt: iso(2026, 11, 1),
    ...p,
  };
}

function series(key: string, nextDueAt: string): RecurringSeries {
  return {
    merchantKey: key,
    displayName: 'QA Streamer',
    cadence: 'monthly',
    typicalAmountMinor: 19900,
    lastAt: iso(2026, 10, 25),
    nextDueAt,
    occurrenceCount: 4,
  };
}

function tx(p: Partial<Transaction> & { id: string }): Transaction {
  return {
    type: 'expense',
    status: 'approved',
    amountMinor: 50000,
    currency: 'INR',
    merchantName: 'QA Shop',
    categoryId: 'cat-qa',
    accountId: 'acc-qa',
    paymentMethod: 'upi',
    occurredAt: iso(2026, 11, 18),
    detectedAt: iso(2026, 11, 18),
    approvedAt: iso(2026, 11, 18),
    note: null,
    sourceType: 'manual',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: null,
    parserVersion: null,
    bulkBatchId: null,
    createdAt: iso(2026, 11, 18),
    updatedAt: iso(2026, 11, 18),
    ...p,
  };
}

function plan(p: Partial<PlanInput> = {}) {
  return buildScheduledNotifications({
    bills: [],
    recurring: [],
    remindedKeys: [],
    transactions: [],
    settings: OFF,
    now: NOW,
    hideAmounts: false,
    ...p,
  });
}

describe('buildScheduledNotifications', () => {
  it('is empty when every toggle is off, whatever the data', () => {
    const items = plan({
      bills: [bill({ id: 'b1' })],
      recurring: [series('qa streamer', iso(2026, 11, 25))],
      remindedKeys: ['qa streamer'],
      transactions: [tx({ id: 't1' }), tx({ id: 't2', status: 'pending' })],
    });
    expect(items).toEqual([]);
  });

  describe('bills', () => {
    const settings = { ...OFF, bills: true };

    it('due-soon bill: due date 09:00 local, bills channel', () => {
      const items = plan({ settings, bills: [bill({ id: 'b1' })] });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: 'bill:b1', channel: 'bills', whenEpochMs: local(2026, 11, 22) });
      expect(items[0].body).toContain('QA Biller bill is due');
      expect(items[0].body).toContain('~₹1,500');
    });

    it('overdue bill: next 09:00 after now (tomorrow when 09:00 already passed)', () => {
      const items = plan({ settings, bills: [bill({ id: 'b1', dueDate: iso(2026, 11, 15) })] });
      expect(items[0].whenEpochMs).toBe(local(2026, 11, 21));
      expect(items[0].body).toContain('overdue');
    });

    it('overdue bill before 09:00 fires today at 09:00', () => {
      const items = plan({
        settings,
        now: new Date(2026, 10, 20, 7, 0),
        bills: [bill({ id: 'b1', dueDate: iso(2026, 11, 15) })],
      });
      expect(items[0].whenEpochMs).toBe(local(2026, 11, 20));
    });

    it('bill due today after 09:00 is not fired immediately (next 09:00)', () => {
      const items = plan({ settings, bills: [bill({ id: 'b1', dueDate: iso(2026, 11, 20, 18) })] });
      expect(items[0].whenEpochMs).toBe(local(2026, 11, 21));
    });

    it('skips paid, dismissed, later (>7 days) and undated bills', () => {
      const items = plan({
        settings,
        bills: [
          bill({ id: 'paid', status: 'paid', paidMinor: 150000 }),
          bill({ id: 'gone', status: 'dismissed' }),
          bill({ id: 'later', dueDate: iso(2026, 12, 30) }),
          bill({ id: 'undated', dueDate: null }),
        ],
      });
      expect(items).toEqual([]);
    });

    it('uses the remaining amount for a part-paid bill', () => {
      const items = plan({ settings, bills: [bill({ id: 'b1', paidMinor: 50000 })] });
      expect(items[0].body).toContain('~₹1,000');
    });

    it('PRIVATE MODE: no amount and no payee name', () => {
      const items = plan({ settings, hideAmounts: true, bills: [bill({ id: 'b1' })] });
      expect(items[0].body).toBe('A bill is due');
      expect(JSON.stringify(items)).not.toMatch(/₹|1,500|1500|QA Biller/);
    });
  });

  describe('recurring', () => {
    const settings = { ...OFF, recurring: true };
    const s = series('qa streamer', iso(2026, 11, 25));

    it('only series the user asked to be reminded about', () => {
      expect(plan({ settings, recurring: [s] })).toEqual([]);
      const items = plan({ settings, recurring: [s], remindedKeys: ['qa streamer'] });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ channel: 'reminders', whenEpochMs: local(2026, 11, 25) });
      expect(items[0].body).toBe('QA Streamer is usually due around now');
      expect(items[0].id.startsWith('rec:')).toBe(true);
      expect(items[0].id).not.toContain('streamer');
    });

    it('nothing when the recurring toggle is off even if reminded', () => {
      expect(plan({ settings: OFF, recurring: [s], remindedKeys: ['qa streamer'] })).toEqual([]);
    });

    it('skips a due date that has already passed (no immediate fire)', () => {
      const past = series('qa streamer', iso(2026, 11, 18));
      expect(plan({ settings, recurring: [past], remindedKeys: ['qa streamer'] })).toEqual([]);
    });

    it('PRIVATE MODE: no merchant name', () => {
      const items = plan({ settings, hideAmounts: true, recurring: [s], remindedKeys: ['qa streamer'] });
      expect(items[0].body).toBe('A recurring payment is usually due around now');
      expect(JSON.stringify(items)).not.toMatch(/Streamer|streamer/);
    });
  });

  describe('weekly summary', () => {
    const settings = { ...OFF, weekly: true, weeklyDay: 0, weeklyHour: 9 };

    it('next Sunday 09:00 with spend over the last 7 days and the pending count', () => {
      const items = plan({
        settings,
        transactions: [
          tx({ id: 't1', amountMinor: 50000 }),
          tx({ id: 't2', amountMinor: 25000, occurredAt: iso(2026, 11, 19) }),
          tx({ id: 'old', amountMinor: 999900, occurredAt: iso(2026, 10, 1) }),
          tx({ id: 'p1', status: 'pending' }),
          tx({ id: 'p2', status: 'pending' }),
        ],
      });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: 'weekly', channel: 'summary', whenEpochMs: local(2026, 11, 22) });
      expect(items[0].body).toBe('This week: spent ₹750, 2 pending');
    });

    it('same weekday after the hour has passed goes to next week; before the hour is today', () => {
      const fri = { ...settings, weeklyDay: 5 };
      expect(plan({ settings: fri })[0].whenEpochMs).toBe(local(2026, 11, 27));
      expect(plan({ settings: fri, now: new Date(2026, 10, 20, 8, 0) })[0].whenEpochMs).toBe(local(2026, 11, 20));
    });

    it('honours the chosen hour', () => {
      const items = plan({ settings: { ...settings, weeklyDay: 5, weeklyHour: 18 } });
      expect(items[0].whenEpochMs).toBe(local(2026, 11, 20, 18));
    });

    it('PRIVATE MODE: no rupee figure', () => {
      const items = plan({ settings, hideAmounts: true, transactions: [tx({ id: 't1' })] });
      expect(items[0].body).toBe('Your weekly summary is ready');
      expect(JSON.stringify(items)).not.toMatch(/₹|500/);
    });
  });

  it('reconcile: the whole set is rebuilt, a paid bill drops out', () => {
    const settings = { ...OFF, bills: true };
    const open = bill({ id: 'b1' });
    expect(plan({ settings, bills: [open] }).map(i => i.id)).toEqual(['bill:b1']);
    const paid = { ...open, status: 'paid' as const, paidMinor: open.amountDueMinor };
    expect(plan({ settings, bills: [paid] })).toEqual([]);
  });

  it('ids are unique and stable between runs', () => {
    const settings = { bills: true, recurring: true, weekly: true, weeklyDay: 0, weeklyHour: 9 };
    const input = {
      settings,
      bills: [bill({ id: 'b1' }), bill({ id: 'b2' })],
      recurring: [series('qa streamer', iso(2026, 11, 25))],
      remindedKeys: ['qa streamer'],
    };
    const a = plan(input).map(i => i.id);
    expect(new Set(a).size).toBe(a.length);
    expect(plan(input).map(i => i.id)).toEqual(a);
  });
});
