/**
 * Tiny in-memory stand-in for the op-sqlite `DB`, for repository/store tests.
 * It understands only the statement shapes the repositories emit:
 *   INSERT [OR REPLACE|OR IGNORE] INTO t (cols) VALUES (?, 'lit', ...)
 *     [ON CONFLICT(col) DO UPDATE SET a = excluded.a, ...]
 *   UPDATE t SET a = ?, b = NULL WHERE id = ?
 *   DELETE FROM t WHERE <pk col> = ?
 *   SELECT * FROM t [WHERE <col> = ?] [ORDER BY ...]
 * Every call is logged with whether it ran inside `db.transaction`.
 */
export interface FakeCall {
  sql: string;
  params: unknown[];
  inTransaction: boolean;
  transactionNo: number | null;
}

type Row = Record<string, unknown>;

export interface FakeDb {
  execute: jest.Mock;
  transaction: jest.Mock;
  calls: FakeCall[];
  tables: Map<string, Map<string, Row>>;
  transactionCount: () => number;
  auditInserts: () => Array<{ row: Row; call: FakeCall }>;
}

const PRIMARY_KEY: Record<string, string[]> = {
  app_settings: ['key'],
  merchant_rules: ['merchant_key'],
  account_suggestion_decisions: ['bank_canonical', 'account_kind', 'last_four'],
  transfer_pair_dismissals: ['debit_id', 'credit_id'],
  duplicate_pair_dismissals: ['a_id', 'b_id'],
};

function keyFor(table: string, row: Row): string {
  const cols = PRIMARY_KEY[table] ?? ['id'];
  return cols.map(c => String(row[c])).join('|');
}

function splitTopLevel(list: string): string[] {
  return list.split(',').map(part => part.trim());
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables = new Map<string, Map<string, Row>>();
  const calls: FakeCall[] = [];
  let transactions = 0;

  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  for (const [name, rows] of Object.entries(seed)) {
    for (const row of rows) table(name).set(keyFor(name, row), { ...row });
  }

  const run = (inTransaction: boolean, transactionNo: number | null) =>
    jest.fn(async (rawSql: string, params: unknown[] = []) => {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      calls.push({ sql, params, inTransaction, transactionNo });

      let m = /^INSERT (OR REPLACE |OR IGNORE )?INTO (\w+) \(([^)]*)\) VALUES \((.*?)\)(?: ON CONFLICT\(\w+\) DO UPDATE SET (.*))?$/i.exec(sql);
      if (m) {
        const cols = splitTopLevel(m[3]);
        const values = splitTopLevel(m[4]);
        let p = 0;
        const row: Row = {};
        cols.forEach((col, i) => {
          const v = values[i];
          row[col] = v === '?' ? params[p++] : v === 'NULL' ? null : v.replace(/^'(.*)'$/, '$1');
        });
        const t = table(m[2]);
        const key = keyFor(m[2], row);
        const existing = t.get(key);
        if (existing && /OR IGNORE/i.test(m[1] ?? '')) return { rows: [], rowsAffected: 0 };
        if (existing && m[5]) {
          for (const assignment of splitTopLevel(m[5])) {
            const col = assignment.split('=')[0].trim();
            existing[col] = row[col];
          }
          return { rows: [], rowsAffected: 1 };
        }
        row.rowid = t.size + 1;
        t.set(key, row);
        return { rows: [], rowsAffected: 1 };
      }

      m = /^UPDATE (\w+) SET (.*) WHERE id = \?$/i.exec(sql);
      if (m) {
        const id = String(params[params.length - 1]);
        const existing = table(m[1]).get(id);
        if (!existing) return { rows: [], rowsAffected: 0 };
        let p = 0;
        for (const assignment of splitTopLevel(m[2])) {
          const [col, value] = assignment.split('=').map(x => x.trim());
          existing[col] = value === '?' ? params[p++] : value === 'NULL' ? null : value;
        }
        return { rows: [], rowsAffected: 1 };
      }

      m = /^DELETE FROM (\w+) WHERE (\w+) = \?$/i.exec(sql);
      if (m) {
        const t = table(m[1]);
        for (const [key, row] of Array.from(t.entries())) {
          if (String(row[m[2]]) === String(params[0])) t.delete(key);
        }
        return { rows: [], rowsAffected: 1 };
      }

      m = /^SELECT \* FROM (\w+) WHERE (\w+) = \?$/i.exec(sql);
      if (m) {
        const col = m[2];
        const rows = Array.from(table(m[1]).values()).filter(
          row => String(row[col]) === String(params[0]),
        );
        return { rows };
      }

      m = /^SELECT \* FROM (\w+)(?: ORDER BY .*)?$/i.exec(sql);
      if (m) return { rows: Array.from(table(m[1]).values()) };

      return { rows: [], rowsAffected: 0 };
    });

  const execute = run(false, null);
  const transaction = jest.fn(async (fn: (tx: { execute: jest.Mock }) => Promise<void>) => {
    transactions++;
    await fn({ execute: run(true, transactions) });
  });

  return {
    execute,
    transaction,
    calls,
    tables,
    transactionCount: () => transactions,
    auditInserts: () =>
      calls
        .filter(c => /^INSERT INTO audit_events/.test(c.sql))
        .map(call => ({
          call,
          row: {
            id: call.params[0],
            transaction_id: call.params[1],
            account_id: call.params[2],
            event_type: call.params[3],
            event_at: call.params[4],
            actor: call.params[5],
            metadata_json: call.params[6],
          },
        })),
  };
}
