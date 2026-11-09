/**
 * R5-fix — sync regressions from the R5 review (C2, C3, C4, C8). SYNTHETIC
 * inbox only (QA names, XX4242 / XX5555).
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { useSuggestionSession } from '../suggestionSession';
import { newAccountsWindow, useNewAccountsStore } from '../newAccountsStore';
import { transactionRepository } from '../../../data/repositories/transaction.repository';

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

const account = (id: string, lastFour: string) => ({
  id,
  name: `QA Bank ${lastFour}`,
  type: 'bank',
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

const sms = (id: string, date: number, lastFour: string, merchant = 'QA-Shop') => ({
  id,
  address: 'AD-HDFCBK-S',
  body: `Rs.250.00 debited from HDFC Bank A/c XX${lastFour} at ${merchant} on 25-Oct-2026.`,
  date,
});

let db: FakeDb;

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}, accounts = [account('acc-qa', '9999')]) {
  db = createFakeDb({ accounts, ...extra });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({ accounts: accounts.map(rowToAccount) });
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
  });
  seed();
  useSuggestionSession.getState().clear();
  useNewAccountsStore.setState({ rows: [] });
});

afterEach(() => mockGetDatabase.mockReset());

describe('C2 — auto-read never loses "New accounts found"', () => {
  it('an auto run persists the unmatched key; after the cursor moves past it, Home can rebuild the card', async () => {
    mockInbox = [sms('1', T0, '4242')];
    const now = () => T0 + 1000;
    await syncSms({ kind: 'auto', requestPermission: false, now });
    // The cursor moved to the newest SMS seen.
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBe(new Date(T0).toISOString());
    const rows = useNewAccountsStore.getState().rows;
    expect(rows).toEqual([
      { bankCanonical: 'hdfc', accountKind: 'bank', lastFour: '4242', txnCount: 1, firstSeenAt: T0, lastSeenAt: T0 },
    ]);

    // Other SMS move the cursor far past it, then an app restart (session gone).
    mockInbox = [...mockInbox, sms('2', T0 + 3 * DAY, '9999')];
    await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 3 * DAY + 1000 });
    mockInbox = [...mockInbox, sms('3', T0 + 6 * DAY, '9999')];
    useSuggestionSession.getState().clear();
    await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 6 * DAY + 1000 });
    // That run's window [cursor - 1 day, now] no longer reads SMS 1.
    expect(useSuggestionSession.getState().groups.map(g => g.key)).toEqual([]);
    // The stored key survives the normal window that no longer covers it.
    expect(useNewAccountsStore.getState().rows.map(r => r.lastFour)).toEqual(['4242']);

    // Home "1 new account found" → gap scan over [first seen, now]: the card is back.
    const window = newAccountsWindow(useNewAccountsStore.getState().rows, T0 + 6 * DAY + 2000)!;
    const cursorBefore = useTransactionsStore.getState().smsLastSyncedAt;
    const result = await syncSms({ window, kind: 'gap' });
    expect(result.suggestions.map(s => s.lastFour)).toEqual(['4242']);
    expect(useSuggestionSession.getState().groups[0].items).toHaveLength(1);
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBe(cursorBefore);
  });

  it('the stored summary holds no SMS content (bank id, kind, last-4, count, dates only)', async () => {
    mockInbox = [sms('1', T0, '4242', 'QA-Secret-Shop')];
    await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 1000 });
    const rows = Array.from(db.tables.get('account_suggestion_candidates')!.values());
    expect(JSON.stringify(rows)).not.toMatch(/QA-Secret-Shop|debited|HDFCBK|250/);
  });

  it('a decision removes the stored key; a covering scan that no longer sees it removes it too', async () => {
    mockInbox = [sms('1', T0, '4242')];
    await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 1000 });
    expect(useNewAccountsStore.getState().rows).toHaveLength(1);
    // The user adds a matching account outside New Accounts Found.
    seed({ account_suggestion_candidates: Array.from(db.tables.get('account_suggestion_candidates')!.values()) }, [
      account('acc-qa', '9999'),
      account('acc-new', '4242'),
    ]);
    await syncSms({ window: { sinceMs: T0 - DAY, beforeMs: T0 + 2000 }, kind: 'gap' });
    expect(useNewAccountsStore.getState().rows).toEqual([]);
  });
});

describe('C3 — a sync merges into an open "New accounts found" session', () => {
  it('an auto run keeps the run id and every group the user has not acted on', async () => {
    mockInbox = [sms('1', T0, '4242')];
    const first = await syncSms({ now: () => T0 + 1000 });
    expect(useSuggestionSession.getState().groups.map(g => g.key)).toEqual(['bank:HDFC:4242']);

    mockInbox = [...mockInbox, sms('2', T0 + 60_000, '5555')];
    const auto = await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 120_000 });
    expect(auto.suggestionRunId).toBe(first.suggestionRunId);
    expect(useSuggestionSession.getState().runId).toBe(first.suggestionRunId);
    expect(useSuggestionSession.getState().groups.map(g => g.key).sort()).toEqual(['bank:HDFC:4242', 'bank:HDFC:5555']);
  });

  it('an auto run with nothing new leaves the open session untouched', async () => {
    mockInbox = [sms('1', T0, '4242')];
    const first = await syncSms({ now: () => T0 + 1000 });
    mockInbox = [...mockInbox, sms('2', T0 + 60_000, '9999')];
    await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 120_000 });
    const session = useSuggestionSession.getState();
    expect(session.runId).toBe(first.suggestionRunId);
    expect(session.groups.map(g => g.items.length)).toEqual([1]);
  });
});

describe('C4 — deleted SMS items never come back', () => {
  it('a tombstoned reference is skipped by re-scan and by the 1-day overlap', async () => {
    seed({ sms_deleted_refs: [{ source_reference_hash: `sms-1-${T0}`, deleted_at: 'x' }] }, [account('acc-qa', '4242')]);
    mockInbox = [sms('1', T0, '4242'), sms('2', T0 + 1000, '4242', 'QA-Cafe')];
    const result = await syncSms({ window: { sinceMs: 0, beforeMs: T0 + DAY }, kind: 'rescan' });
    expect(result.created).toBe(1);
    expect(useTransactionsStore.getState().transactions.map(t => t.sourceReferenceHash)).toEqual([`sms-2-${T0 + 1000}`]);
  });

  it('deleting an SMS item writes its hash tombstone in the same transaction (hash only)', async () => {
    seed({}, [account('acc-qa', '4242')]);
    mockInbox = [sms('1', T0, '4242')];
    await syncSms({ now: () => T0 + 1000 });
    const t = useTransactionsStore.getState().transactions[0];
    await useTransactionsStore.getState().approve(t.id);
    await useTransactionsStore.getState().deleteTransaction(t.id);
    const call = db.calls.find(c => /INTO sms_deleted_refs/.test(c.sql))!;
    expect(call.inTransaction).toBe(true);
    const del = db.calls.find(c => /^DELETE FROM transactions/.test(c.sql))!;
    expect(call.transactionNo).toBe(del.transactionNo);
    expect(call.params[0]).toBe(`sms-1-${T0}`);
    // R5d: + the salted content hash and the (null: no reference) ref key — one-way keys only.
    expect(call.params).toHaveLength(4);
    expect(call.params[2]).toMatch(/^[0-9a-f]{32}$/);
    expect(call.params[3]).toBeNull();
    expect(JSON.stringify(call.params)).not.toMatch(/QA-Shop|debited|HDFCBK/);

    // The next overlap / re-scan does not recreate it.
    const again = await syncSms({ window: { sinceMs: 0, beforeMs: T0 + DAY }, kind: 'rescan' });
    expect(again.created).toBe(0);
  });

  it('a manual (non-SMS) delete writes no tombstone', async () => {
    await transactionRepository.delete('qa-manual', [], null, null);
    expect(db.calls.some(c => /sms_deleted_refs/.test(c.sql))).toBe(false);
  });
});

describe('C8 — dismissed "not understood" rows are not counted again', () => {
  const NOT_UNDERSTOOD = (id: string, date: number) => ({
    id,
    address: 'AD-HDFCBK-S',
    body: 'Rs.250.00 on A/c XX4242 at QA-Shop',
    date,
  });

  it('a dismissed row seen again in the overlap counts 0 and writes no auto_read audit', async () => {
    seed({
      sms_unparsed: [
        { sms_id: '7', sms_date: T0, reason_code: 'no_direction', institution: 'hdfc', parser_version: 2, detected_at: 'x', dismissed_at: 'y', resolved_at: null },
      ],
    });
    mockInbox = [NOT_UNDERSTOOD('7', T0), sms('8', T0 + 1000, '1111')];
    const result = await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 2000 });
    expect(result.notUnderstood).toBe(0);
    expect(db.auditInserts().filter(a => a.row.event_type === 'auto_read')).toHaveLength(0);
  });

  it('a genuinely new row still counts once', async () => {
    mockInbox = [NOT_UNDERSTOOD('7', T0)];
    const first = await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 1000 });
    const second = await syncSms({ kind: 'auto', requestPermission: false, now: () => T0 + 2000 });
    expect(first.notUnderstood).toBe(1);
    expect(second.notUnderstood).toBe(0);
    expect(db.auditInserts().filter(a => a.row.event_type === 'auto_read')).toHaveLength(1);
  });
});

describe('U9 — "Add as transaction" → Transfer keeps the SMS reference', () => {
  it('transferInputFor carries the SMS reference; the saved transfer dedupes the SMS on the next sync', async () => {
    const { transferInputFor } = require('../../transactions/screens/AddRecordScreen');
    seed({}, [account('acc-qa', '9999'), account('acc-b', '1111')]);
    const input = transferInputFor(
      { fromAccountId: 'acc-qa', toAccountId: 'acc-b', amount: '250', occurredAt: new Date(T0).toISOString(), note: '' },
      { smsId: '7', smsDate: T0 },
    );
    expect(input.smsReference).toEqual({ hash: `sms-7-${T0}`, parserVersion: 'sms-user-added' });
    const created = await useTransactionsStore.getState().addTransfer(input);
    expect(created.sourceType).toBe('sms');
    expect(created.sourceReferenceHash).toBe(`sms-7-${T0}`);

    // The same not-understood SMS is no longer recorded as not understood.
    mockInbox = [{ id: '7', address: 'AD-HDFCBK-S', body: 'Rs.250.00 on A/c XX4242 at QA-Shop', date: T0 }];
    const result = await syncSms({ now: () => T0 + 1000 });
    expect(result.notUnderstood).toBe(0);
  });

  it('a plain transfer stays manual with no reference', () => {
    const { transferInputFor } = require('../../transactions/screens/AddRecordScreen');
    const input = transferInputFor(
      { fromAccountId: 'a', toAccountId: 'b', amount: '1', occurredAt: 'x', note: ' ' },
      null,
    );
    expect(input.smsReference).toBeNull();
    expect(input.note).toBeNull();
  });
});
