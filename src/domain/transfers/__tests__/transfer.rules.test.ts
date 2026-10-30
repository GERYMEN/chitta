import { Transaction } from '../../transactions/transaction.types';
import {
  confirmTransferPair,
  findTransferPairs,
  findTransferTwin,
  isPairCandidate,
  markAsTransferPatch,
  pairedTransactionIds,
  touchesAccount,
  transferDirection,
  undoTransferPair,
} from '../transfer.rules';

const H = 60 * 60 * 1000;
const BASE = Date.parse('2026-10-20T10:00:00.000Z');
const at = (offsetMs: number) => new Date(BASE + offsetMs).toISOString();

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'pending',
    amountMinor: 50000,
    currency: 'INR',
    merchantName: `QA-${id}`,
    categoryId: 'cat-uncategorised',
    accountId: 'acc-bank',
    paymentMethod: 'other',
    occurredAt: at(0),
    detectedAt: at(0),
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: `sms:${id}`,
    sanitizedPreview: null,
    confidenceScore: 90,
    parserVersion: 'sms-heuristic-v1',
    bulkBatchId: null,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: at(0),
    updatedAt: at(0),
    ...patch,
  };
}

const ACCOUNTS = [
  { id: 'acc-bank', deletedAt: null },
  { id: 'acc-wallet', deletedAt: null },
  { id: 'acc-card', deletedAt: null },
  { id: 'acc-gone', deletedAt: '2026-10-01T00:00:00.000Z' },
];

const debit = (id: string, patch: Partial<Transaction> = {}) => tx(id, { type: 'expense', accountId: 'acc-bank', ...patch });
const credit = (id: string, patch: Partial<Transaction> = {}) =>
  tx(id, { type: 'income', accountId: 'acc-wallet', ...patch });

const pairIds = (rows: Transaction[], dismissals: { debitId: string; creditId: string }[] = [], hours?: number) =>
  findTransferPairs(rows, ACCOUNTS, dismissals, hours).map(p => `${p.debit.id}>${p.credit.id}`);

describe('findTransferPairs', () => {
  it('pairs an expense on A with the same-amount income on B', () => {
    expect(pairIds([debit('d1'), credit('c1', { occurredAt: at(2 * H) })])).toEqual(['d1>c1']);
  });

  it('window boundary: exactly 24 h pairs, 24 h + 1 ms does not (either direction)', () => {
    expect(pairIds([debit('d1'), credit('c1', { occurredAt: at(24 * H) })])).toEqual(['d1>c1']);
    expect(pairIds([debit('d1'), credit('c1', { occurredAt: at(-24 * H) })])).toEqual(['d1>c1']);
    expect(pairIds([debit('d1'), credit('c1', { occurredAt: at(24 * H + 1) })])).toEqual([]);
    expect(pairIds([debit('d1'), credit('c1', { occurredAt: at(2 * H) })], [], 1)).toEqual([]);
  });

  it('never pairs rows on the same account', () => {
    expect(pairIds([debit('d1'), credit('c1', { accountId: 'acc-bank' })])).toEqual([]);
  });

  it('amount must match to the paisa', () => {
    expect(pairIds([debit('d1'), credit('c1', { amountMinor: 50001 })])).toEqual([]);
    expect(pairIds([debit('d1'), credit('c1', { amountMinor: 49999 })])).toEqual([]);
  });

  it('three-way ambiguity: closest in time wins, each row in at most one pair', () => {
    const rows = [
      debit('d1'),
      credit('c-far', { occurredAt: at(5 * H) }),
      credit('c-near', { occurredAt: at(1 * H) }),
    ];
    expect(pairIds(rows)).toEqual(['d1>c-near']);

    // Two debits competing for one credit: the closer debit wins.
    const rows2 = [
      debit('d-near', { occurredAt: at(0) }),
      debit('d-far', { occurredAt: at(-3 * H) }),
      credit('c1', { occurredAt: at(1 * H) }),
    ];
    expect(pairIds(rows2)).toEqual(['d-near>c1']);
  });

  it('a tie in time difference goes to the earliest', () => {
    const rows = [
      debit('d1'),
      credit('c-before', { occurredAt: at(-2 * H) }),
      credit('c-after', { occurredAt: at(2 * H) }),
    ];
    expect(pairIds(rows)).toEqual(['d1>c-before']);
  });

  it('greedy matching still pairs the leftovers', () => {
    const rows = [
      debit('d1', { occurredAt: at(0) }),
      debit('d2', { occurredAt: at(10 * H) }),
      credit('c1', { occurredAt: at(1 * H) }),
      credit('c2', { occurredAt: at(11 * H) }),
    ];
    expect(pairIds(rows).sort()).toEqual(['d1>c1', 'd2>c2']);
  });

  it('a dismissed pair is not suggested (and the credit can pair elsewhere)', () => {
    const rows = [debit('d1'), credit('c1', { occurredAt: at(1 * H) })];
    expect(pairIds(rows, [{ debitId: 'd1', creditId: 'c1' }])).toEqual([]);
    const rows2 = [...rows, debit('d2', { occurredAt: at(3 * H) })];
    expect(pairIds(rows2, [{ debitId: 'd1', creditId: 'c1' }])).toEqual(['d2>c1']);
  });

  it('rejected / invalid rows, transfers, twins and linked rows never pair', () => {
    const c = credit('c1', { occurredAt: at(1 * H) });
    expect(pairIds([debit('d1', { status: 'rejected' }), c])).toEqual([]);
    expect(pairIds([debit('d1', { status: 'invalid' }), c])).toEqual([]);
    expect(pairIds([debit('d1'), { ...c, status: 'rejected' }])).toEqual([]);
    expect(pairIds([debit('d1', { type: 'transfer', transferAccountId: 'acc-wallet' }), c])).toEqual([]);
    expect(pairIds([debit('d1'), { ...c, linkKind: 'transfer_twin', linkedTransactionId: 'x' }])).toEqual([]);
    expect(pairIds([debit('d1', { linkedTransactionId: 'x' }), c])).toEqual([]);
  });

  it('pending and approved rows both pair', () => {
    const rows = [debit('d1', { status: 'approved' }), credit('c1', { status: 'pending', occurredAt: at(H) })];
    expect(pairIds(rows)).toEqual(['d1>c1']);
  });

  it('rows on a soft-deleted (inactive) account never pair', () => {
    expect(pairIds([debit('d1', { accountId: 'acc-gone' }), credit('c1')])).toEqual([]);
    expect(pairIds([debit('d1'), credit('c1', { accountId: 'acc-gone' })])).toEqual([]);
  });

  it('two income rows or two expense rows never pair', () => {
    expect(pairIds([debit('d1'), debit('d2', { accountId: 'acc-wallet' })])).toEqual([]);
    expect(pairIds([credit('c1', { accountId: 'acc-bank' }), credit('c2')])).toEqual([]);
  });

  it('pairedTransactionIds lists both sides', () => {
    const pairs = findTransferPairs([debit('d1'), credit('c1')], ACCOUNTS, []);
    expect(Array.from(pairedTransactionIds(pairs)).sort()).toEqual(['c1', 'd1']);
  });
});

describe('confirm / undo a pair', () => {
  const NOW = '2026-10-30T12:00:00.000Z';

  it('debit becomes an approved transfer to B; credit stays as a rejected transfer twin', () => {
    const d = debit('d1', { categoryId: 'cat-food' });
    const c = credit('c1', { status: 'approved', approvedAt: at(H), categoryId: 'cat-salary' });
    const result = confirmTransferPair(d, c, NOW)!;
    expect(result.debit).toMatchObject({
      type: 'transfer',
      status: 'approved',
      approvedAt: NOW,
      transferAccountId: 'acc-wallet',
      accountId: 'acc-bank',
      categoryId: 'cat-transfer',
      sourceReferenceHash: 'sms:d1',
    });
    expect(result.credit).toMatchObject({
      type: 'income',
      status: 'rejected',
      linkKind: 'transfer_twin',
      linkedTransactionId: 'd1',
      sourceReferenceHash: 'sms:c1',
    });
    expect(result.previous.debit).toEqual({
      type: 'expense',
      status: 'pending',
      categoryId: 'cat-food',
      approvedAt: null,
      transferAccountId: null,
      linkedTransactionId: null,
      linkKind: null,
    });
    expect(findTransferTwin([result.debit, result.credit], 'd1')?.id).toBe('c1');
  });

  it('an already-approved debit keeps its approvedAt', () => {
    const d = debit('d1', { status: 'approved', approvedAt: at(-H) });
    expect(confirmTransferPair(d, credit('c1'), NOW)!.debit.approvedAt).toBe(at(-H));
  });

  it('refuses rows that are no longer a valid pair', () => {
    expect(confirmTransferPair(debit('d1'), credit('c1', { amountMinor: 1 }), NOW)).toBeNull();
    expect(confirmTransferPair(debit('d1'), credit('c1', { accountId: 'acc-bank' }), NOW)).toBeNull();
    expect(confirmTransferPair(debit('d1', { status: 'rejected' }), credit('c1'), NOW)).toBeNull();
    expect(confirmTransferPair(credit('c1'), debit('d1'), NOW)).toBeNull();
  });

  it('undo restores both rows exactly (all fields but updatedAt)', () => {
    const d = debit('d1', { categoryId: 'cat-food' });
    const c = credit('c1', { status: 'approved', approvedAt: at(H), categoryId: 'cat-salary' });
    const confirmed = confirmTransferPair(d, c, NOW)!;
    const undone = undoTransferPair(confirmed.debit, confirmed.credit, confirmed.previous, NOW)!;
    expect({ ...undone.debit, updatedAt: d.updatedAt }).toEqual(d);
    expect({ ...undone.credit, updatedAt: c.updatedAt }).toEqual(c);
    expect(undone.debit.updatedAt).toBe(NOW);
  });

  it('undo refuses when the rows are not this confirmed pair', () => {
    const confirmed = confirmTransferPair(debit('d1'), credit('c1'), NOW)!;
    expect(undoTransferPair(debit('d1'), confirmed.credit, confirmed.previous, NOW)).toBeNull();
    expect(
      undoTransferPair(confirmed.debit, { ...confirmed.credit, linkedTransactionId: 'other' }, confirmed.previous, NOW),
    ).toBeNull();
  });
});

describe('mark as transfer + per-account helpers', () => {
  it('expense on A → to B; income on A → from B', () => {
    expect(markAsTransferPatch(debit('d1', { status: 'approved' }), 'acc-wallet')).toEqual({
      type: 'transfer',
      accountId: 'acc-bank',
      transferAccountId: 'acc-wallet',
      categoryId: 'cat-transfer',
    });
    expect(markAsTransferPatch(credit('c1', { status: 'approved' }), 'acc-bank')).toEqual({
      type: 'transfer',
      accountId: 'acc-bank',
      transferAccountId: 'acc-wallet',
      categoryId: 'cat-transfer',
    });
  });

  it('refuses pending rows, the same account, transfers and twins', () => {
    expect(markAsTransferPatch(debit('d1'), 'acc-wallet')).toBeNull();
    expect(markAsTransferPatch(debit('d1', { status: 'approved' }), 'acc-bank')).toBeNull();
    expect(
      markAsTransferPatch(debit('d1', { status: 'approved', type: 'transfer', transferAccountId: 'acc-card' }), 'acc-wallet'),
    ).toBeNull();
    expect(
      markAsTransferPatch(credit('c1', { status: 'rejected', linkKind: 'transfer_twin' }), 'acc-bank'),
    ).toBeNull();
  });

  it('a transfer touches both accounts: out on A, in on B', () => {
    const t = debit('t1', { type: 'transfer', transferAccountId: 'acc-wallet', status: 'approved' });
    expect(touchesAccount(t, 'acc-bank')).toBe(true);
    expect(touchesAccount(t, 'acc-wallet')).toBe(true);
    expect(touchesAccount(t, 'acc-card')).toBe(false);
    expect(transferDirection(t, 'acc-bank')).toBe('out');
    expect(transferDirection(t, 'acc-wallet')).toBe('in');
    expect(transferDirection(debit('d1'), 'acc-bank')).toBeNull();
    // An expense's transferAccountId (never set) cannot make it "touch" another account.
    expect(touchesAccount(debit('d2', { transferAccountId: 'acc-card' }), 'acc-card')).toBe(false);
  });

  it('isPairCandidate', () => {
    expect(isPairCandidate(debit('d1'))).toBe(true);
    expect(isPairCandidate(debit('d1', { status: 'approved' }))).toBe(true);
    expect(isPairCandidate(debit('d1', { status: 'rejected' }))).toBe(false);
    expect(isPairCandidate(debit('d1', { type: 'transfer' }))).toBe(false);
  });
});
