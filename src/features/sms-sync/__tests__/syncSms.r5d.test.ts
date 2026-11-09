/**
 * R5d — stable SMS identity (T1), persisted reference dedupe (T2), card-bill
 * hold (T0e) and debit-card link → duplicate pair (T3d), through the real
 * sync path. SYNTHETIC inbox only (QA names, XX1234 / XX9999, refs
 * 000000000xxx).
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { rowToTransaction } from '../../../data/mappers/transaction.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';
import { useNewAccountsStore } from '../newAccountsStore';
import { linkSuggestion } from '../importSuggestion';
import { findDuplicatePairs } from '../../../domain/duplicates/duplicate.rules';
import { SMS_IDENTITY_SALT_KEY } from '../smsIdentitySalt';
import { smsContentHash } from '../smsIdentity';

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
const SALT = '5a'.repeat(32);
const RESCAN = { window: { sinceMs: 0, beforeMs: T0 + 10 * DAY }, kind: 'rescan' as const };

const accountRow = (id: string, name: string, lastFour: string, type = 'bank') => ({
  id,
  name,
  type,
  last_four: lastFour,
  opening_balance_minor: 0,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
});

const HDFC = 'AD-HDFCBK-S';
const debit = (ref: string, amount = '250.00', payee = 'QA STORE') =>
  `Rs.${amount} debited from HDFC Bank A/c XX1234 to ${payee} on 03-11-26. UPI Ref ${ref}`;

let db: FakeDb;

function seed(
  extra: Record<string, Array<Record<string, unknown>>> = {},
  accounts = [accountRow('acc-hdfc', 'HDFC Bank', '1234')],
) {
  db = createFakeDb({
    accounts,
    app_settings: [{ key: SMS_IDENTITY_SALT_KEY, value: SALT }],
    ...extra,
  });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    accounts: accounts.map(rowToAccount),
    transactions: (extra.transactions ?? []).map(row => rowToTransaction(row as never)),
  });
}

function dbTransactions() {
  return Array.from(db.tables.get('transactions')?.values() ?? []);
}

beforeEach(() => {
  mockInbox = [];
  useTransactionsStore.setState({
    smsSyncStartAt: new Date(T0 - 30 * DAY).toISOString(),
    smsLastSyncedAt: null,
    transactions: [],
    categories: [
      { id: 'cat-uncategorised', name: 'Uncategorised', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
    ],
    merchantRules: {},
    approvalMode: 'manual',
    autoApproveThreshold: 90,
    transferDismissals: [],
    duplicateDismissals: [],
  });
  seed();
  useSuggestionSession.getState().clear();
  useNewAccountsStore.setState({ rows: [] });
});

afterEach(() => mockGetDatabase.mockReset());

describe('T1 — stable SMS identity', () => {
  it('stores a salted 32-hex content hash and a ref digest; never the body, sender or ref', async () => {
    mockInbox = [{ id: '1', address: HDFC, body: debit('000000000401'), date: T0 }];
    await syncSms(RESCAN);
    const [row] = dbTransactions();
    expect(row.sms_content_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(row.ref_digest).toMatch(/^[0-9a-f]{32}$/);
    expect(row.sms_content_hash).toBe(
      smsContentHash(SALT, { address: HDFC, body: debit('000000000401'), date: T0 }),
    );
    expect(JSON.stringify(row)).not.toMatch(/000000000401|HDFCBK|debited from/);
  });

  it('the same SMS with a different _id dedupes', async () => {
    mockInbox = [{ id: '1', address: HDFC, body: debit('000000000402'), date: T0 }];
    expect((await syncSms(RESCAN)).created).toBe(1);
    mockInbox = [{ id: '777', address: HDFC, body: debit('000000000402'), date: T0 }];
    const again = await syncSms(RESCAN);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it('the operator prefix / suffix and the milliseconds do not change the identity', async () => {
    mockInbox = [{ id: '1', address: HDFC, body: debit('000000000403'), date: T0 }];
    await syncSms(RESCAN);
    mockInbox = [{ id: '2', address: 'VM-HDFCBK-T', body: `  ${debit('000000000403')}\n`, date: T0 + 400 }];
    expect((await syncSms(RESCAN)).created).toBe(0);
  });

  it('the same body + date from a different sender does NOT dedupe', async () => {
    const body = 'Rs.250.00 debited from HDFC Bank A/c XX1234 to QA STORE on 03-11-26.';
    mockInbox = [{ id: '1', address: HDFC, body, date: T0 }];
    await syncSms(RESCAN);
    mockInbox = [{ id: '2', address: 'AD-HDFCCC-S', body, date: T0 }];
    expect((await syncSms(RESCAN)).created).toBe(1);
  });

  it('restore on a new phone (rows + salt restored, every _id changed) imports 0 new items', async () => {
    const inbox = [
      { id: '1', address: HDFC, body: debit('000000000404'), date: T0 },
      { id: '2', address: HDFC, body: 'Rs.500.00 credited to HDFC Bank A/c XX1234 from QA PAYEE on 03-11-26.', date: T0 + 1000 },
      { id: '3', address: HDFC, body: 'Rs.75.00 debited from HDFC Bank A/c XX1234 at QA CAFE on 03-11-26.', date: T0 + 2000 },
    ];
    mockInbox = inbox;
    expect((await syncSms(RESCAN)).created).toBe(3);
    const backedUp = dbTransactions().map(row => ({ ...row }));
    const backedUpSalt = db.tables.get('app_settings')!.get(SMS_IDENTITY_SALT_KEY)!.value;
    expect(backedUpSalt).toBe(SALT);

    // New phone: the restore brings rows + settings (salt) back; ids differ.
    seed({ transactions: backedUp });
    mockInbox = inbox.map((sms, i) => ({ ...sms, id: String(5000 + i) }));
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(3);
    expect(dbTransactions()).toHaveLength(3);
  });

  it('lazy backfill: an old row (no content hash) gets one; no audit, no other field; a new phone then dedupes', async () => {
    const oldRow = {
      id: 'qa-old',
      type: 'expense',
      status: 'approved',
      amount_minor: 25000,
      currency: 'INR',
      merchant_name: 'QA STORE',
      category_id: 'cat-uncategorised',
      account_id: 'acc-hdfc',
      payment_method: 'other',
      occurred_at: new Date(T0).toISOString(),
      detected_at: new Date(T0).toISOString(),
      approved_at: new Date(T0).toISOString(),
      note: null,
      source_type: 'sms',
      source_reference_hash: `sms-1-${T0}`,
      sanitized_preview: 'Debited ₹250 — QA STORE',
      confidence_score: 85,
      parser_version: 'sms-reader-v2',
      bulk_batch_id: null,
      transfer_account_id: null,
      linked_transaction_id: null,
      link_kind: null,
      sms_content_hash: null,
      ref_digest: null,
      created_at: new Date(T0).toISOString(),
      updated_at: new Date(T0).toISOString(),
    };
    seed({ transactions: [oldRow] });
    const body = debit('000000000405');
    mockInbox = [{ id: '1', address: HDFC, body, date: T0 }];
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(0);
    const row = db.tables.get('transactions')!.get('qa-old')!;
    expect(row.sms_content_hash).toBe(smsContentHash(SALT, { address: HDFC, body, date: T0 }));
    expect({ ...row, sms_content_hash: null }).toEqual({ ...oldRow, rowid: row.rowid });
    // Only the run's own counts-only sms_rescan row — nothing about the backfill.
    expect(db.auditInserts().map(a => a.row.event_type)).toEqual(['sms_rescan']);
    const update = db.calls.find(c => /^UPDATE transactions/.test(c.sql))!;
    expect(update.sql).toBe('UPDATE transactions SET sms_content_hash = ? WHERE id = ?');
    expect(update.inTransaction).toBe(true);
    expect(useTransactionsStore.getState().transactions[0].smsContentHash).toBe(row.sms_content_hash);

    // Same SMS, new _id (new phone after restore) → still deduped.
    mockInbox = [{ id: '9001', address: HDFC, body, date: T0 }];
    expect((await syncSms(RESCAN)).created).toBe(0);
  });

  it('a pre-R5d tombstone is backfilled and keeps the SMS deleted after its _id changes', async () => {
    seed({ sms_deleted_refs: [{ source_reference_hash: `sms-1-${T0}`, deleted_at: 'x', sms_content_hash: null, ref_key: null }] });
    const body = 'Rs.250.00 debited from HDFC Bank A/c XX1234 to QA STORE on 03-11-26.';
    mockInbox = [{ id: '1', address: HDFC, body, date: T0 }];
    expect((await syncSms(RESCAN)).created).toBe(0);
    const tomb = db.tables.get('sms_deleted_refs')!.get(`sms-1-${T0}`)!;
    expect(tomb.sms_content_hash).toBe(smsContentHash(SALT, { address: HDFC, body, date: T0 }));
    mockInbox = [{ id: '42', address: HDFC, body, date: T0 }];
    expect((await syncSms(RESCAN)).created).toBe(0);
  });

  it('a deleted item stays deleted on a new phone (tombstone content hash)', async () => {
    const body = debit('000000000406');
    mockInbox = [{ id: '1', address: HDFC, body, date: T0 }];
    await syncSms(RESCAN);
    const t = useTransactionsStore.getState().transactions[0];
    await useTransactionsStore.getState().deleteTransaction(t.id);
    mockInbox = [{ id: '8080', address: HDFC, body, date: T0 }];
    expect((await syncSms(RESCAN)).created).toBe(0);
  });
});

describe('T2 — persisted reference dedupe', () => {
  it('a second alert with the same ref + type + amount in a LATER run is skipped', async () => {
    mockInbox = [{ id: '1', address: HDFC, body: debit('000000000407'), date: T0 }];
    expect((await syncSms(RESCAN)).created).toBe(1);
    // A different message (another wording / sender) for the same UPI payment.
    mockInbox = [
      { id: '2', address: 'AD-HDFCBN-S', body: 'Sent Rs.250.00 From HDFC Bank A/C *1234 To QA STORE On 03/11/26 Ref 000000000407', date: T0 + 60_000 },
    ];
    const again = await syncSms(RESCAN);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it('the reversal (income) of a debit is never blocked by the debit\'s reference', async () => {
    mockInbox = [{ id: '1', address: HDFC, body: debit('000000000408', '500.00'), date: T0 }];
    await syncSms(RESCAN);
    mockInbox = [
      { id: '2', address: HDFC, body: 'Rs.500.00 debited on 03-11-26 for UPI Ref 000000000408 has been reversed to your A/c XX1234', date: T0 + DAY },
    ];
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(1);
    const types = useTransactionsStore.getState().transactions.map(t => t.type).sort();
    expect(types).toEqual(['expense', 'income']);
    const [a, b] = useTransactionsStore.getState().transactions;
    expect(a.refDigest).toBe(b.refDigest);
  });

  it('a different amount with the same ref is a separate transaction', async () => {
    mockInbox = [{ id: '1', address: HDFC, body: debit('000000000409', '250.00'), date: T0 }];
    await syncSms(RESCAN);
    mockInbox = [{ id: '2', address: HDFC, body: debit('000000000409', '300.00'), date: T0 + 1000 }];
    expect((await syncSms(RESCAN)).created).toBe(1);
  });

  it('a rejected row with the same ref still blocks; a DELETED one blocks via its tombstone ref key', async () => {
    mockInbox = [{ id: '1', address: HDFC, body: debit('000000000410'), date: T0 }];
    await syncSms(RESCAN);
    const first = useTransactionsStore.getState().transactions[0];
    await useTransactionsStore.getState().reject(first.id);
    mockInbox = [{ id: '2', address: 'AD-HDFCBN-S', body: `Sent Rs.250.00 From HDFC Bank A/C *1234 To QA STORE On 03/11/26 Ref 000000000410`, date: T0 + 5000 }];
    expect((await syncSms(RESCAN)).created).toBe(0);

    await useTransactionsStore.getState().deleteTransaction(first.id);
    const tomb = Array.from(db.tables.get('sms_deleted_refs')!.values())[0];
    expect(tomb.ref_key).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(tomb)).not.toContain('000000000410');
    expect((await syncSms(RESCAN)).created).toBe(0);
  });
});

describe('T0e — card-bill payments are held from auto-approve', () => {
  it('a clean card payment above the threshold stays pending (heldForCardPayment)', async () => {
    useTransactionsStore.setState({ approvalMode: 'auto', autoApproveThreshold: 70 });
    mockInbox = [
      { id: '1', address: HDFC, body: 'Rs.10,000.00 debited from A/c XX1234 on 03-11-26 towards HDFC Bank Credit Card XX9999 payment. Ref 000000000411', date: T0 },
      { id: '2', address: HDFC, body: 'Rs.250.00 debited from HDFC Bank A/c XX1234 to QA STORE on 03-11-26.', date: T0 + 1000 },
    ];
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(2);
    expect(result.heldForCardPayment).toBe(1);
    expect(result.autoApproved).toBe(1);
    const payment = useTransactionsStore.getState().transactions.find(t => t.amountMinor === 1000000)!;
    expect(payment.status).toBe('pending');
    expect(payment.accountId).toBe('acc-hdfc');
  });
});

describe('T3d — a debit-card alert + the account alert for one spend', () => {
  const ACCOUNT_ALERT = { id: '1', address: HDFC, body: 'Rs.300.00 debited from HDFC Bank A/c XX1234 at QA CAFE on 03-11-26.', date: T0 };
  const CARD_ALERT = { id: '2', address: HDFC, body: 'Rs.300.00 spent on HDFC Bank Debit Card ending 5678 at QA CAFE on 03-11-26', date: T0 + 30_000 };

  it('before linking they are not a duplicate pair; after linking the card they are', async () => {
    mockInbox = [ACCOUNT_ALERT, CARD_ALERT];
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(1);
    expect(findDuplicatePairs(useTransactionsStore.getState().transactions, [])).toHaveLength(0);
    const group = useSuggestionSession.getState().groups[0];
    expect(group.suggestion).toMatchObject({ accountKind: 'bank', lastFour: '5678' });

    await linkSuggestion(useSuggestionSession.getState().runId!, group.key, 'acc-hdfc');
    const pairs = findDuplicatePairs(useTransactionsStore.getState().transactions, []);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].first.accountId).toBe('acc-hdfc');
    expect(pairs[0].second.accountId).toBe('acc-hdfc');

    // The 'linked' decision now routes later card alerts to the account.
    mockInbox = [...mockInbox, { ...CARD_ALERT, id: '3', body: CARD_ALERT.body.replace('300.00', '120.00'), date: T0 + DAY }];
    const later = await syncSms(RESCAN);
    expect(later.created).toBe(1);
    expect(useTransactionsStore.getState().transactions.find(t => t.amountMinor === 12000)!.accountId).toBe('acc-hdfc');
  });
});

describe('T3a — 3-digit masks match one account by suffix, never a guess', () => {
  const ICICI = 'AD-ICICIB-S';
  const body = 'ICICI Bank Acct XX888 debited for Rs 1,250.00 on 03-Nov-26; QA PAYEE credited. UPI:000000000412.';

  it('exactly one ICICI account ending in 888 → matched', async () => {
    seed({}, [accountRow('acc-icici', 'ICICI Bank', '7888'), accountRow('acc-hdfc', 'HDFC Bank', '1888')]);
    mockInbox = [{ id: '1', address: ICICI, body, date: T0 }];
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(1);
    expect(useTransactionsStore.getState().transactions[0].accountId).toBe('acc-icici');
  });

  it('two ICICI accounts ending in 888 → unmatched (suggested)', async () => {
    seed({}, [accountRow('acc-a', 'ICICI Bank', '7888'), accountRow('acc-b', 'ICICI Salary', '1888')]);
    mockInbox = [{ id: '1', address: ICICI, body, date: T0 }];
    const result = await syncSms(RESCAN);
    expect(result.created).toBe(0);
    expect(result.suggestions).toHaveLength(1);
  });
});
