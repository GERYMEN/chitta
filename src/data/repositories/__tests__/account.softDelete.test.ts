import { accountRepository } from '../account.repository';
import { getDatabase } from '../../db/connection';

jest.mock('../../db/connection', () => ({
  getDatabase: jest.fn(),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

interface Call {
  sql: string;
  params: unknown[];
  inTransaction: boolean;
}

const ACCOUNT_ROW = {
  id: 'acc-qa',
  name: 'HDFC Salary',
  type: 'bank',
  last_four: '1859',
  opening_balance_minor: 100000,
  currency: 'INR',
  is_active: 1,
  balance_anchor_minor: null,
  balance_anchor_at: null,
  deleted_at: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

describe('accountRepository soft delete / restore (D10)', () => {
  let calls: Call[];
  let transactionCount: number;
  let row: Record<string, unknown>;

  beforeEach(() => {
    calls = [];
    transactionCount = 0;
    row = { ...ACCOUNT_ROW };

    const record = (inTransaction: boolean) =>
      jest.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params, inTransaction });
        if (/^SELECT \* FROM accounts WHERE id = \?/.test(sql)) return { rows: [row] };
        return { rows: [], rowsAffected: 1 };
      });

    const db = {
      execute: record(false),
      transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
        transactionCount++;
        await fn({ execute: record(true) });
      }),
    };

    mockGetDatabase.mockReturnValue(db as never);
  });

  afterEach(() => {
    mockGetDatabase.mockReset();
  });

  const writes = () => calls.filter(c => !/^SELECT/.test(c.sql));

  it('softDelete sets deleted_at and writes a deleted decision in ONE transaction', async () => {
    const result = await accountRepository.softDelete('acc-qa');

    expect(transactionCount).toBe(1);
    const w = writes();
    expect(w).toHaveLength(2);
    expect(w.every(c => c.inTransaction)).toBe(true);

    expect(w[0].sql).toBe('UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?');
    expect(typeof w[0].params[0]).toBe('number');
    expect(w[0].params[2]).toBe('acc-qa');

    expect(w[1].sql).toMatch(/^INSERT OR REPLACE INTO account_suggestion_decisions/);
    expect(w[1].sql).toContain("'deleted'");
    expect(w[1].params.slice(0, 4)).toEqual(['hdfc', 'bank', '1859', 'acc-qa']);

    expect(result.deletedAt).not.toBeNull();
  });

  it('uses unknown bank and the empty last-four sentinel when nothing resolves', async () => {
    row = { ...ACCOUNT_ROW, name: 'QA Delete Bank 9999', last_four: null, type: 'cash' };
    await accountRepository.softDelete('acc-qa');
    const insert = writes().find(c => /INSERT OR REPLACE/.test(c.sql));
    expect(insert?.params.slice(0, 3)).toEqual(['unknown', 'cash', '']);
  });

  it('restore clears deleted_at and deletes the decision in ONE transaction', async () => {
    row = { ...ACCOUNT_ROW, deleted_at: 1_790_000_000_000 };
    const result = await accountRepository.restore('acc-qa');

    expect(transactionCount).toBe(1);
    const w = writes();
    expect(w).toHaveLength(2);
    expect(w.every(c => c.inTransaction)).toBe(true);
    expect(w[0].sql).toBe('UPDATE accounts SET deleted_at = NULL, updated_at = ? WHERE id = ?');
    expect(w[1].sql).toBe(
      "DELETE FROM account_suggestion_decisions WHERE account_id = ? AND decision = 'deleted'",
    );
    expect(w[1].params).toEqual(['acc-qa']);
    expect(result.deletedAt).toBeNull();
  });

  it('never deletes or modifies transactions', async () => {
    await accountRepository.softDelete('acc-qa');
    await accountRepository.restore('acc-qa');
    expect(calls.some(c => /\btransactions\b/i.test(c.sql))).toBe(false);
  });

  it('all writes are parameterized (no account id or name in the SQL text)', async () => {
    await accountRepository.softDelete('acc-qa');
    await accountRepository.restore('acc-qa');
    for (const c of calls) {
      expect(c.sql).not.toContain('acc-qa');
      expect(c.sql).not.toContain('HDFC Salary');
    }
  });

  it('throws for an unknown account without writing', async () => {
    const db = mockGetDatabase();
    (db.execute as jest.Mock).mockImplementation(async () => ({ rows: [] }));
    await expect(accountRepository.softDelete('missing')).rejects.toThrow('Account not found');
    expect(transactionCount).toBe(0);
  });

  it('listDeletedDecisionKeys returns string keys of deleted decisions', async () => {
    const db = mockGetDatabase();
    (db.execute as jest.Mock).mockImplementation(async () => ({
      rows: [{ bank_canonical: 'hdfc', account_kind: 'bank', last_four: '1859', normalizer_version: 1 }],
    }));
    const keys = await accountRepository.listDeletedDecisionKeys();
    expect(Array.from(keys)).toEqual(['hdfc:bank:1859']);
  });
});
