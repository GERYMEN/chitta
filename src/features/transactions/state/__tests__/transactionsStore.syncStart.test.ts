import { useTransactionsStore } from '../transactionsStore';
import { getDatabase } from '../../../../data/db/connection';
import { rowToTransaction } from '../../../../data/mappers/transaction.mapper';
import { rowToAccount } from '../../../../data/mappers/account.mapper';
import { createFakeDb, FakeDb } from '../../../../test/fakeDb';
import { smsSyncRepository } from '../../../../data/repositories/smsSync.repository';
import { saveOnboardingSyncStart } from '../../../onboarding/screens/SyncStartScreen';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

jest.mock('../../../../data/repositories/smsSync.repository', () => ({
  smsSyncRepository: { firstRunStartedAtMs: jest.fn(async () => null) },
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const mockFirstRun = smsSyncRepository.firstRunStartedAtMs as jest.MockedFunction<
  typeof smsSyncRepository.firstRunStartedAtMs
>;

const SMS_PREVIEW = 'debited ... QA-PREVIEW-SECRET';

const ACCOUNT_ROW = {
  id: 'acc-qa',
  name: 'QA Delete Bank 9999',
  type: 'bank',
  last_four: '9999',
  opening_balance_minor: 100000,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

function txRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'expense',
    status: 'pending',
    amount_minor: 5000,
    currency: 'INR',
    merchant_name: `QA-Merchant-${id}`,
    category_id: 'cat-food',
    account_id: 'acc-qa',
    payment_method: 'upi',
    occurred_at: '2026-10-20T10:00:00.000Z',
    detected_at: '2026-10-20T10:00:00.000Z',
    approved_at: null,
    note: null,
    source_type: 'sms',
    source_reference_hash: `sms:${id}:1`,
    sanitized_preview: SMS_PREVIEW,
    confidence_score: 90,
    parser_version: 'sms-heuristic-v1',
    bulk_batch_id: null,
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

let db: FakeDb;

function seed(rows: Record<string, unknown>[], state: Record<string, unknown> = {}) {
  db = createFakeDb({ accounts: [ACCOUNT_ROW], transactions: rows });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({
    transactions: rows.map(rowToTransaction),
    accounts: [rowToAccount(ACCOUNT_ROW)],
    categories: [],
    approvalMode: 'manual',
    autoApproveThreshold: 90,
    hasOnboarded: true,
    smsSyncStartMode: null,
    smsSyncStartAt: null,
    smsLastSyncedAt: null,
    ...state,
  });
}

function settingsAudits() {
  return db
    .auditInserts()
    .filter(a => a.row.event_type === 'settings_changed')
    .map(a => ({ actor: a.row.actor, metadata: JSON.parse(String(a.row.metadata_json)) }));
}

function settingValue(key: string): unknown {
  return db.tables.get('app_settings')?.get(key)?.value;
}

function expectNoSmsTextAnywhere() {
  for (const call of db.calls) {
    if (/INTO (app_settings|audit_events)/.test(call.sql)) {
      expect(JSON.stringify(call.params)).not.toMatch(/SECRET|debited|QA-Merchant/);
    }
  }
}

afterEach(() => {
  mockGetDatabase.mockReset();
  mockFirstRun.mockReset();
  mockFirstRun.mockResolvedValue(null);
});

describe('R4b SMS sync start settings', () => {
  it('onboarding choice is saved (mode + date) and audited, then onboarding completes', async () => {
    seed([], { hasOnboarded: false });
    const now = new Date(2026, 10, 1, 9, 0);
    await saveOnboardingSyncStart('month', now);
    const state = useTransactionsStore.getState();
    expect(state.smsSyncStartMode).toBe('month');
    expect(state.smsSyncStartAt).toBe(new Date(2026, 10, 1).toISOString());
    expect(state.hasOnboarded).toBe(true);
    expect(settingValue('sms_sync_start_mode')).toBe('month');
    expect(settingValue('sms_sync_start_at')).toBe(new Date(2026, 10, 1).toISOString());
    expect(settingsAudits()).toEqual([
      {
        actor: 'user',
        metadata: { kind: 'settings_changed', key: 'sms_sync_start_mode', from: 'unset', to: 'month' },
      },
      {
        actor: 'user',
        metadata: {
          kind: 'settings_changed',
          key: 'sms_sync_start_at',
          from: 'unset',
          to: new Date(2026, 10, 1).toISOString(),
        },
      },
    ]);
  });

  it('install date choice = the moment setup completes', async () => {
    seed([], { hasOnboarded: false });
    const now = new Date(2026, 10, 1, 9, 30);
    await saveOnboardingSyncStart('install', now);
    expect(useTransactionsStore.getState().smsSyncStartAt).toBe(now.toISOString());
  });

  it('whole inbox stores an empty start and audits only what changed', async () => {
    seed([], { smsSyncStartMode: 'month', smsSyncStartAt: '2026-11-01T00:00:00.000Z' });
    await useTransactionsStore.getState().setSmsSyncStart('all', null);
    expect(useTransactionsStore.getState().smsSyncStartAt).toBeNull();
    expect(settingValue('sms_sync_start_at')).toBe('');
    expect(settingsAudits().map(a => a.metadata)).toEqual([
      { kind: 'settings_changed', key: 'sms_sync_start_mode', from: 'month', to: 'all' },
      { kind: 'settings_changed', key: 'sms_sync_start_at', from: '2026-11-01T00:00:00.000Z', to: '' },
    ]);
    // Same value again → no new audit rows.
    await useTransactionsStore.getState().setSmsSyncStart('all', null);
    expect(settingsAudits()).toHaveLength(2);
  });

  it('the sync cursor is saved but not audited', async () => {
    seed([]);
    await useTransactionsStore.getState().setSmsLastSyncedAt('2026-10-31T10:00:00.000Z');
    expect(settingValue('sms_last_synced_at')).toBe('2026-10-31T10:00:00.000Z');
    expect(db.auditInserts()).toHaveLength(0);
  });
});

describe('R4b upgrade path (existing install, no setup screen)', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');

  it('earliest of first sync run and earliest SMS row → custom, audited by system; cursor = newest SMS row', async () => {
    seed([
      txRow('a', { occurred_at: '2026-10-14T08:00:00.000Z' }),
      txRow('b', { occurred_at: '2026-10-30T08:00:00.000Z', status: 'rejected' }),
      txRow('m', { occurred_at: '2026-01-01T08:00:00.000Z', source_type: 'manual', source_reference_hash: null }),
    ]);
    mockFirstRun.mockResolvedValue(Date.parse('2026-10-16T00:00:00.000Z'));
    expect(await useTransactionsStore.getState().applySmsSyncStartUpgrade(now)).toBe(true);
    const state = useTransactionsStore.getState();
    expect(state.smsSyncStartMode).toBe('custom');
    expect(state.smsSyncStartAt).toBe('2026-10-14T08:00:00.000Z');
    expect(state.smsLastSyncedAt).toBe('2026-10-30T08:00:00.000Z');
    expect(settingsAudits().every(a => a.actor === 'system')).toBe(true);
    expect(settingsAudits().map(a => a.metadata.key)).toEqual([
      'sms_sync_start_mode',
      'sms_sync_start_at',
    ]);
    expectNoSmsTextAnywhere();
  });

  it('a sync run older than every SMS row wins', async () => {
    seed([txRow('a', { occurred_at: '2026-10-20T08:00:00.000Z' })]);
    mockFirstRun.mockResolvedValue(Date.parse('2026-10-14T00:00:00.000Z'));
    await useTransactionsStore.getState().applySmsSyncStartUpgrade(now);
    expect(useTransactionsStore.getState().smsSyncStartAt).toBe('2026-10-14T00:00:00.000Z');
  });

  it('neither → the time of the upgrade; no cursor', async () => {
    seed([]);
    await useTransactionsStore.getState().applySmsSyncStartUpgrade(now);
    expect(useTransactionsStore.getState().smsSyncStartAt).toBe(now.toISOString());
    expect(useTransactionsStore.getState().smsLastSyncedAt).toBeNull();
  });

  it('does nothing before onboarding or when a start already exists', async () => {
    seed([], { hasOnboarded: false });
    expect(await useTransactionsStore.getState().applySmsSyncStartUpgrade(now)).toBe(false);
    seed([], { smsSyncStartMode: 'install', smsSyncStartAt: now.toISOString() });
    expect(await useTransactionsStore.getState().applySmsSyncStartUpgrade(now)).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});

describe('R4b Approve all + Undo', () => {
  it('approves each listed pending item (audited approved/user) and Undo restores exactly those', async () => {
    seed([
      txRow('p1'),
      txRow('p2', { type: 'income' }),
      txRow('p3'),
      txRow('done', { status: 'approved', approved_at: '2026-10-21T10:00:00.000Z' }),
    ]);
    const store = useTransactionsStore.getState();
    const snapshots = await store.approveAll(['p1', 'p2', 'done']);
    expect(snapshots.map(s => s.id)).toEqual(['p1', 'p2']);
    const approvedAudits = db.auditInserts().filter(a => a.row.event_type === 'approved');
    expect(approvedAudits.map(a => [a.row.transaction_id, a.row.actor])).toEqual([
      ['p1', 'user'],
      ['p2', 'user'],
    ]);

    const restored = await useTransactionsStore.getState().undoApprovals(snapshots);
    expect(restored).toBe(2);
    const byId = new Map(useTransactionsStore.getState().transactions.map(t => [t.id, t]));
    expect(byId.get('p1')).toMatchObject({ status: 'pending', approvedAt: null });
    expect(byId.get('p2')).toMatchObject({ status: 'pending', approvedAt: null });
    expect(byId.get('p3')?.status).toBe('pending');
    expect(byId.get('done')).toMatchObject({ status: 'approved', approvedAt: '2026-10-21T10:00:00.000Z' });
    expect(db.tables.get('transactions')?.get('p1')?.status).toBe('pending');
    const undone = db.auditInserts().filter(a => a.row.event_type === 'approval_undone');
    expect(undone.map(a => a.row.transaction_id)).toEqual(['p1', 'p2']);
    expect(undone.map(a => JSON.parse(String(a.row.metadata_json)))).toEqual([
      { kind: 'approval_undone', transactionType: 'expense' },
      { kind: 'approval_undone', transactionType: 'income' },
    ]);
    expectNoSmsTextAnywhere();
  });

  it('Undo skips an item that changed since (different approval / link)', async () => {
    seed([txRow('p1'), txRow('p2')]);
    const snapshots = await useTransactionsStore.getState().approveAll(['p1', 'p2']);
    useTransactionsStore.setState(state => ({
      transactions: state.transactions.map(t =>
        t.id === 'p2' ? { ...t, approvedAt: '2030-01-01T00:00:00.000Z' } : t,
      ),
    }));
    expect(await useTransactionsStore.getState().undoApprovals(snapshots)).toBe(1);
    const p2 = useTransactionsStore.getState().transactions.find(t => t.id === 'p2');
    expect(p2?.status).toBe('approved');
  });
});
