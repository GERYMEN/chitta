import { syncSms, SmsSyncError } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { checkSmsPermission, requestSmsPermission } from '../../../native/android/permissions/smsPermission';

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
const SENDER = 'AD-QABANK-S';
const KNOWN = 'AD-FEDBNK-S';
const T0 = 1762000000000;

const ACCOUNT_ROW = {
  id: 'acc-qa',
  name: 'QA Bank 1234',
  type: 'bank',
  last_four: '1234',
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const NOT_UNDERSTOOD_BODY = 'Your A/c XX1234 has been credited. Please check the app for details -Federal Bank';
const SALARY_BODY =
  'Rs.50,000.00 credited to your A/c XX1234 by NEFT-QAEMP000000001-QA EMPLOYER PVT LTD-SALARY NOV. Avl Bal Rs.60,000.00';
const DEBIT_BODY = 'Rs.250.00 debited from your A/c XX1234 to QA PAYEE. UPI Ref No 000000000001';

let db: FakeDb;

function inbox(rows: Array<{ id: string; address: string; body: string; date: number }>) {
  mockReadInbox.mockResolvedValue(rows);
}

beforeEach(() => {
  db = createFakeDb({ accounts: [ACCOUNT_ROW] });
  mockGetDatabase.mockReturnValue(db as never);
  (checkSmsPermission as jest.Mock).mockResolvedValue(true);
  (requestSmsPermission as jest.Mock).mockClear();
  useTransactionsStore.setState({
    smsSyncStartAt: null,
    smsLastSyncedAt: null,
    transactions: [],
    accounts: [rowToAccount(ACCOUNT_ROW)],
    categories: [
      { id: 'cat-salary', name: 'Salary & Wages', parentId: null, type: 'income', icon: 'x', isSystem: true, archivedAt: null, color: null },
      { id: 'cat-uncategorised', name: 'Uncategorised', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
    ],
    merchantRules: {},
    approvalMode: 'manual',
    autoApproveThreshold: 90,
  });
});

afterEach(() => mockGetDatabase.mockReset());

const unparsedInserts = () => db.calls.filter(c => /INTO sms_unparsed/.test(c.sql));
const auditTypes = () => db.auditInserts().map(a => a.row.event_type);

describe('R5 sync: Messages not understood', () => {
  it('records id + date + reason + institution only (no body, no sender) and counts it once', async () => {
    inbox([{ id: '41', address: KNOWN, body: NOT_UNDERSTOOD_BODY, date: T0 }]);
    const first = await syncSms();
    expect(first.created).toBe(0);
    expect(first.notUnderstood).toBe(1);
    const calls = unparsedInserts();
    expect(calls).toHaveLength(1);
    expect(calls[0].params.slice(0, 5)).toEqual(['41', T0, 'no_amount', 'federal', 2]);
    const json = JSON.stringify(calls.map(c => [c.sql, c.params]));
    expect(json).not.toContain(KNOWN);
    expect(json).not.toContain('FEDBNK');
    expect(json).not.toMatch(/credited|check the app/i);
    // R5 table rows never reach the audit log.
    expect(auditTypes()).toEqual([]);
  });
});

describe('R5 sync: salary + classes', () => {
  it('a salary credit is filed under the Salary category, high confidence', async () => {
    inbox([{ id: '1', address: KNOWN, body: SALARY_BODY, date: T0 }]);
    const result = await syncSms();
    expect(result.created).toBe(1);
    const row = useTransactionsStore.getState().transactions[0];
    expect(row.categoryId).toBe('cat-salary');
    expect(row.type).toBe('income');
    expect(row.confidenceScore).toBe(90);
    expect(row.parserVersion).toBe('sms-reader-v2');
    expect(row.sourceReferenceHash).toBe(`sms-1-${T0}`);
  });

  it('a merchant rule still wins over the salary category', async () => {
    useTransactionsStore.setState({
      categories: [
        ...useTransactionsStore.getState().categories,
        { id: 'cat-x', name: 'X', parentId: null, type: 'income', icon: 'x', isSystem: false, archivedAt: null, color: null },
      ],
      merchantRules: { 'qa employer pvt ltd': 'cat-x' },
    });
    inbox([{ id: '1', address: KNOWN, body: SALARY_BODY, date: T0 }]);
    await syncSms();
    expect(useTransactionsStore.getState().transactions[0].categoryId).toBe('cat-x');
  });

  it('OTP / promo / mandate / bill are not inserted', async () => {
    inbox([
      { id: '1', address: KNOWN, body: '123456 is your OTP for txn of Rs.500.00 at QA STORE. Never share OTP.', date: T0 },
      { id: '2', address: KNOWN, body: 'Congratulations! You are eligible for a pre-approved loan of Rs.5,00,000. Apply now', date: T0 + 1 },
      { id: '3', address: KNOWN, body: 'Rs.499.00 will be debited from your A/c XX1234 on 05-11-2026 towards QA PAYEE e-mandate', date: T0 + 2 },
      { id: '4', address: KNOWN, body: 'Your QA Bill of Rs.899.00 is due on 10-11-2026', date: T0 + 3 },
    ]);
    const result = await syncSms();
    expect(result.created).toBe(0);
    expect(result.notUnderstood).toBe(0);
  });

  it('two SMS with the same reference, type and amount in one run → one item', async () => {
    inbox([
      { id: '1', address: KNOWN, body: DEBIT_BODY, date: T0 },
      { id: '2', address: SENDER, body: DEBIT_BODY, date: T0 + 1000 },
    ]);
    expect((await syncSms()).created).toBe(1);
  });
});

describe('R5 sync: run kinds + audit (counts only)', () => {
  it("'rescan' writes one sms_rescan row with counts; never moves the cursor", async () => {
    inbox([
      { id: '1', address: KNOWN, body: DEBIT_BODY, date: T0 },
      { id: '2', address: KNOWN, body: NOT_UNDERSTOOD_BODY, date: T0 + 1 },
    ]);
    await syncSms({ kind: 'rescan', window: { sinceMs: 0, beforeMs: T0 + 10 } });
    const rescans = db.auditInserts().filter(a => a.row.event_type === 'sms_rescan');
    expect(rescans).toHaveLength(1);
    expect(rescans[0].row.actor).toBe('user');
    expect(JSON.parse(String(rescans[0].row.metadata_json))).toEqual({
      kind: 'sms_rescan',
      // R5g: + via rule / via reader / held for disagreement (counts only).
      counts: {
        scanned: 2,
        created: 1,
        notUnderstood: 1,
        autoApproved: 0,
        viaRule: 0,
        viaReader: 1,
        heldForRuleDisagreement: 0,
      },
    });
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBeNull();
  });

  it('re-scan dedups by the unchanged hash: items recorded earlier are not duplicated or rewritten', async () => {
    inbox([{ id: '1', address: KNOWN, body: DEBIT_BODY, date: T0 }]);
    await syncSms();
    const before = useTransactionsStore.getState().transactions[0];
    const again = await syncSms({ kind: 'rescan', window: { sinceMs: 0, beforeMs: T0 + 10 } });
    expect(again.created).toBe(0);
    expect(useTransactionsStore.getState().transactions).toEqual([before]);
  });

  it("'auto' audits only when something was added; never prompts for permission", async () => {
    inbox([{ id: '1', address: KNOWN, body: DEBIT_BODY, date: T0 }]);
    await syncSms({ kind: 'auto', requestPermission: false });
    await syncSms({ kind: 'auto', requestPermission: false });
    const autos = db.auditInserts().filter(a => a.row.event_type === 'auto_read');
    expect(autos).toHaveLength(1);
    expect(autos[0].row.actor).toBe('system');
    expect(String(autos[0].row.metadata_json)).not.toMatch(/QA|debited|FEDBNK/);

    (checkSmsPermission as jest.Mock).mockResolvedValue(false);
    await expect(syncSms({ kind: 'auto', requestPermission: false })).rejects.toBeInstanceOf(SmsSyncError);
    expect(requestSmsPermission).not.toHaveBeenCalled();
  });

  it('a manual sync writes no run audit row', async () => {
    inbox([{ id: '1', address: KNOWN, body: DEBIT_BODY, date: T0 }]);
    await syncSms();
    expect(auditTypes()).toEqual(['detected']);
  });
});
