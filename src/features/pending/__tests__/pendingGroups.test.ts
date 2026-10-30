import { Account } from '../../../domain/accounts/account.types';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { shouldAutoApprove, thresholdNoteText } from '../../../domain/settings/approval.rules';
import {
  autoApproveButtonState,
  autoApproveConfirmTitle,
  autoApproveEligible,
  groupPendingByAccount,
  pendingSectionTitle,
} from '../pendingGroups';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { createFakeDb } from '../../../test/fakeDb';
import { transactionToRow } from '../../../data/mappers/transaction.mapper';
import { describeActivity } from '../../activity/activityFeed';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  name: 'QA Delete Bank 9999',
  type: 'bank',
  lastFour: '9999',
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

let seq = 0;
const txn = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: `txn-${++seq}`,
  type: 'expense',
  status: 'pending',
  amountMinor: 1000,
  currency: 'INR',
  merchantName: 'QA-Merchant-05',
  categoryId: 'cat-uncategorised',
  accountId: 'acc-1',
  paymentMethod: 'other',
  occurredAt: '2026-10-10T00:00:00.000Z',
  detectedAt: '2026-10-10T00:00:00.000Z',
  approvedAt: null,
  note: null,
  sourceType: 'sms',
  sourceReferenceHash: `sms-${seq}-1`,
  sanitizedPreview: null,
  confidenceScore: 90,
  parserVersion: 'sms-heuristic-v1',
  bulkBatchId: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...overrides,
});

describe('groupPendingByAccount (R2b T3)', () => {
  const accounts = [
    account(),
    account({ id: 'acc-2', name: 'QA Cash', lastFour: null }),
    account({ id: 'acc-3', name: 'QA Old', lastFour: '1111', deletedAt: '2026-10-20T00:00:00.000Z' }),
  ];

  it('one section per account, newest item first, sections by newest activity', () => {
    const a1 = txn({ accountId: 'acc-1', occurredAt: '2026-10-01T00:00:00.000Z' });
    const a2 = txn({ accountId: 'acc-1', occurredAt: '2026-10-05T00:00:00.000Z' });
    const b1 = txn({ accountId: 'acc-2', occurredAt: '2026-10-09T00:00:00.000Z' });
    const c1 = txn({ accountId: 'acc-3', occurredAt: '2026-10-03T00:00:00.000Z' });
    const sections = groupPendingByAccount([a1, b1, a2, c1], accounts);

    expect(sections.map(s => s.accountId)).toEqual(['acc-2', 'acc-1', 'acc-3']);
    expect(sections[1].data.map(t => t.id)).toEqual([a2.id, a1.id]);
    expect(sections.map(s => s.title)).toEqual([
      'QA Cash · 1 pending',
      'QA Delete Bank 9999 ••••9999 · 2 pending',
      'Deleted account ••1111 (QA Old) · 1 pending',
    ]);
  });

  it('missing account → "Unknown"; empty → no sections', () => {
    expect(pendingSectionTitle(undefined, 3)).toBe('Unknown · 3 pending');
    expect(groupPendingByAccount([], accounts)).toEqual([]);
  });
});

describe('auto-approve eligibility uses shouldAutoApprove', () => {
  const items = [
    txn({ confidenceScore: 90 }),
    txn({ confidenceScore: 89 }),
    txn({ confidenceScore: 60 }),
    txn({ confidenceScore: null }),
    txn({ confidenceScore: 95, sourceType: 'manual' }),
    txn({ confidenceScore: 95, status: 'approved' }),
  ];

  it.each([70, 85, 89, 90, 95, 100])('threshold %i matches shouldAutoApprove for SMS pending', t => {
    const expected = items.filter(
      i => i.status === 'pending' && i.sourceType === 'sms' && shouldAutoApprove('auto', t, i.confidenceScore),
    );
    expect(autoApproveEligible(items, 'auto', t)).toEqual(expected);
    expect(autoApproveButtonState('auto', t, items).count).toBe(expected.length);
  });

  it('manual mode: nothing eligible', () => {
    expect(autoApproveEligible(items, 'manual', 70)).toEqual([]);
  });
});

describe('autoApproveButtonState (visibility by mode)', () => {
  const items = [txn({ confidenceScore: 90 }), txn({ confidenceScore: 60 })];

  it('manual → hidden', () => {
    expect(autoApproveButtonState('manual', 90, items)).toMatchObject({ visible: false });
  });

  it('auto with eligible items → visible, enabled, count', () => {
    expect(autoApproveButtonState('auto', 90, items)).toEqual({
      visible: true,
      count: 1,
      disabled: false,
      hint: null,
      threshold: 90,
    });
    expect(autoApproveConfirmTitle(1, 90)).toBe('Approve 1 transaction at or above 90% confidence?');
    expect(autoApproveConfirmTitle(4, 85)).toBe('Approve 4 transactions at or above 85% confidence?');
  });

  it('auto, none eligible → disabled with "No items at or above T%"', () => {
    expect(autoApproveButtonState('auto', 90, [txn({ confidenceScore: 60 })])).toEqual({
      visible: true,
      count: 0,
      disabled: true,
      hint: 'No items at or above 90%',
      threshold: 90,
    });
  });

  it('auto, threshold above parser max → the settings threshold-note wording', () => {
    const state = autoApproveButtonState('auto', 95, items);
    expect(state).toMatchObject({ visible: true, count: 0, disabled: true });
    expect(state.hint).toBe(thresholdNoteText());
  });
});

describe("store.approve with actor 'user' (Pending Auto-approve button)", () => {
  afterEach(() => mockGetDatabase.mockReset());

  it("writes auto_approved by 'user' with {confidence, threshold}; status via canTransition", async () => {
    const item = txn({ id: 'txn-auto', confidenceScore: 90 });
    const done = txn({ id: 'txn-done', status: 'rejected' });
    const db = createFakeDb({ transactions: [transactionToRow(item), transactionToRow(done)] });
    mockGetDatabase.mockReturnValue(db as never);
    useTransactionsStore.setState({ transactions: [item, done] });

    await useTransactionsStore.getState().approve('txn-auto', { confidence: 90, threshold: 85, actor: 'user' });
    await useTransactionsStore.getState().approve('txn-done', { confidence: 90, threshold: 85, actor: 'user' });

    const audits = db.auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0].row.event_type).toBe('auto_approved');
    expect(audits[0].row.actor).toBe('user');
    expect(JSON.parse(String(audits[0].row.metadata_json))).toEqual({
      kind: 'auto_approved',
      confidence: 90,
      threshold: 85,
    });
    const state = useTransactionsStore.getState().transactions;
    expect(state.find(t => t.id === 'txn-auto')!.status).toBe('approved');
    expect(state.find(t => t.id === 'txn-done')!.status).toBe('rejected');
  });

  it('Activity says "You auto-approved" for the user actor', () => {
    const item = describeActivity(
      {
        id: 'aud-1',
        seq: 1,
        transactionId: 'txn-auto',
        accountId: 'acc-1',
        eventType: 'auto_approved',
        eventAt: '2026-10-28T10:00:00.000Z',
        actor: 'user',
        metadata: { kind: 'auto_approved', confidence: 90, threshold: 85 },
        deletedSnapshot: null,
      },
      { transaction: { merchantName: 'QA-Merchant-05', amountMinor: 1000, type: 'expense' } },
    );
    expect(item.sentence).toMatch(/^You auto-approved QA-Merchant-05 .* at 90% match$/);
  });
});
