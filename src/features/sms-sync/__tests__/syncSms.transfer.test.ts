import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { autoApproveAfterSync } from '../smsSyncLogic';
import { Transaction } from '../../../domain/transactions/transaction.types';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

jest.mock('../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => true),
  requestSmsPermission: jest.fn(async () => 'granted'),
}));

const mockReadInbox = jest.fn();
jest.mock('../../../native/android/sms/smsReader', () => ({
  readInbox: (limit: number) => mockReadInbox(limit),
}));

// Debits land on the QA bank, credits on the QA wallet — matching is covered elsewhere.
jest.mock('../smsSyncLogic', () => {
  const actual = jest.requireActual('../smsSyncLogic');
  return {
    ...actual,
    partitionCandidates: (candidates: Array<{ type: string }>) => ({
      matched: candidates.map(parsed => ({
        parsed,
        accountId: parsed.type === 'expense' ? 'acc-qa' : 'acc-wallet',
      })),
      dropped: [],
      unmatched: [],
    }),
  };
});

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

function account(id: string, name: string) {
  return {
    id,
    name,
    type: 'bank',
    last_four: null,
    opening_balance_minor: 0,
    currency: 'INR',
    is_active: 1,
    balance_anchor_minor: null,
    balance_anchor_at: null,
    deleted_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}
const ACCOUNTS = [account('acc-qa', 'QA Delete Bank 9999'), account('acc-wallet', 'QA Wallet 8888')];

const T0 = 1761400000000;
const INBOX = [
  { id: '1', address: 'AD-QASNDR', body: 'Rs.500.00 debited from your account at QA-Shop on 25-Oct-2026.', date: T0 },
  { id: '2', address: 'AD-QASNDR', body: 'Rs.500.00 received from QA-Payer on 25-Oct-2026.', date: T0 + 60_000 },
  { id: '3', address: 'AD-QASNDR', body: 'Rs.250.00 debited from your account at QA-Cafe on 25-Oct-2026.', date: T0 + 120_000 },
];

let db: FakeDb;

beforeEach(() => {
  db = createFakeDb({ accounts: ACCOUNTS });
  mockGetDatabase.mockReturnValue(db as never);
  mockReadInbox.mockResolvedValue(INBOX);
  useTransactionsStore.setState({
    transactions: [],
    accounts: ACCOUNTS.map(rowToAccount),
    categories: [
      { id: 'cat-uncategorised', name: 'Uncategorised', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
    ],
    merchantRules: {},
    transferDismissals: [],
    approvalMode: 'auto',
    autoApproveThreshold: 90,
  });
});

afterEach(() => mockGetDatabase.mockReset());

describe('R3a T4: sync never auto-approves a new item that forms a transfer pair', () => {
  it('the 500 debit + 500 credit stay pending; the unrelated 250 debit is auto-approved', async () => {
    const result = await syncSms();
    expect(result.created).toBe(3);
    expect(result.autoApproved).toBe(1);
    expect(result.heldForTransfer).toBe(2);

    const byAmount = new Map(
      useTransactionsStore.getState().transactions.map(t => [`${t.type}:${t.amountMinor}`, t.status]),
    );
    expect(byAmount.get('expense:50000')).toBe('pending');
    expect(byAmount.get('income:50000')).toBe('pending');
    expect(byAmount.get('expense:25000')).toBe('approved');
  });

  it('dedup is unchanged: a re-sync after confirming the pair creates nothing (the twin keeps its hash)', async () => {
    await syncSms();
    const s = useTransactionsStore.getState();
    const debit = s.transactions.find(t => t.type === 'expense' && t.amountMinor === 50000)!;
    const credit = s.transactions.find(t => t.type === 'income')!;
    expect(await s.confirmTransferPair(debit.id, credit.id)).toBe(true);

    const result = await syncSms();
    expect(result.created).toBe(0);
    expect(db.tables.get('transactions')!.size).toBe(3);
  });

  it('a dismissed pair no longer blocks auto-approval', async () => {
    // First sync in manual mode so the rows exist, then dismiss, then a new run.
    useTransactionsStore.setState({ approvalMode: 'manual' });
    await syncSms();
    const s = useTransactionsStore.getState();
    const debit = s.transactions.find(t => t.type === 'expense' && t.amountMinor === 50000)!;
    const credit = s.transactions.find(t => t.type === 'income')!;
    await s.dismissTransferPair(debit.id, credit.id);
    const out = autoApproveAfterSync(
      [debit, credit],
      useTransactionsStore.getState().transactions,
      useTransactionsStore.getState().accounts,
      useTransactionsStore.getState().transferDismissals,
      'auto',
      90,
    );
    expect(out.approve.map(t => t.id).sort()).toEqual([credit.id, debit.id].sort());
    expect(out.heldForTransfer).toEqual([]);
  });
});

describe('autoApproveAfterSync (pure)', () => {
  const base = (id: string, patch: Partial<Transaction>): Transaction => ({
    id,
    type: 'expense',
    status: 'pending',
    amountMinor: 1000,
    currency: 'INR',
    merchantName: 'QA',
    categoryId: 'cat-uncategorised',
    accountId: 'acc-qa',
    paymentMethod: 'other',
    occurredAt: '2026-10-25T10:00:00.000Z',
    detectedAt: '2026-10-25T10:00:00.000Z',
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: id,
    sanitizedPreview: null,
    confidenceScore: 95,
    parserVersion: 'v',
    bulkBatchId: null,
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    ...patch,
  });
  const accounts = [{ id: 'acc-qa', deletedAt: null }, { id: 'acc-wallet', deletedAt: null }];

  it('a new credit pairing with an EXISTING approved debit is held', () => {
    const existing = base('old', { status: 'approved' });
    const fresh = base('new', { type: 'income', accountId: 'acc-wallet' });
    const out = autoApproveAfterSync([fresh], [existing, fresh], accounts, [], 'auto', 90);
    expect(out.approve).toEqual([]);
    expect(out.heldForTransfer.map(t => t.id)).toEqual(['new']);
  });

  it('manual mode approves nothing; below-threshold items are neither approved nor held', () => {
    const fresh = base('new', { confidenceScore: 80 });
    expect(autoApproveAfterSync([fresh], [fresh], accounts, [], 'manual', 90)).toEqual({ approve: [], heldForTransfer: [] });
    expect(autoApproveAfterSync([fresh], [fresh], accounts, [], 'auto', 90)).toEqual({ approve: [], heldForTransfer: [] });
  });
});
