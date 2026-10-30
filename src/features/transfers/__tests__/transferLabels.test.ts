import {
  possibleTransfersLabel,
  transferPairTitle,
  transferRouteLabel,
  transferRowSubtitle,
} from '../transferLabels';
import { Transaction } from '../../../domain/transactions/transaction.types';

const ACCOUNTS = [
  { id: 'acc-bank', name: 'QA Delete Bank', lastFour: '9999', deletedAt: null },
  { id: 'acc-wallet', name: 'QA Wallet 8888', lastFour: null, deletedAt: null },
];

const T = {
  type: 'transfer' as const,
  accountId: 'acc-bank',
  transferAccountId: 'acc-wallet',
  occurredAt: '2026-10-20T10:00:00.000Z',
};

describe('R3a transfer labels', () => {
  it('route: From A → To B', () => {
    expect(transferRouteLabel(T, ACCOUNTS)).toBe('From QA Delete Bank ••••9999 → To QA Wallet 8888');
  });

  it('row subtitle: both sides by default; out on A, in on B in a per-account view', () => {
    expect(transferRowSubtitle(T, ACCOUNTS)).toMatch(/^QA Delete Bank ••••9999 → QA Wallet 8888 · /);
    expect(transferRowSubtitle(T, ACCOUNTS, 'acc-bank')).toMatch(/^Out to QA Wallet 8888 · /);
    expect(transferRowSubtitle(T, ACCOUNTS, 'acc-wallet')).toMatch(/^In from QA Delete Bank ••••9999 · /);
  });

  it('pair title and Home nudge count', () => {
    const pair = {
      debit: { id: 'd', amountMinor: 50000, accountId: 'acc-bank', occurredAt: T.occurredAt } as Transaction,
      credit: { id: 'c', amountMinor: 50000, accountId: 'acc-wallet', occurredAt: T.occurredAt } as Transaction,
      diffMs: 0,
    };
    expect(transferPairTitle(pair, ACCOUNTS)).toBe('₹500.00 from QA Delete Bank ••••9999 to QA Wallet 8888');
    expect(possibleTransfersLabel(1)).toBe('1 possible transfer');
    expect(possibleTransfersLabel(3)).toBe('3 possible transfers');
  });
});
