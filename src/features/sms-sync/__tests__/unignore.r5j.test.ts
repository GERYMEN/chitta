/**
 * R5j T1 — Hidden (ignored) accounts: list + "Un-ignore". SYNTHETIC only
 * (QA bank codes, XX4242 / XX5555).
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';
import { accountRepository } from '../../../data/repositories/account.repository';
import { ignoredAccountsFrom } from '../suggestionGroups';
import { unignoreAccount } from '../importSuggestion';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
jest.mock('../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => true),
  requestSmsPermission: jest.fn(async () => 'granted'),
}));
const mockReadInbox = jest.fn();
jest.mock('../../../native/android/sms/smsReader', () =>
  jest.requireActual('../../../test/helpers/fakeInbox').fakeInboxModule(() => mockReadInbox()),
);
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
const decision = (lastFour: string, kind: string) => ({
  bank_canonical: 'hdfc',
  account_kind: 'bank',
  last_four: lastFour,
  decision: kind,
  account_id: kind === 'ignored' ? null : 'acc-qa',
  normalizer_version: 3,
  decided_at: 1,
});
const KEY_4242 = { bankCanonical: 'hdfc', accountKind: 'bank' as const, lastFour: '4242', normalizerVersion: 3 };

let db: FakeDb;
function seed(decisions: Array<Record<string, unknown>>) {
  db = createFakeDb({ accounts: [ACCOUNT_ROW], account_suggestion_decisions: decisions });
  mockGetDatabase.mockReturnValue(db as never);
}

beforeEach(() => {
  useTransactionsStore.setState({
    smsSyncStartAt: null,
    smsLastSyncedAt: null,
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

describe('R5j T1 — ignored accounts', () => {
  it('lists only the ignored decisions (public bank id, kind, last-4)', async () => {
    seed([decision('4242', 'ignored'), decision('5555', 'added'), decision('1111', 'deleted')]);
    const rows = ignoredAccountsFrom(await accountRepository.listSuggestionDecisions());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bankCanonical: 'hdfc', accountKind: 'bank', lastFour: '4242' });
    expect(rows[0].label).toContain('Bank');
  });

  it('un-ignore removes only that ignored row and writes no audit / money row', async () => {
    seed([decision('4242', 'ignored'), decision('5555', 'ignored'), decision('1111', 'added')]);
    await accountRepository.unignoreSuggestion(KEY_4242);
    const left = Array.from(db.tables.get('account_suggestion_decisions')!.values()).map(r => r.last_four);
    expect(left.sort()).toEqual(['1111', '5555']);
    expect(db.auditInserts()).toHaveLength(0);
  });

  it('un-ignore never removes a non-ignored decision for the same key', async () => {
    seed([decision('4242', 'added')]);
    await accountRepository.unignoreSuggestion(KEY_4242);
    expect(db.tables.get('account_suggestion_decisions')!.size).toBe(1);
  });

  it('after un-ignore, matching SMS are handled again (suggested as a new account)', async () => {
    seed([decision('4242', 'ignored')]);
    mockReadInbox.mockResolvedValue([
      { id: '1', address: 'AD-QASNDR', body: 'Rs.250.00 debited from HDFC Bank A/c XX4242 at QA-Shop on 25-Oct-2026.', date: 1700000000000 },
    ]);
    const before = await syncSms();
    expect(before.suggestions).toEqual([]);
    await unignoreAccount(KEY_4242);
    useSuggestionSession.getState().clear();
    const after = await syncSms();
    expect(after.suggestions.length).toBeGreaterThan(0);
  });
});
