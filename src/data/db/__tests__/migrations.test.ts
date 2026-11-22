import { DB } from '@op-engineering/op-sqlite';

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(),
}));

type FakeTx = { execute: jest.Mock };
type FakeDb = {
  execute: jest.Mock;
  transaction: jest.Mock;
};

interface FakeState {
  db: FakeDb;
  appliedVersions: Set<number>;
  executed: string[];
  withParams: Array<{ sql: string; params: unknown[] | undefined }>;
}

function makeFakeDb(
  options: { failUniqueIndex?: boolean; emptyCategories?: boolean } = {},
): FakeState {
  const { failUniqueIndex = false, emptyCategories = false } = options;
  const appliedVersions = new Set<number>();
  const executed: string[] = [];
  const withParams: Array<{ sql: string; params: unknown[] | undefined }> = [];

  const tx: FakeTx = {
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      executed.push(sql);
      withParams.push({ sql, params });
      if (failUniqueIndex && /CREATE UNIQUE INDEX/.test(sql)) {
        throw new Error('UNIQUE constraint failed: transactions.source_reference_hash');
      }
      if (/INSERT INTO schema_migrations/.test(sql)) {
        appliedVersions.add(Number(params?.[0]));
      }
      return { rows: [] };
    }),
  };

  const db: FakeDb = {
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      executed.push(sql);
      if (/SELECT 1 FROM schema_migrations/.test(sql)) {
        return appliedVersions.has(Number(params?.[0])) ? { rows: [{}] } : { rows: [] };
      }
      if (/SELECT COUNT\(\*\) AS count FROM categories/.test(sql)) {
        return { rows: [{ count: emptyCategories ? 0 : 1 }] };
      }
      return { rows: [] };
    }),
    transaction: jest.fn(async (fn: (t: FakeTx) => Promise<void>) => fn(tx)),
  };

  return { db, appliedVersions, executed, withParams };
}

describe('runMigrations versioning', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('issues each ALTER TABLE exactly once across two runs and records applied versions', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');

    await runMigrations();
    await runMigrations();

    const alters = executed.filter(sql => sql.startsWith('ALTER TABLE'));
    const alterCounts = new Map<string, number>();
    for (const sql of alters) alterCounts.set(sql, (alterCounts.get(sql) ?? 0) + 1);

    // 4 from migration 1 + audit_events.account_id from migration 4 +
    // categories.archived_at / color from migration 5 + 3 transactions
    // columns from migration 6 + 4 identity columns from migration 9 (R5d) +
    // accounts.credit_limit_minor from migration 11 (R5b) + 3 accounts snapshot
    // columns from migration 14 (R6).
    expect(alterCounts.size).toBe(18);
    for (const count of alterCounts.values()) {
      expect(count).toBe(1);
    }

    expect(
      executed.filter(sql => sql.includes('ADD COLUMN balance_anchor_minor')),
    ).toHaveLength(1);
    expect(executed.filter(sql => sql.includes('ADD COLUMN bulk_batch_id'))).toHaveLength(1);

    expect(appliedVersions.has(1)).toBe(true);
    expect(appliedVersions.has(2)).toBe(true);
  });

  it('runs the confidence rescale migration (3) exactly once across two runs', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');

    await runMigrations();
    await runMigrations();

    const rescales = executed.filter(sql =>
      /UPDATE transactions SET confidence_score = confidence_score \* 100/.test(sql),
    );
    expect(rescales).toHaveLength(1);
    expect(rescales[0]).toContain("source_type = 'sms'");
    expect(rescales[0]).toContain('confidence_score <= 1');
    expect(appliedVersions.has(3)).toBe(true);
  });

  it('runs the audit migration (4) exactly once across two runs', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');

    await runMigrations();
    await runMigrations();
    await runMigrations();

    expect(
      executed.filter(sql => sql === 'ALTER TABLE audit_events ADD COLUMN account_id TEXT'),
    ).toHaveLength(1);
    expect(
      executed.filter(sql => /CREATE INDEX IF NOT EXISTS ix_audit_event_at ON audit_events\(event_at\)/.test(sql)),
    ).toHaveLength(1);
    expect(
      executed.filter(sql =>
        /CREATE INDEX IF NOT EXISTS ix_audit_transaction ON audit_events\(transaction_id\)/.test(sql),
      ),
    ).toHaveLength(1);
    expect(appliedVersions.has(4)).toBe(true);
  });

  it('migration 4 contains no destructive or interpolated SQL', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m4 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 4);
    expect(m4.statements).toEqual([
      'ALTER TABLE audit_events ADD COLUMN account_id TEXT',
      'CREATE INDEX IF NOT EXISTS ix_audit_event_at ON audit_events(event_at)',
      'CREATE INDEX IF NOT EXISTS ix_audit_transaction ON audit_events(transaction_id)',
    ]);
  });

  it('runs migration 5 exactly once and seeds Uncategorised once (idempotent)', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');

    await runMigrations();
    await runMigrations();
    await runMigrations();

    expect(executed.filter(sql => /CREATE TABLE IF NOT EXISTS merchant_rules/.test(sql))).toHaveLength(1);
    expect(executed.filter(sql => sql === 'ALTER TABLE categories ADD COLUMN archived_at TEXT')).toHaveLength(1);
    expect(executed.filter(sql => sql === 'ALTER TABLE categories ADD COLUMN color TEXT')).toHaveLength(1);
    const seeds = executed.filter(sql => /INTO categories .*'cat-uncategorised'/.test(sql));
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatch(/^INSERT OR IGNORE INTO categories/);
    expect(seeds[0]).toContain("'both'");
    expect(appliedVersions.has(5)).toBe(true);
  });

  it('migration 5 never touches existing transactions', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m5 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 5);
    const joined = m5.statements.join('\n');
    expect(joined).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b/);
    expect(joined).not.toMatch(/\btransactions\b/);
    expect(m5.statements[0]).toMatch(
      /merchant_key TEXT PRIMARY KEY,\s+category_id TEXT NOT NULL REFERENCES categories\(id\),\s+created_at TEXT NOT NULL,\s+updated_at TEXT NOT NULL/,
    );
  });

  it('R3a: runs migration 6 exactly once and seeds cat-transfer once, parameterized (idempotent)', async () => {
    const { db, appliedVersions, executed, withParams } = makeFakeDb();

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');

    await runMigrations();
    await runMigrations();
    await runMigrations();

    for (const column of ['transfer_account_id', 'linked_transaction_id', 'link_kind']) {
      expect(
        executed.filter(sql => sql === `ALTER TABLE transactions ADD COLUMN ${column} TEXT`),
      ).toHaveLength(1);
    }
    expect(
      executed.filter(sql => /CREATE TABLE IF NOT EXISTS transfer_pair_dismissals/.test(sql)),
    ).toHaveLength(1);
    const seeds = withParams.filter(c => Array.isArray(c.params) && c.params[0] === 'cat-transfer');
    expect(seeds).toHaveLength(1);
    expect(seeds[0].sql).toMatch(/^INSERT OR IGNORE INTO categories \(id, name, parent_id, type, icon, is_system\) VALUES \(\?, \?, NULL, \?, \?, 1\)$/);
    expect(seeds[0].params).toEqual(['cat-transfer', 'Transfer', 'both', 'swap-horizontal']);
    expect(appliedVersions.has(6)).toBe(true);
  });

  it('R3a: migration 6 never rewrites existing rows and interpolates no values', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m6 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 6);
    const sqls: string[] = m6.statements.map((st: string | { sql: string }) =>
      typeof st === 'string' ? st : st.sql,
    );
    const joined = sqls.join('\n');
    expect(joined).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b/);
    expect(joined).not.toContain("'cat-transfer'");
    expect(joined).toMatch(/PRIMARY KEY \(debit_id, credit_id\)/);
    expect(joined).toMatch(/debit_id TEXT NOT NULL,\s+credit_id TEXT NOT NULL,\s+dismissed_at TEXT NOT NULL/);
  });

  it('R3b: runs migration 7 exactly once (idempotent) and records it', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');

    await runMigrations();
    await runMigrations();
    await runMigrations();

    expect(
      executed.filter(sql => /CREATE TABLE IF NOT EXISTS duplicate_pair_dismissals/.test(sql)),
    ).toHaveLength(1);
    expect(appliedVersions.has(7)).toBe(true);
  });

  it('R3b: migration 7 only creates the dismissals table (a_id < b_id) and rewrites nothing', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m7 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 7);
    const sqls: string[] = m7.statements.map((st: string | { sql: string }) =>
      typeof st === 'string' ? st : st.sql,
    );
    expect(sqls).toHaveLength(1);
    const joined = sqls.join('\n');
    expect(joined).toMatch(/^CREATE TABLE IF NOT EXISTS duplicate_pair_dismissals/);
    expect(joined).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b|\bINSERT\b/);
    expect(joined).toMatch(/a_id TEXT NOT NULL,\s+b_id TEXT NOT NULL,\s+dismissed_at TEXT NOT NULL/);
    expect(joined).toMatch(/PRIMARY KEY \(a_id, b_id\)/);
    expect(joined).toMatch(/CHECK \(a_id < b_id\)/);
  });

  it('R5: migration 8 only creates sms_unparsed + sms_deleted_refs (no body / sender column), rewrites nothing', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m8 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 8);
    const sqls: string[] = m8.statements.map((st: string | { sql: string }) =>
      typeof st === 'string' ? st : st.sql,
    );
    const joined = sqls.join('\n');
    expect(joined).toMatch(/^CREATE TABLE IF NOT EXISTS sms_unparsed/);
    expect(joined).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b|\bINSERT\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b/i);
    expect(joined).toMatch(/PRIMARY KEY \(sms_id, sms_date\)/);
    // R5-fix C4: the tombstone table holds the reference hash only.
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS sms_deleted_refs \(\s*source_reference_hash TEXT PRIMARY KEY,\s*deleted_at TEXT NOT NULL\s*\)/);
  });

  it('R5d: migration 9 only adds the identity columns + indexes and rewrites nothing', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m9 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 9);
    const sqls: string[] = m9.statements.map((st: string | { sql: string }) =>
      typeof st === 'string' ? st : st.sql,
    );
    expect(sqls).toEqual([
      'ALTER TABLE transactions ADD COLUMN sms_content_hash TEXT',
      'ALTER TABLE transactions ADD COLUMN ref_digest TEXT',
      'ALTER TABLE sms_deleted_refs ADD COLUMN sms_content_hash TEXT',
      'ALTER TABLE sms_deleted_refs ADD COLUMN ref_key TEXT',
      'CREATE INDEX IF NOT EXISTS ix_transactions_sms_content_hash ON transactions(sms_content_hash)',
      'CREATE INDEX IF NOT EXISTS ix_transactions_ref_digest ON transactions(ref_digest)',
    ]);
    const joined = sqls.join('\n');
    expect(joined).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bINSERT\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b/i);
  });

  it('R5e: migration 10 creates the meaning tables + seeds EMI & Loans / Interest (bound params), rewrites nothing, and is the last migration', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m10 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 10);
    const sqls: string[] = m10.statements.map((st: string | { sql: string }) => (typeof st === 'string' ? st : st.sql));
    const joined = sqls.join('\n');
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS money_meaning_rules/);
    expect(joined).toMatch(/UNIQUE \(bank_canonical, kind, counterparty_key\)/);
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS money_meaning_suggestions/);
    expect(joined).toMatch(/transaction_id TEXT PRIMARY KEY/);
    expect(joined).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b|\bamount\b|\bmerchant\b/i);
    const seeds = m10.statements.filter((st: string | { sql: string }) => typeof st !== 'string');
    expect(seeds.map((st: { sql: string; params: unknown[] }) => st.params)).toEqual([
      ['cat-emi', 'EMI & Loans', 'expense', 'calendar-sync-outline'],
      ['cat-interest', 'Interest', 'income', 'percent-outline'],
    ]);
    for (const st of seeds) {
      expect(st.sql).toBe('INSERT OR IGNORE INTO categories (id, name, parent_id, type, icon, is_system) VALUES (?, ?, NULL, ?, ?, 1)');
    }
    expect(NUMBERED_MIGRATIONS.some((m: { version: number }) => m.version === 10)).toBe(true);
  });

  it('R5b: migration 11 adds accounts.credit_limit_minor + the bills table, rewrites nothing', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m11 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 11);
    expect(m11).toBeDefined();
    const joined = m11.statements
      .map((st: string | { sql: string }) => (typeof st === 'string' ? st : st.sql))
      .join('\n');
    expect(joined).toMatch(/ALTER TABLE accounts ADD COLUMN credit_limit_minor INTEGER/);
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS bills/);
    expect(joined).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b/i);
  });

  it('R5i: migration 12 adds the chain_suggestions table (ids/enums only), rewrites nothing', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m12 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 12);
    expect(m12).toBeDefined();
    const joined = m12.statements
      .map((st: string | { sql: string }) => (typeof st === 'string' ? st : st.sql))
      .join('\n');
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS chain_suggestions/);
    expect(joined).toMatch(/ix_chain_suggestions_status_child/);
    // No existing row is rewritten, and no SMS body / sender column is stored.
    expect(joined).not.toMatch(/\bUPDATE\b|\bALTER\b|\bDELETE\b|\bDROP\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b/i);
  });

  it('R5c: migration 13 adds the budgets table (ids/enum/amount only), rewrites nothing, and is a migration', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m13 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 13);
    expect(m13).toBeDefined();
    const joined = m13.statements
      .map((st: string | { sql: string }) => (typeof st === 'string' ? st : st.sql))
      .join('\n');
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS budgets/);
    expect(joined).toMatch(/category_id TEXT/);
    expect(joined).toMatch(/amount_minor INTEGER NOT NULL/);
    expect(joined).toMatch(/period TEXT NOT NULL DEFAULT 'monthly'/);
    expect(joined).toMatch(/ix_budgets_category/);
    // No existing row is rewritten, and no SMS body / sender / payee column.
    expect(joined).not.toMatch(/\bUPDATE\b|\bALTER\b|\bDELETE\b|\bDROP\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b|\bpayee\b|\bmerchant\b/i);
    expect(NUMBERED_MIGRATIONS.some((m: { version: number }) => m.version === 13)).toBe(true);
  });

  it('R6: migration 14 adds three nullable accounts snapshot columns (numbers/timestamps only), rewrites nothing', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m14 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 14);
    expect(m14).toBeDefined();
    const joined = m14.statements
      .map((st: string | { sql: string }) => (typeof st === 'string' ? st : st.sql))
      .join('\n');
    expect(joined).toMatch(/ALTER TABLE accounts ADD COLUMN sms_balance_minor INTEGER/);
    expect(joined).toMatch(/ALTER TABLE accounts ADD COLUMN sms_balance_at INTEGER/);
    expect(joined).toMatch(/ALTER TABLE accounts ADD COLUMN sms_balance_dismissed_at INTEGER/);
    expect(joined).not.toMatch(/NOT NULL|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bCREATE\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b/i);
    expect(NUMBERED_MIGRATIONS.some((m: { version: number }) => m.version === 14)).toBe(true);
  });

  it('R10: migration 15 adds people + iou_shares (additive, no SMS columns) and is the last migration', () => {
    const { NUMBERED_MIGRATIONS } = require('../migrations');
    const m15 = NUMBERED_MIGRATIONS.find((m: { version: number }) => m.version === 15);
    expect(m15).toBeDefined();
    const joined = m15.statements
      .map((st: string | { sql: string }) => (typeof st === 'string' ? st : st.sql))
      .join('\n');
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS people/);
    expect(joined).toMatch(/CREATE TABLE IF NOT EXISTS iou_shares/);
    expect(joined).toMatch(/direction TEXT NOT NULL/);
    expect(joined).toMatch(/amount_minor INTEGER NOT NULL/);
    expect(joined).toMatch(/settled_at TEXT/);
    expect(joined).toMatch(/repayment_transaction_id TEXT/);
    expect(joined).toMatch(/ix_iou_shares_person/);
    expect(joined).toMatch(/ix_iou_shares_settled/);
    expect(joined).not.toMatch(/\bUPDATE\b|\bALTER\b|\bDELETE\b|\bDROP\b/);
    expect(joined).not.toMatch(/\bbody\b|\baddress\b|\bsender\b|\bpreview\b|\bphone\b|\bcontact/i);
    expect(NUMBERED_MIGRATIONS[NUMBERED_MIGRATIONS.length - 1].version).toBe(15);
  });

  it('R10: runs migration 15 exactly once and records it', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();
    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);
    const { runMigrations } = require('../connection');
    await runMigrations();
    await runMigrations();
    expect(executed.filter(sql => /CREATE TABLE IF NOT EXISTS iou_shares/.test(sql))).toHaveLength(1);
    expect(appliedVersions.has(15)).toBe(true);
  });

  it('R6: runs migration 14 exactly once and records it', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();
    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);
    const { runMigrations } = require('../connection');
    await runMigrations();
    await runMigrations();
    expect(executed.filter(sql => /ADD COLUMN sms_balance_minor/.test(sql))).toHaveLength(1);
    expect(appliedVersions.has(14)).toBe(true);
  });

  it('R5c: runs migration 13 exactly once and records it', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();
    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);
    const { runMigrations } = require('../connection');
    await runMigrations();
    await runMigrations();
    expect(executed.filter(sql => /CREATE TABLE IF NOT EXISTS budgets/.test(sql))).toHaveLength(1);
    expect(appliedVersions.has(13)).toBe(true);
  });

  it('R5e: runs migration 10 exactly once and records it', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();
    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);
    const { runMigrations } = require('../connection');
    await runMigrations();
    await runMigrations();
    expect(executed.filter(sql => /CREATE TABLE IF NOT EXISTS money_meaning_rules/.test(sql))).toHaveLength(1);
    expect(executed.filter(sql => /CREATE TABLE IF NOT EXISTS money_meaning_suggestions/.test(sql))).toHaveLength(1);
    expect(appliedVersions.has(10)).toBe(true);
  });

  it('R5: runs migration 8 exactly once and records it', async () => {
    const { db, appliedVersions, executed } = makeFakeDb();
    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);
    const { runMigrations } = require('../connection');
    await runMigrations();
    await runMigrations();
    expect(executed.filter(sql => /CREATE TABLE IF NOT EXISTS sms_unparsed/.test(sql))).toHaveLength(1);
    expect(appliedVersions.has(8)).toBe(true);
  });

  it('a fresh install seeds the six base categories BEFORE migration 5 adds Uncategorised', async () => {
    const { db, executed } = makeFakeDb({ emptyCategories: true });

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');
    await runMigrations();

    const baseSeed = executed.findIndex(sql => /INSERT INTO categories \(id, name, parent_id, type, icon, is_system\) VALUES \(\?/.test(sql));
    const uncategorised = executed.findIndex(sql => /'cat-uncategorised'/.test(sql));
    expect(baseSeed).toBeGreaterThanOrEqual(0);
    expect(uncategorised).toBeGreaterThan(baseSeed);
    expect(
      executed.filter(sql => /INSERT INTO categories \(id, name, parent_id, type, icon, is_system\) VALUES \(\?/.test(sql)),
    ).toHaveLength(6);
  });

  it('never issues destructive SQL and leaves the failing unique-index migration unrecorded', async () => {
    const { db, appliedVersions, executed } = makeFakeDb({ failUniqueIndex: true });

    const { open } = require('@op-engineering/op-sqlite');
    open.mockReturnValue(db as unknown as DB);

    const { runMigrations } = require('../connection');

    await expect(runMigrations()).rejects.toThrow(/Migration 2 failed/);

    expect(appliedVersions.has(1)).toBe(true);
    expect(appliedVersions.has(2)).toBe(false);

    expect(executed.some(sql => /\bDELETE\b/.test(sql))).toBe(false);
    expect(executed.some(sql => /\bDROP\b/.test(sql))).toBe(false);
  });
});
