import { syncSms, CancelToken, SyncProgress } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';
import { INCREMENTAL_OVERLAP_MS } from '../../../domain/settings/smsSyncStart.rules';

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
// R4b: paged native API, served from the synthetic inbox below.
jest.mock('../../../native/android/sms/smsReader', () =>
  jest.requireActual('../../../test/helpers/fakeInbox').fakeInboxModule(() => mockReadInbox()),
);

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

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-01T00:00:00.000Z');

interface Sms {
  id: string;
  address: string;
  body: string;
  date: number;
}

/** Synthetic debit SMS, one per hour, distinct amounts. */
function makeInbox(count: number, firstId = 1, firstDate = T0): Sms[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(firstId + i),
    address: SENDER,
    body: `Rs.${100 + firstId + i}.00 debited from your account at QA-Merchant-${String((i % 90) + 10)} on 01-Sep-2026.`,
    date: firstDate + i * HOUR,
  }));
}

let db: FakeDb;
let inbox: Sms[];
const NOW = T0 + 2000 * HOUR;

beforeEach(() => {
  db = createFakeDb({ accounts: [ACCOUNT_ROW] });
  mockGetDatabase.mockReturnValue(db as never);
  inbox = makeInbox(650);
  mockReadInbox.mockImplementation(async () => inbox);
  useTransactionsStore.setState({
    smsSyncStartMode: 'all',
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
});

afterEach(() => mockGetDatabase.mockReset());

const now = () => NOW;

describe('R4b syncSms paging (no 200 cap)', () => {
  it('reads all 650 SMS in pages of 300, inserts all, reports progress, advances the cursor', async () => {
    const progress: SyncProgress[] = [];
    const result = await syncSms({ now, onProgress: p => progress.push({ ...p }) });
    expect(result.scanned).toBe(650);
    expect(result.created).toBe(650);
    expect(result.cancelled).toBe(false);
    expect(progress).toEqual([
      { scanned: 0, total: 650 },
      { scanned: 300, total: 650 },
      { scanned: 600, total: 650 },
      { scanned: 650, total: 650 },
    ]);
    expect(useTransactionsStore.getState().transactions).toHaveLength(650);
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBe(
      new Date(T0 + 649 * HOUR).toISOString(),
    );
  });

  it('above 500: asks first; "no" reads and inserts nothing', async () => {
    const confirm = jest.fn(async () => false);
    const result = await syncSms({ now, confirmLargeScan: confirm });
    expect(confirm).toHaveBeenCalledWith(650);
    expect(result.declined).toBe(true);
    expect(result.scanned).toBe(0);
    expect(useTransactionsStore.getState().transactions).toHaveLength(0);
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBeNull();
  });

  it('at or below 500: no question asked', async () => {
    inbox = makeInbox(500);
    const confirm = jest.fn(async () => true);
    const result = await syncSms({ now, confirmLargeScan: confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(result.created).toBe(500);
  });

  it('Cancel keeps what was inserted and does not move the cursor; the next sync finishes the rest', async () => {
    const cancel: CancelToken = { cancelled: false };
    const first = await syncSms({
      now,
      cancel,
      onProgress: ({ scanned }) => {
        if (scanned >= 300) cancel.cancelled = true;
      },
    });
    expect(first.cancelled).toBe(true);
    expect(first.scanned).toBe(300);
    expect(first.created).toBe(300);
    expect(useTransactionsStore.getState().transactions).toHaveLength(300);
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBeNull();

    const second = await syncSms({ now });
    expect(second.cancelled).toBe(false);
    expect(second.scanned).toBe(650);
    expect(second.created).toBe(350);
    expect(useTransactionsStore.getState().transactions).toHaveLength(650);
  });

  it('incremental: a later sync reads only from lastSynced − 1 day', async () => {
    await syncSms({ now });
    inbox = [...inbox, ...makeInbox(2, 1000, T0 + 700 * HOUR)];
    const second = await syncSms({ now });
    // 24 h overlap of hourly SMS (25 incl. both ends) + the 2 new ones.
    const overlap = inbox.filter(
      s => s.date >= T0 + 649 * HOUR - INCREMENTAL_OVERLAP_MS && s.date <= T0 + 649 * HOUR,
    ).length;
    expect(second.scanned).toBe(overlap + 2);
    expect(second.created).toBe(2);
  });

  it('start = install moment: the first sync finds nothing', async () => {
    useTransactionsStore.setState({ smsSyncStartMode: 'install', smsSyncStartAt: new Date(NOW).toISOString() });
    const result = await syncSms({ now });
    expect(result.scanned).toBe(0);
    expect(result.created).toBe(0);
    expect(result.cancelled).toBe(false);
  });

  it('gap scan reads only [since, before) and never moves the cursor', async () => {
    const last = new Date(T0 + 649 * HOUR).toISOString();
    useTransactionsStore.setState({ smsLastSyncedAt: last });
    const result = await syncSms({
      now,
      window: { sinceMs: T0 + 100 * HOUR, beforeMs: T0 + 200 * HOUR },
    });
    expect(result.scanned).toBe(100);
    expect(result.created).toBe(100);
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBe(last);
  });

  it('no SMS text in settings writes, audit rows or console output', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(level =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );
    try {
      await syncSms({ now });
      const forbidden = [SENDER, 'debited', 'QA-Merchant', 'Rs.'];
      const settingsWrites = db.calls.filter(c => /app_settings/.test(c.sql));
      expect(settingsWrites.length).toBeGreaterThan(0);
      for (const call of settingsWrites) {
        for (const word of forbidden) expect(JSON.stringify(call.params)).not.toContain(word);
      }
      for (const { row } of db.auditInserts()) {
        for (const word of forbidden) expect(String(row.metadata_json ?? '')).not.toContain(word);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
