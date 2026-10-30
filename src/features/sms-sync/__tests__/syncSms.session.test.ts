import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';

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

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

// Synthetic QA account: matches nothing in the bodies below by last four.
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
  'Rs.250.00 debited from HDFC Bank A/c XX4242 at QA-Shop on 25-Oct-2026.',
  'Rs.120.00 debited from HDFC Bank A/c XX4242 at QA-Cafe on 26-Oct-2026.',
  'Rs.500.00 credited to HDFC Bank A/c XX4242 from QA-Payer on 27-Oct-2026.',
];

let db: FakeDb;

function seed(decisions: Array<Record<string, unknown>> = []) {
  db = createFakeDb({ accounts: [ACCOUNT_ROW], account_suggestion_decisions: decisions });
  mockGetDatabase.mockReturnValue(db as never);
}

beforeEach(() => {
  seed();
  mockReadInbox.mockResolvedValue(
    BODIES.map((body, i) => ({ id: String(i + 1), address: 'AD-QASNDR', body, date: 1700000000000 + i })),
  );
  useTransactionsStore.setState({
    transactions: [],
    accounts: [rowToAccount(ACCOUNT_ROW)],
    categories: [
      { id: 'cat-uncategorised', name: 'Uncategorised', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
    ],
    merchantRules: {},
    approvalMode: 'manual',
    autoApproveThreshold: 90,
  });
  useSuggestionSession.getState().clear();
});

afterEach(() => mockGetDatabase.mockReset());

describe('syncSms suggestion session (R2b T1)', () => {
  it('keeps unmatched candidates per suggestion in the session; result carries only the run id + counts', async () => {
    const result = await syncSms();

    expect(result.created).toBe(0);
    const session = useSuggestionSession.getState();
    expect(session.runId).toBe(result.suggestionRunId);
    expect(session.groups).toHaveLength(1);
    expect(session.groups[0].key).toBe('bank:HDFC:4242');
    expect(session.groups[0].items).toHaveLength(3);
    expect(result.suggestions).toEqual([
      { bankName: 'HDFC', accountKind: 'bank', lastFour: '4242', messageCount: 3 },
    ]);
    // Nothing about the waiting items is written to the DB.
    expect(db.calls.filter(c => /^INSERT/.test(c.sql))).toHaveLength(0);
    // No raw SMS body / sender in the session.
    const json = JSON.stringify(session.groups);
    expect(json).not.toContain('AD-QASNDR');
    expect(json).not.toContain('debited from');
  });

  it('a re-run rebuilds the session (new run id) and dedup by hash is unchanged', async () => {
    const first = await syncSms();
    const second = await syncSms();
    expect(second.suggestionRunId).not.toBe(first.suggestionRunId);
    expect(useSuggestionSession.getState().runId).toBe(second.suggestionRunId);
    expect(useSuggestionSession.getState().groups[0].items).toHaveLength(3);
  });

  it("an 'added' decision routes the key's SMS to its account (imported, not suggested)", async () => {
    seed([
      {
        bank_canonical: 'hdfc',
        account_kind: 'bank',
        last_four: '4242',
        decision: 'added',
        account_id: 'acc-qa',
        normalizer_version: 1,
        decided_at: 1,
      },
    ]);
    const result = await syncSms();
    expect(result.created).toBe(3);
    expect(result.suggestions).toEqual([]);
    expect(useSuggestionSession.getState().groups).toEqual([]);
  });

  it("an 'ignored' decision drops the key's SMS (not imported, not suggested)", async () => {
    seed([
      {
        bank_canonical: 'hdfc',
        account_kind: 'bank',
        last_four: '4242',
        decision: 'ignored',
        account_id: null,
        normalizer_version: 1,
        decided_at: 1,
      },
    ]);
    const result = await syncSms();
    expect(result.created).toBe(0);
    expect(result.suggestions).toEqual([]);
  });
});
