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
}

function makeFakeDb(options: { failUniqueIndex?: boolean } = {}): FakeState {
  const { failUniqueIndex = false } = options;
  const appliedVersions = new Set<number>();
  const executed: string[] = [];

  const tx: FakeTx = {
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      executed.push(sql);
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
        return { rows: [{ count: 1 }] };
      }
      return { rows: [] };
    }),
    transaction: jest.fn(async (fn: (t: FakeTx) => Promise<void>) => fn(tx)),
  };

  return { db, appliedVersions, executed };
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

    // 4 from migration 1 + audit_events.account_id from migration 4.
    expect(alterCounts.size).toBe(5);
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
    expect(NUMBERED_MIGRATIONS[NUMBERED_MIGRATIONS.length - 1].version).toBe(4);
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
