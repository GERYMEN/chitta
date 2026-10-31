import {
  accountShortLabel,
  ActivityContext,
  dayHeading,
  describeActivity as describeRaw,
  formatRelativeTime,
  groupActivityByDay,
  MASKED_AMOUNT,
  signedAmount,
} from '../activityFeed';
import { AuditFeedEvent } from '../../../domain/audit/audit.types';

/** The R1 sentence tests below run with amounts revealed (eye icon on). */
const describeActivity = (e: AuditFeedEvent, context: ActivityContext = {}) =>
  describeRaw(e, context, { showAmounts: true });

function event(partial: Partial<AuditFeedEvent>): AuditFeedEvent {
  return {
    id: 'aud-1',
    seq: 1,
    transactionId: 'txn-1',
    accountId: 'acc-1',
    eventType: 'approved',
    eventAt: '2026-10-28T10:00:00.000Z',
    actor: 'user',
    metadata: null,
    deletedSnapshot: null,
    ...partial,
  };
}

const EXPENSE = { merchantName: 'QA-Merchant-07', amountMinor: 5000, type: 'expense' as const };
const INCOME = { merchantName: 'QA-Payer', amountMinor: 120000, type: 'income' as const };
const ACCOUNT = { name: 'QA Delete Bank 9999', lastFour: '9999' };

describe('describeActivity sentences', () => {
  it('approved expense: sentence with amount, balance impact in expense tone', () => {
    const item = describeActivity(event({}), { transaction: EXPENSE });
    expect(item.sentence).toBe('You approved QA-Merchant-07 ₹50.00');
    expect(item.impact).toEqual({ text: 'Balance -₹50.00', tone: 'expense' });
    expect(item.transactionId).toBe('txn-1');
    expect(item.transactionDeleted).toBe(false);
    expect(item.icon).toBe('check-circle-outline');
  });

  it('approved income: positive green impact', () => {
    const item = describeActivity(event({}), { transaction: INCOME });
    expect(item.impact).toEqual({ text: 'Balance +₹1,200.00', tone: 'income' });
  });

  it('auto-approved: "at 90% match"', () => {
    const item = describeActivity(
      event({
        eventType: 'auto_approved',
        actor: 'system',
        metadata: { kind: 'auto_approved', confidence: 90, threshold: 85 },
      }),
      { transaction: EXPENSE },
    );
    expect(item.sentence).toBe('Auto-approved QA-Merchant-07 ₹50.00 at 90% match');
  });

  it('created (manual) and detected (SMS) wait for approval', () => {
    expect(describeActivity(event({ eventType: 'created' }), { transaction: EXPENSE })).toMatchObject({
      sentence: 'You added QA-Merchant-07 ₹50.00',
      impact: { text: 'Waiting for approval', tone: 'pending' },
    });
    expect(
      describeActivity(
        event({ eventType: 'detected', actor: 'system', metadata: { kind: 'detected', confidence: 90 } }),
        { transaction: EXPENSE },
      ),
    ).toMatchObject({
      sentence: 'Detected QA-Merchant-07 ₹50.00 from SMS',
      impact: { text: 'Waiting for approval · 90% match', tone: 'pending' },
    });
  });

  it('edited lists friendly field names', () => {
    const item = describeActivity(
      event({ eventType: 'edited', metadata: { kind: 'edited', fields: ['note', 'amountMinor'] } }),
      { transaction: EXPENSE },
    );
    expect(item.sentence).toBe('You edited QA-Merchant-07');
    expect(item.impact).toEqual({ text: 'Changed notes, amount', tone: 'neutral' });
  });

  it('rejected is not counted', () => {
    const item = describeActivity(event({ eventType: 'rejected' }), { transaction: EXPENSE });
    expect(item.sentence).toBe('You rejected QA-Merchant-07 ₹50.00');
    expect(item.impact?.text).toBe('Not counted in balance');
  });

  it('deleted uses its own snapshot and flags the transaction as gone', () => {
    const item = describeActivity(
      event({
        eventType: 'deleted',
        metadata: { kind: 'deleted', ...EXPENSE, status: 'approved' },
      }),
      { transaction: null },
    );
    expect(item.sentence).toBe('You deleted QA-Merchant-07 ₹50.00');
    expect(item.impact).toEqual({ text: 'No longer in balance (was -₹50.00)', tone: 'negative' });
    expect(item.transactionDeleted).toBe(true);
    expect(item.transactionId).toBe('txn-1');
  });

  it('deleted pending item: removed from records', () => {
    const item = describeActivity(
      event({ eventType: 'deleted', metadata: { kind: 'deleted', ...EXPENSE, status: 'pending' } }),
    );
    expect(item.impact?.text).toBe('Removed from records');
  });

  it('older events of a deleted transaction fall back to the deleted snapshot', () => {
    const item = describeActivity(
      event({ deletedSnapshot: { kind: 'deleted', ...EXPENSE, status: 'approved' } }),
      { transaction: null },
    );
    expect(item.sentence).toBe('You approved QA-Merchant-07 ₹50.00');
    expect(item.transactionDeleted).toBe(true);
  });

  it('unknown transaction: generic but never crashes', () => {
    const item = describeActivity(event({ eventType: 'approved' }));
    expect(item.sentence).toBe('You approved a transaction');
    expect(item.impact).toBeNull();
  });

  it('account events use ••last four', () => {
    const removed = describeActivity(
      event({ eventType: 'account_removed', transactionId: null }),
      { account: ACCOUNT },
    );
    expect(removed.sentence).toBe('You removed account ••9999');
    expect(removed.impact?.tone).toBe('negative');
    expect(removed.transactionId).toBeNull();
    expect(removed.transactionDeleted).toBe(false);

    expect(
      describeActivity(event({ eventType: 'account_restored', transactionId: null }), {
        account: ACCOUNT,
      }).sentence,
    ).toBe('You restored account ••9999');
    expect(
      describeActivity(event({ eventType: 'account_created', transactionId: null }), {
        account: { name: 'Cash', lastFour: null },
      }).sentence,
    ).toBe('You added account Cash');
    expect(
      describeActivity(
        event({
          eventType: 'account_updated',
          transactionId: null,
          metadata: { kind: 'account_updated', fields: ['name'] },
        }),
        { account: ACCOUNT },
      ).impact?.text,
    ).toBe('Changed name');
  });

  it('settings changes', () => {
    const on = describeActivity(
      event({
        eventType: 'settings_changed',
        transactionId: null,
        metadata: { kind: 'settings_changed', key: 'approval_mode', from: 'manual', to: 'auto' },
      }),
    );
    expect(on.sentence).toBe('You turned on auto-approve');
    const off = describeActivity(
      event({
        eventType: 'settings_changed',
        transactionId: null,
        metadata: { kind: 'settings_changed', key: 'approval_mode', from: 'auto', to: 'manual' },
      }),
    );
    expect(off.sentence).toBe('You turned off auto-approve');
    const threshold = describeActivity(
      event({
        eventType: 'settings_changed',
        transactionId: null,
        metadata: { kind: 'settings_changed', key: 'auto_approve_threshold', from: '90', to: '85' },
      }),
    );
    expect(threshold.sentence).toBe('You set the auto-approve threshold to 85%');
    expect(threshold.impact?.text).toBe('Was 90%');
  });
});

describe('formatting helpers', () => {
  it('signedAmount', () => {
    expect(signedAmount(5000, 'expense')).toBe('-₹50.00');
    expect(signedAmount(5000, 'income')).toBe('+₹50.00');
  });

  it('accountShortLabel', () => {
    expect(accountShortLabel(ACCOUNT)).toBe('••9999');
    expect(accountShortLabel({ name: 'Cash', lastFour: null })).toBe('Cash');
    expect(accountShortLabel(null)).toBe('an account');
  });

  it('formatRelativeTime', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0);
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    expect(formatRelativeTime(ago(10_000), now)).toBe('Just now');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(formatRelativeTime(new Date(2026, 9, 27, 9, 5).toISOString(), now)).toMatch(/9:05/);
  });

  it('dayHeading', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0);
    expect(dayHeading(new Date(2026, 9, 28, 1, 0).toISOString(), now)).toBe('Today');
    expect(dayHeading(new Date(2026, 9, 27, 23, 0).toISOString(), now)).toBe('Yesterday');
    expect(dayHeading(new Date(2026, 9, 20, 12, 0).toISOString(), now)).toMatch(/20/);
  });
});

describe('groupActivityByDay', () => {
  it('groups newest-first items by local day, preserving order', () => {
    const now = new Date(2026, 9, 28, 15, 0, 0);
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();
    const items = [
      describeActivity(event({ id: 'a', eventAt: at(28, 14) })),
      describeActivity(event({ id: 'b', eventAt: at(28, 9) })),
      describeActivity(event({ id: 'c', eventAt: at(27, 20) })),
      describeActivity(event({ id: 'd', eventAt: at(20, 8) })),
    ];
    const sections = groupActivityByDay(items, now);
    expect(sections.map(s => s.title.slice(0, 9))).toEqual(['Today', 'Yesterday', expect.any(String)]);
    expect(sections.map(s => s.data.map(i => i.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('empty in, empty out', () => {
    expect(groupActivityByDay([])).toEqual([]);
  });
});

describe('R2 T0 amount privacy', () => {
  const deletedApproved = event({
    eventType: 'deleted',
    metadata: {
      kind: 'deleted',
      merchantName: 'QA-Merchant-07',
      amountMinor: 5000,
      type: 'expense',
      status: 'approved',
    },
  });

  it('masks amounts by default in the sentence and the impact line, keeping the merchant', () => {
    const approved = describeRaw(event({}), { transaction: EXPENSE });
    expect(approved.sentence).toBe(`You approved QA-Merchant-07 ${MASKED_AMOUNT}`);
    expect(approved.impact).toEqual({ text: `Balance ${MASKED_AMOUNT}`, tone: 'expense' });

    const deleted = describeRaw(deletedApproved);
    expect(deleted.sentence).toBe(`You deleted QA-Merchant-07 ${MASKED_AMOUNT}`);
    expect(deleted.impact?.text).toBe(`No longer in balance (was ${MASKED_AMOUNT})`);
  });

  it('showAmounts: false masks every form; no digits of the amount leak', () => {
    const items = [
      describeRaw(event({ eventType: 'created' }), { transaction: EXPENSE }, { showAmounts: false }),
      describeRaw(
        event({
          eventType: 'auto_approved',
          actor: 'system',
          metadata: { kind: 'auto_approved', confidence: 90, threshold: 85 },
        }),
        { transaction: INCOME },
        { showAmounts: false },
      ),
      describeRaw(deletedApproved, {}, { showAmounts: false }),
      describeRaw(event({ eventType: 'rejected' }), { transaction: EXPENSE }, { showAmounts: false }),
    ];
    for (const item of items) {
      const text = `${item.sentence} ${item.impact?.text ?? ''}`;
      expect(text).not.toMatch(/50\.00|1,200|\+₹|-₹/);
    }
    expect(items[1].sentence).toBe(`Auto-approved QA-Payer ${MASKED_AMOUNT} at 90% match`);
  });

  it('showAmounts: true reveals the exact amounts', () => {
    const item = describeRaw(event({}), { transaction: INCOME }, { showAmounts: true });
    expect(item.sentence).toBe('You approved QA-Payer ₹1,200.00');
    expect(item.impact?.text).toBe('Balance +₹1,200.00');
  });
});

describe('R2 rule and category events', () => {
  const FOOD = { name: 'Food & Dining', archivedAt: null };

  it('rule_saved names the merchant (via the linked item) and the category', () => {
    const item = describeRaw(
      event({ eventType: 'rule_saved', metadata: { kind: 'rule_saved', categoryId: 'cat-food' } }),
      { transaction: EXPENSE, category: FOOD },
    );
    expect(item.sentence).toBe('You set QA-Merchant-07 to always use Food & Dining');
  });

  it('category events use the looked-up name and mark archived ones', () => {
    const archived = { name: 'QA Category', archivedAt: '2026-10-28T10:00:00.000Z' };
    expect(
      describeRaw(
        event({
          eventType: 'category_archived',
          transactionId: null,
          metadata: { kind: 'category_archived', categoryId: 'cat-qa' },
        }),
        { category: archived },
      ).sentence,
    ).toBe('You archived category QA Category');
    expect(
      describeRaw(
        event({
          eventType: 'category_updated',
          transactionId: null,
          metadata: { kind: 'category_updated', categoryId: 'cat-qa', fields: ['name', 'color'] },
        }),
        { category: FOOD },
      ).impact?.text,
    ).toBe('Changed name, colour');
  });
});

describe('R3a transfer sentences', () => {
  const TRANSFER = { merchantName: 'Transfer', amountMinor: 50000, type: 'transfer' as const };
  const BANK = { name: 'QA Delete Bank', lastFour: '9999' };
  const WALLET = { name: 'QA Wallet 8888', lastFour: null };

  it('a created transfer reads "You moved ₹ •••• from A to B" (masked by default)', () => {
    const item = describeRaw(event({ eventType: 'created' }), {
      transaction: TRANSFER,
      account: BANK,
      transferAccount: WALLET,
    });
    expect(item.sentence).toBe(`You moved ${MASKED_AMOUNT} from QA Delete Bank ••9999 to QA Wallet 8888`);
    expect(item.impact).toEqual({ text: 'Between your accounts · not income or expense', tone: 'neutral' });
  });

  it('revealed amount has no sign', () => {
    const item = describeActivity(event({ eventType: 'created' }), {
      transaction: TRANSFER,
      account: BANK,
      transferAccount: WALLET,
    });
    expect(item.sentence).toBe('You moved ₹500.00 from QA Delete Bank ••9999 to QA Wallet 8888');
    expect(signedAmount(50000, 'transfer')).toBe('₹500.00');
  });

  it('mark as transfer (edited type + transferAccountId) and a confirmed pair also read "You moved"', () => {
    const marked = describeRaw(
      event({ eventType: 'edited', metadata: { kind: 'edited', fields: ['type', 'categoryId', 'transferAccountId'] } }),
      { transaction: { ...TRANSFER, merchantName: 'QA-Merchant-09', amountMinor: 10000 }, account: BANK, transferAccount: WALLET },
    );
    expect(marked.sentence).toBe(`You moved ${MASKED_AMOUNT} from QA Delete Bank ••9999 to QA Wallet 8888`);
    expect(marked.impact?.text).toBe('Marked as a transfer · not income or expense');

    const paired = describeRaw(
      event({
        eventType: 'transfer_paired',
        metadata: {
          kind: 'transfer_paired',
          debit_id: 'd1',
          credit_id: 'c1',
          previous: {
            debit: { type: 'expense', status: 'pending', categoryId: 'cat-x', approvedAt: null, transferAccountId: null, linkedTransactionId: null, linkKind: null },
            credit: { type: 'income', status: 'pending', categoryId: 'cat-x', approvedAt: null, transferAccountId: null, linkedTransactionId: null, linkKind: null },
          },
        },
      }),
      { transaction: TRANSFER, account: BANK, transferAccount: WALLET },
    );
    expect(paired.sentence).toContain('You moved ₹ ••••');
    expect(paired.icon).toBe('swap-horizontal');
  });

  it('undo and a plain edit of a transfer', () => {
    const undone = describeRaw(
      event({ eventType: 'transfer_unpaired', metadata: { kind: 'transfer_unpaired', debit_id: 'd1', credit_id: 'c1' } }),
      { transaction: { ...TRANSFER, type: 'expense' as const } },
    );
    expect(undone.sentence).toBe(`You undid a transfer of ${MASKED_AMOUNT}`);
    expect(undone.impact?.tone).toBe('neutral');

    const edited = describeActivity(
      event({ eventType: 'edited', metadata: { kind: 'edited', fields: ['amountMinor'] } }),
      { transaction: TRANSFER },
    );
    expect(edited.sentence).toBe('You edited Transfer');
  });

  it('approving / deleting a transfer never shows an income or expense impact', () => {
    const approved = describeActivity(event({ eventType: 'approved' }), { transaction: TRANSFER });
    expect(approved.impact).toEqual({ text: 'Moved between your accounts · not income or expense', tone: 'neutral' });
    const deleted = describeActivity(
      event({
        eventType: 'deleted',
        metadata: { kind: 'deleted', merchantName: 'Transfer', amountMinor: 50000, type: 'transfer', status: 'approved', transferAccountId: 'acc-w' },
      }),
    );
    expect(deleted.impact).toEqual({ text: 'Balances moved back', tone: 'negative' });
  });
});

describe('R3b refund + duplicate sentences', () => {
  const REFUND = { merchantName: 'QA-Merchant-10', amountMinor: 10000, type: 'income' as const };
  const ORIGINAL = { merchantName: 'QA-Merchant-10 Store' };
  const DUPLICATE = { merchantName: 'QA-Merchant-11', amountMinor: 5000, type: 'expense' as const };

  const linkedEvent = event({
    eventType: 'refund_linked',
    metadata: {
      kind: 'refund_linked',
      refund_id: 'txn-1',
      expense_id: 'txn-0',
      previous_category_id: 'cat-uncategorised',
      category_id: 'cat-shopping',
    },
  });

  it('masked by default (R2 privacy): no amount appears', () => {
    const linked = describeRaw(linkedEvent, { transaction: REFUND, linkedTransaction: ORIGINAL });
    expect(linked.sentence).toBe(`You linked a ${MASKED_AMOUNT} refund to QA-Merchant-10 Store`);
    expect(linked.sentence).not.toMatch(/100/);
    expect(linked.impact).toEqual({ text: 'Not income · reduces spending', tone: 'neutral' });

    const marked = describeRaw(
      event({
        eventType: 'duplicate_marked',
        metadata: {
          kind: 'duplicate_marked',
          kept_id: 'txn-0',
          duplicate_id: 'txn-1',
          previous: {
            type: 'expense',
            status: 'approved',
            categoryId: 'cat-food',
            approvedAt: null,
            transferAccountId: null,
            linkedTransactionId: null,
            linkKind: null,
          },
        },
      }),
      { transaction: DUPLICATE, linkedTransaction: { merchantName: 'QA-Merchant-11' } },
    );
    expect(marked.sentence).toBe(`You marked QA-Merchant-11 ${MASKED_AMOUNT} as a duplicate`);
    expect(marked.sentence).not.toMatch(/50/);
    expect(marked.icon).toBe('content-duplicate');
  });

  it('revealed with the eye; unlink + restore sentences', () => {
    expect(describeActivity(linkedEvent, { transaction: REFUND, linkedTransaction: ORIGINAL }).sentence).toBe(
      'You linked a ₹100.00 refund to QA-Merchant-10 Store',
    );
    expect(
      describeRaw(
        event({
          eventType: 'refund_unlinked',
          metadata: { kind: 'refund_unlinked', refund_id: 'txn-1', expense_id: 'txn-0' },
        }),
        { transaction: REFUND, linkedTransaction: ORIGINAL },
      ),
    ).toMatchObject({
      sentence: `You unlinked a ${MASKED_AMOUNT} refund from QA-Merchant-10 Store`,
      impact: { text: 'Counts as income again', tone: 'neutral' },
    });
    expect(
      describeRaw(
        event({
          eventType: 'duplicate_restored',
          metadata: { kind: 'duplicate_restored', kept_id: 'txn-0', duplicate_id: 'txn-1' },
        }),
        { transaction: DUPLICATE },
      ).sentence,
    ).toBe(`You restored QA-Merchant-11 ${MASKED_AMOUNT} — not a duplicate`);
  });

  it('falls back when the rows are gone', () => {
    expect(describeRaw(linkedEvent).sentence).toBe(`You linked a ${MASKED_AMOUNT} refund to an expense`);
  });
});
