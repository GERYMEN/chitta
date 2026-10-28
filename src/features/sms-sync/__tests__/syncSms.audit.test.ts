import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

jest.mock('../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => true),
  requestSmsPermission: jest.fn(async () => 'granted'),
}));

const SENDER = 'AD-QASNDR';
const mockReadInbox = jest.fn();
jest.mock('../../../native/android/sms/smsReader', () => ({
  readInbox: (limit: number) => mockReadInbox(limit),
}));

// Every parsed SMS belongs to the QA account — matching is covered elsewhere.
jest.mock('../smsSyncLogic', () => {
  const actual = jest.requireActual('../smsSyncLogic');
  return {
    ...actual,
    partitionCandidates: (candidates: unknown[]) => ({
      matched: candidates.map(parsed => ({ parsed, accountId: 'acc-qa' })),
      dropped: [],
      unmatched: [],
    }),
  };
});

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const ACCOUNT_ROW = {
  id: 'acc-qa',
  name: 'QA Delete Bank 9999',
  type: 'bank',
  last_four: '9999',
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const BODIES = [
  'Rs.250.00 debited from your account at QA-Shop on 25-Oct-2026. Avl bal Rs.1,000.00',
  'Rs.500.00 received from QA-Payer on 26-Oct-2026.',
];

let db: FakeDb;

beforeEach(() => {
  db = createFakeDb({ accounts: [ACCOUNT_ROW] });
  mockGetDatabase.mockReturnValue(db as never);
  mockReadInbox.mockResolvedValue(
    BODIES.map((body, i) => ({ id: String(i + 1), address: SENDER, body, date: 1700000000000 + i })),
  );
  useTransactionsStore.setState({
    transactions: [],
    accounts: [rowToAccount(ACCOUNT_ROW)],
    categories: [
      { id: 'cat-shopping', name: 'Shopping', parentId: null, type: 'expense', icon: 'x', isSystem: true },
      { id: 'cat-salary', name: 'Salary & Wages', parentId: null, type: 'income', icon: 'x', isSystem: true },
    ],
  });
});

afterEach(() => mockGetDatabase.mockReset());

function auditTypes() {
  return db.auditInserts().map(a => a.row.event_type);
}

function expectNoSmsTextInAudit() {
  for (const { row } of db.auditInserts()) {
    const json = String(row.metadata_json ?? '');
    expect(json).not.toContain(SENDER);
    expect(json).not.toMatch(/debited|received|Avl bal/i);
    expect(json).not.toContain('QA-Shop');
    expect(json).not.toContain('QA-Payer');
  }
}

describe('syncSms audit', () => {
  it('manual mode: one detected (system) per inserted pending item, nothing else', async () => {
    useTransactionsStore.setState({ approvalMode: 'manual', autoApproveThreshold: 90 });
    const result = await syncSms();

    expect(result.created).toBe(2);
    expect(auditTypes()).toEqual(['detected', 'detected']);
    for (const { row, call } of db.auditInserts()) {
      expect(row.actor).toBe('system');
      expect(call.inTransaction).toBe(true);
    }
    expectNoSmsTextInAudit();
  });

  it('auto mode: detected then auto_approved (system, confidence + threshold) per item', async () => {
    useTransactionsStore.setState({ approvalMode: 'auto', autoApproveThreshold: 90 });
    const result = await syncSms();

    expect(result.autoApproved).toBe(2);
    expect(auditTypes()).toEqual(['detected', 'auto_approved', 'detected', 'auto_approved']);
    const autos = db.auditInserts().filter(a => a.row.event_type === 'auto_approved');
    for (const { row } of autos) {
      expect(row.actor).toBe('system');
      expect(JSON.parse(String(row.metadata_json))).toEqual({
        kind: 'auto_approved',
        confidence: 90,
        threshold: 90,
      });
    }
    expectNoSmsTextInAudit();
  });

  it('re-sync of the same inbox writes no new audit rows', async () => {
    useTransactionsStore.setState({ approvalMode: 'manual', autoApproveThreshold: 90 });
    await syncSms();
    const before = db.auditInserts().length;
    await syncSms();
    expect(db.auditInserts().length).toBe(before);
  });
});
