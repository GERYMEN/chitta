/**
 * R5d T3c — "Linked card / account numbers" on an account: read from the
 * 'linked' decisions, Unlink = the existing undoLink path (decision removed,
 * 'account_unlinked' audit) with no rows removed. SYNTHETIC data only.
 */
import { getDatabase } from '../../../../data/db/connection';
import { createFakeDb, FakeDb } from '../../../../test/fakeDb';
import { useLinkedNumbersStore } from '../linkedNumbersStore';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
let db: FakeDb;

const decision = (bank: string, kind: string, lastFour: string, value: string, accountId: string | null) => ({
  bank_canonical: bank,
  account_kind: kind,
  last_four: lastFour,
  decision: value,
  account_id: accountId,
  normalizer_version: 2,
  decided_at: 1,
});

beforeEach(() => {
  db = createFakeDb({
    account_suggestion_decisions: [
      decision('hdfc', 'bank', '5678', 'linked', 'acc-h'),
      decision('hdfc', 'credit_card', '9999', 'linked', 'acc-other'),
      decision('sbi', 'bank', '1111', 'ignored', null),
    ],
    transactions: [{ id: 'qa-t1', account_id: 'acc-h', amount_minor: 100 }],
  });
  mockGetDatabase.mockReturnValue(db as never);
  useLinkedNumbersStore.setState({ rows: [] });
});

describe('linked numbers store', () => {
  it('lists the account\'s linked numbers only', async () => {
    await useLinkedNumbersStore.getState().refresh();
    const numbers = useLinkedNumbersStore.getState().forAccount('acc-h');
    expect(numbers.map(n => n.label)).toEqual(['HDFC · Bank · ••5678']);
  });

  it('Unlink removes only that decision, audits account_unlinked (bank, kind, 0 items) and keeps every transaction', async () => {
    await useLinkedNumbersStore.getState().refresh();
    const [number] = useLinkedNumbersStore.getState().forAccount('acc-h');
    await useLinkedNumbersStore.getState().unlink('acc-h', number);
    const keys = Array.from(db.tables.get('account_suggestion_decisions')!.values()).map(
      row => `${row.bank_canonical}:${row.account_kind}:${row.last_four}:${row.decision}`,
    );
    expect(keys).toEqual(['hdfc:credit_card:9999:linked', 'sbi:bank:1111:ignored']);
    const audits = db.auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0].row.event_type).toBe('account_unlinked');
    expect(audits[0].row.account_id).toBe('acc-h');
    expect(JSON.parse(String(audits[0].row.metadata_json))).toEqual({
      kind: 'account_unlinked',
      bankCanonical: 'hdfc',
      accountKind: 'bank',
      items: 0,
    });
    expect(String(audits[0].row.metadata_json)).not.toContain('5678');
    expect(db.tables.get('transactions')!.size).toBe(1);
    expect(useLinkedNumbersStore.getState().forAccount('acc-h')).toEqual([]);
  });
});
