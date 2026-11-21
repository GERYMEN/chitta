/**
 * R6 T1 — the SMS-reported balance is stored on the MATCHED account (latest
 * wins), through the real sync path. SYNTHETIC inbox only (QA names, XX1234,
 * refs 000000000xxx, public sender codes).
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';
import { useNewAccountsStore } from '../newAccountsStore';
import { SMS_IDENTITY_SALT_KEY } from '../smsIdentitySalt';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
jest.mock('../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => true),
  requestSmsPermission: jest.fn(async () => 'granted'),
}));
let mockInbox: Array<{ id: string; address: string; body: string; date: number }> = [];
jest.mock('../../../native/android/sms/smsReader', () =>
  jest.requireActual('../../../test/helpers/fakeInbox').fakeInboxModule(() => mockInbox),
);

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const DAY = 86_400_000;
const T0 = 1_760_000_000_000;
const RESCAN = { window: { sinceMs: 0, beforeMs: T0 + 10 * DAY }, kind: 'rescan' as const };
const HDFC = 'AD-HDFCBK-S';

const acct = (over: Record<string, unknown>) => ({
  id: 'acc-hdfc',
  name: 'HDFC Bank',
  type: 'bank',
  last_four: '1234',
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  sms_balance_minor: null,
  sms_balance_at: null,
  sms_balance_dismissed_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});

let db: FakeDb;
function setup(accounts: Array<Record<string, unknown>>) {
  db = createFakeDb({ accounts, app_settings: [{ key: SMS_IDENTITY_SALT_KEY, value: '5a'.repeat(32) }] });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    accounts: accounts.map(row => rowToAccount(row as never)),
    transactions: [],
    smsSyncStartAt: new Date(T0 - 30 * DAY).toISOString(),
    smsLastSyncedAt: null,
    categories: [
      { id: 'cat-uncategorised', name: 'Uncategorised', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
    ],
    merchantRules: {},
    approvalMode: 'manual',
    autoApproveThreshold: 70,
    transferDismissals: [],
    duplicateDismissals: [],
  });
  useSuggestionSession.getState().clear();
  useNewAccountsStore.setState({ rows: [] });
}
beforeEach(() => {
  mockInbox = [];
});
afterEach(() => mockGetDatabase.mockReset());

const acc = (id = 'acc-hdfc') => useTransactionsStore.getState().accounts.find(a => a.id === id)!;
const dbRows = () => Array.from(db.tables.get('accounts')!.values());
const dbRow = (id = 'acc-hdfc') => dbRows().find(r => r.id === id)!;

const debit = (id: string, date: number, amount: string, bal: string, last4 = '1234') => ({
  id,
  address: HDFC,
  body: `Rs.${amount} debited from HDFC Bank A/c XX${last4} on 05-11-26 to VPA qa.store@okqa (UPI 00000000${id.padStart(4, '0')}). Avl Bal Rs.${bal}`,
  date,
});

describe('R6 sync snapshot', () => {
  it('a matched, balance-bearing SMS stores the snapshot (number + SMS time) on that account', async () => {
    setup([acct({})]);
    mockInbox = [debit('1', T0, '250.00', '12,345.67')];
    await syncSms(RESCAN);
    expect(acc().smsBalanceMinor).toBe(1234567);
    expect(acc().smsBalanceAt).toBe(new Date(T0).toISOString());
    expect(dbRow().sms_balance_minor).toBe(1234567);
    expect(dbRow().sms_balance_at).toBe(T0);
  });

  it('writes even though the transaction itself stays pending (held / manual mode)', async () => {
    setup([acct({})]);
    mockInbox = [debit('1', T0, '250.00', '9,000.00')];
    await syncSms(RESCAN);
    expect(useTransactionsStore.getState().transactions[0].status).toBe('pending');
    expect(acc().smsBalanceMinor).toBe(900000);
  });

  it('latest wins inside one run (the inbox is newest-first; the older SMS never overwrites)', async () => {
    setup([acct({})]);
    mockInbox = [
      debit('2', T0 + 5000, '100.00', '8,000.00'),
      debit('1', T0, '200.00', '8,100.00'),
    ];
    await syncSms(RESCAN);
    expect(acc().smsBalanceMinor).toBe(800000);
    expect(acc().smsBalanceAt).toBe(new Date(T0 + 5000).toISOString());
  });

  it('never overwrites a NEWER stored snapshot with an older SMS', async () => {
    setup([acct({ sms_balance_minor: 555500, sms_balance_at: T0 + 9 * DAY })]);
    mockInbox = [debit('1', T0, '200.00', '8,100.00')];
    await syncSms(RESCAN);
    expect(acc().smsBalanceMinor).toBe(555500);
    expect(dbRow().sms_balance_at).toBe(T0 + 9 * DAY);
  });

  it('a newer SMS replaces an older stored snapshot', async () => {
    setup([acct({ sms_balance_minor: 100, sms_balance_at: T0 - DAY })]);
    mockInbox = [debit('1', T0, '200.00', '8,100.00')];
    await syncSms(RESCAN);
    expect(acc().smsBalanceMinor).toBe(810000);
  });

  it('an already-recorded SMS (deduped on rescan) still refreshes a missing snapshot', async () => {
    setup([acct({})]);
    mockInbox = [debit('1', T0, '200.00', '8,100.00')];
    await syncSms(RESCAN);
    useTransactionsStore.setState(s => ({ accounts: s.accounts.map(a => ({ ...a, smsBalanceMinor: null, smsBalanceAt: null })) }));
    await db.execute('UPDATE accounts SET sms_balance_minor = ?, sms_balance_at = ? WHERE id = ?', [null, null, 'acc-hdfc']);
    const second = await syncSms(RESCAN);
    expect(second.created).toBe(0);
    expect(acc().smsBalanceMinor).toBe(810000);
  });

  it('no matching account: no snapshot, no invented account', async () => {
    setup([acct({})]);
    mockInbox = [debit('1', T0, '200.00', '8,100.00', '7777')];
    await syncSms(RESCAN);
    expect(acc().smsBalanceMinor).toBeNull();
    expect(dbRows()).toHaveLength(1);
  });

  it('an SMS with no balance leaves the snapshot untouched', async () => {
    setup([acct({ sms_balance_minor: 4242, sms_balance_at: T0 - DAY })]);
    mockInbox = [
      {
        id: '1',
        address: HDFC,
        body: 'Rs.200.00 debited from HDFC Bank A/c XX1234 on 05-11-26 to VPA qa.store@okqa (UPI 000000000001).',
        date: T0,
      },
    ];
    await syncSms(RESCAN);
    expect(acc().smsBalanceMinor).toBe(4242);
    expect(dbRow().sms_balance_at).toBe(T0 - DAY);
  });

  it('a credit card account never takes a snapshot (its "balance" is not the ledger)', async () => {
    setup([acct({ id: 'acc-cc', name: 'HDFC Credit Card', type: 'credit_card' })]);
    mockInbox = [debit('1', T0, '200.00', '8,100.00')];
    await syncSms(RESCAN);
    expect(acc('acc-cc').smsBalanceMinor).toBeNull();
  });

  it('stores no SMS text: only the two snapshot columns changed', async () => {
    setup([acct({})]);
    mockInbox = [debit('1', T0, '250.00', '12,345.67')];
    await syncSms(RESCAN);
    const text = JSON.stringify(dbRow());
    expect(text).not.toMatch(/Avl Bal|qa\.store|okqa/i);
  });
});
