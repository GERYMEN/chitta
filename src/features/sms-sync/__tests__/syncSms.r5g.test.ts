/**
 * R5g — rules engine through the real sync path (N1 holds, parser_version
 * stamp, reparse rows, run counts). SYNTHETIC inbox only (QA names,
 * XX1234, refs 000000000xxx). A STORED rules document (version 5) is used
 * so the picker's "higher version wins" path is exercised too.
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';
import { useNewAccountsStore } from '../newAccountsStore';
import { SMS_IDENTITY_SALT_KEY } from '../smsIdentitySalt';
import bundled from '../rules/rules.json';
import type { RulesDocument } from '../rules/rules.types';
import { activeRules, setStoredRulesDocument } from '../rules/rulesLoader';
import { autoApproveAfterSync, isRuleDisagreementRow } from '../smsSyncLogic';
import { pendingTransactionFixtures } from '../../../test/fixtures/transactions.fixture';
import { Transaction } from '../../../domain/transactions/transaction.types';

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

function storedDoc(): RulesDocument {
  const doc = JSON.parse(JSON.stringify(bundled)) as RulesDocument;
  doc.version = 5;
  const hdfc = doc.rules.find(r => r.name === 'hdfc')!;
  hdfc.patterns.push(
    {
      pattern_UID: 'T-QA-CHECK',
      sort_UID: 1,
      sms_type: 'transaction',
      account_type: 'bank',
      flags: 'i',
      regex: '^qa check rs\\.([\\d,.]+) debited from hdfc bank a/c xx(\\d{4})',
      // Deliberately reads the direction wrong: a disagreement with the reader.
      data_fields: { transaction_type: 'credit', money_kind: 'income', amount: { group_id: 1 }, pan: { group_id: 2 }, date: { use_sms_time: true } },
    },
    {
      pattern_UID: 'T-QA-ODD',
      sort_UID: 2,
      sms_type: 'transaction',
      account_type: 'bank',
      flags: 'i',
      reparse: true,
      regex: 'qa odd out ([\\d.,]+) ac (\\d{4}) to ([a-z ]+?)(?:;|$)',
      data_fields: { transaction_type: 'debit', money_kind: 'spend', amount: { group_id: 1 }, pan: { group_id: 2 }, pos: { group_id: 3 }, date: { use_sms_time: true } },
    },
  );
  return doc;
}

let db: FakeDb;
const accounts = [
  {
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
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  },
];

beforeAll(() => setStoredRulesDocument(storedDoc()));
afterAll(() => setStoredRulesDocument(null));

beforeEach(() => {
  mockInbox = [];
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
    approvalMode: 'auto',
    autoApproveThreshold: 70,
    transferDismissals: [],
    duplicateDismissals: [],
  });
  useSuggestionSession.getState().clear();
  useNewAccountsStore.setState({ rows: [] });
});

afterEach(() => mockGetDatabase.mockReset());

const rows = () => useTransactionsStore.getState().transactions;

describe('R5g sync', () => {
  it('the stored document (v5) is picked over the bundled one (v4)', () => {
    expect(activeRules()?.version).toBe(5);
    expect(activeRules()?.source).toBe('stored');
  });

  it('agreeing template → rule row, stamped, auto-approved; disagreement → reader values, held + tagged', async () => {
    mockInbox = [
      { id: '1', address: HDFC, body: 'Rs.500.00 credited to HDFC Bank A/c XX1234 on 05-11-26 from VPA qa.friend@okqa (UPI 000000000201)', date: T0 },
      { id: '2', address: HDFC, body: 'QA CHECK Rs.250.00 debited from HDFC Bank A/c XX1234 to QA STORE on 03-11-26.', date: T0 + 1000 },
    ];
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(2);
    expect(result.viaRule).toBe(1);
    expect(result.viaReader).toBe(1);
    expect(result.heldForRuleDisagreement).toBe(1);
    const agree = rows().find(t => t.amountMinor === 50000)!;
    expect(agree.parserVersion).toBe('sms-reader-v2+rules-v5:T-HDFC-0002');
    expect(agree.status).toBe('approved');
    const held = rows().find(t => t.amountMinor === 25000)!;
    expect(held.type).toBe('expense'); // the READER's direction
    expect(held.status).toBe('pending');
    expect(held.parserVersion).toBe('sms-reader-v2+rules-v5:disagree:T-QA-CHECK');
    expect(isRuleDisagreementRow(held)).toBe(true);

    const audit = db.auditInserts().filter(a => a.row.event_type === 'sms_rescan');
    expect(JSON.parse(String(audit[0].row.metadata_json)).counts).toMatchObject({
      viaRule: 1,
      viaReader: 1,
      heldForRuleDisagreement: 1,
    });
  });

  it('reparse: one SMS → one row per record (#n hash), deduped on re-scan', async () => {
    mockInbox = [{ id: '7', address: HDFC, body: 'QA ODD OUT 1.00 AC 1234 TO QA STORE; QA ODD OUT 2.00 AC 1234 TO QA CAFE', date: T0 }];
    const first = await syncSms(RESCAN);
    expect(first.created).toBe(2);
    expect(rows().map(t => t.sourceReferenceHash).sort()).toEqual([`sms-7-${T0}`, `sms-7-${T0}#2`]);
    expect((await syncSms(RESCAN)).created).toBe(0);
  });
});

describe('R5g holds (pure)', () => {
  const base = pendingTransactionFixtures[0];
  // Distinct amounts so no R3b duplicate pair forms between them.
  const t = (id: string, amountMinor: number): Transaction => ({ ...base, id, amountMinor, status: 'pending', confidenceScore: 95 });

  it('disagreement and held money kinds are never auto-approved; counts per reason', () => {
    const created = [t('a', 1100), t('b', 2200), t('c', 3300), t('d', 4400)];
    const result = autoApproveAfterSync(
      created,
      created,
      [],
      [],
      'auto',
      90,
      [],
      new Set(['d']),
      new Map([
        ['a', 'rule_disagreement'],
        ['b', 'atm'],
        ['d', 'rule_disagreement'],
      ]),
    );
    expect(result.approve.map(x => x.id)).toEqual(['c']);
    expect(result.heldForRule.map(h => [h.transaction.id, h.reason])).toEqual([
      ['a', 'rule_disagreement'],
      ['b', 'atm'],
      ['d', 'rule_disagreement'],
    ]);
    // A disagreement on a card payment counts once — as a disagreement.
    expect(result.heldForCardPayment).toEqual([]);
  });
});
