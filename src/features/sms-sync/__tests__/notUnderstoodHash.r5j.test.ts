/**
 * R5j T3 — a record added from "Messages not understood" carries the salted
 * content hash, so it dedupes like any other SMS (even under a new inbox id).
 * SYNTHETIC inbox only (QA names, XX9999 / XX1111).
 */
import { syncSms } from '../syncSms';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { getDatabase } from '../../../data/db/connection';
import { rowToAccount } from '../../../data/mappers/account.mapper';
import { createFakeDb } from '../../../test/fakeDb';
import { loadSmsIdentitySalt } from '../smsIdentitySalt';
import { smsContentHash } from '../smsIdentity';
import { smsSourceFields, transferInputFor } from '../../transactions/screens/AddRecordScreen';

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

const BODY = 'Rs.250.00 debited from HDFC Bank A/c XX9999 at QA-Shop on 25-Oct-2026.';
const ADDRESS = 'AD-HDFCBK-S';

beforeEach(() => {
  mockInbox = [];
  const accounts = [account('acc-qa', '9999'), account('acc-b', '1111')];
  mockGetDatabase.mockReturnValue(createFakeDb({ accounts }) as never);
  useTransactionsStore.setState({
    accounts: accounts.map(rowToAccount),
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
});
afterEach(() => mockGetDatabase.mockReset());

describe('R5j T3 — not-understood save carries the content hash', () => {
  it('smsSourceFields: old key stays, content hash is added when present', () => {
    expect(smsSourceFields({ smsId: '7', smsDate: T0 })).toEqual({
      sourceReferenceHash: `sms-7-${T0}`,
      smsContentHash: null,
    });
    expect(smsSourceFields({ smsId: '7', smsDate: T0, smsContentHash: 'abc' }).smsContentHash).toBe('abc');
  });

  it('transferInputFor carries the hash; the saved transfer stores it', async () => {
    const input = transferInputFor(
      { fromAccountId: 'acc-qa', toAccountId: 'acc-b', amount: '250', occurredAt: new Date(T0).toISOString(), note: '' },
      { smsId: '7', smsDate: T0, smsContentHash: 'f'.repeat(32) },
    );
    expect(input.smsReference?.contentHash).toBe('f'.repeat(32));
    const created = await useTransactionsStore.getState().addTransfer(input);
    expect(created.smsContentHash).toBe('f'.repeat(32));
  });

  it('a later identical SMS under a NEW inbox id is deduped (with the hash); without it a duplicate would appear', async () => {
    const salt = await loadSmsIdentitySalt();
    const hash = smsContentHash(salt, { address: ADDRESS, body: BODY, date: T0 });
    const withHash = transferInputFor(
      { fromAccountId: 'acc-qa', toAccountId: 'acc-b', amount: '250', occurredAt: new Date(T0).toISOString(), note: '' },
      { smsId: '7', smsDate: T0, smsContentHash: hash },
    );
    await useTransactionsStore.getState().addTransfer(withHash);
    mockInbox = [{ id: '900', address: ADDRESS, body: BODY, date: T0 }];
    const result = await syncSms({ now: () => T0 + 1000 });
    expect(result.created).toBe(0);
  });

  it('control: without the hash the same SMS under a new id is not recognised', async () => {
    const noHash = transferInputFor(
      { fromAccountId: 'acc-qa', toAccountId: 'acc-b', amount: '250', occurredAt: new Date(T0).toISOString(), note: '' },
      { smsId: '7', smsDate: T0 },
    );
    await useTransactionsStore.getState().addTransfer(noHash);
    mockInbox = [{ id: '900', address: ADDRESS, body: BODY, date: T0 }];
    const result = await syncSms({ now: () => T0 + 1000 });
    expect(result.created).toBeGreaterThan(0);
  });
});
