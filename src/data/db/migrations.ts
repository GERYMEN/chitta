import { DB } from '@op-engineering/op-sqlite';

/**
 * Numbered, non-idempotent migrations. Unlike the flat `SCHEMA_STATEMENTS`
 * list (all `CREATE ... IF NOT EXISTS`, safe to re-run every start), these
 * statements cannot be re-run: an `ALTER TABLE ... ADD COLUMN` executed twice
 * throws "duplicate column name". Each entry is guarded by a
 * `schema_migrations` row and runs inside its own `db.transaction`.
 */
export interface NumberedMigration {
  version: number;
  statements: string[];
}

export const NUMBERED_MIGRATIONS: NumberedMigration[] = [
  {
    version: 1,
    statements: [
      'ALTER TABLE accounts ADD COLUMN balance_anchor_minor INTEGER',
      'ALTER TABLE accounts ADD COLUMN balance_anchor_at INTEGER',
      'ALTER TABLE accounts ADD COLUMN deleted_at INTEGER',
      'ALTER TABLE transactions ADD COLUMN bulk_batch_id TEXT',
    ],
  },
  {
    version: 2,
    statements: [
      'CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_source_hash ON transactions(source_reference_hash)',
    ],
  },
  {
    // The SMS parser used to emit 0–1 confidence scores while the domain
    // rules (transaction.rules.ts) use a 0–100 scale. Rescale existing SMS
    // rows once; the WHERE clause keeps it safe even if it ever re-ran.
    version: 3,
    statements: [
      "UPDATE transactions SET confidence_score = confidence_score * 100 WHERE source_type = 'sms' AND confidence_score IS NOT NULL AND confidence_score <= 1",
    ],
  },
  {
    // R1 audit writer: account events need their own subject column, and the
    // Activity feed pages by event_at and looks events up by transaction.
    version: 4,
    statements: [
      'ALTER TABLE audit_events ADD COLUMN account_id TEXT',
      'CREATE INDEX IF NOT EXISTS ix_audit_event_at ON audit_events(event_at)',
      'CREATE INDEX IF NOT EXISTS ix_audit_transaction ON audit_events(transaction_id)',
    ],
  },
  {
    // R2 smart categories: merchant → category rules, archivable custom
    // categories with a theme colour key, and the type-neutral system
    // "Uncategorised" bucket. `categories.is_system` already exists in the
    // base CREATE TABLE on every install, so it is not re-added. Existing
    // transactions are NOT touched (owner's data) — only new SMS items land
    // in Uncategorised. INSERT OR IGNORE keeps the seed single even if the
    // id already exists.
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS merchant_rules (
    merchant_key TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
      'ALTER TABLE categories ADD COLUMN archived_at TEXT',
      'ALTER TABLE categories ADD COLUMN color TEXT',
      "INSERT OR IGNORE INTO categories (id, name, parent_id, type, icon, is_system) VALUES ('cat-uncategorised', 'Uncategorised', NULL, 'both', 'help-circle-outline', 1)",
    ],
  },
];

async function isApplied(database: DB, version: number): Promise<boolean> {
  const result = await database.execute(
    'SELECT 1 FROM schema_migrations WHERE version = ?',
    [version],
  );
  return result.rows.length > 0;
}

/**
 * Runs every numbered migration exactly once per device. A migration that
 * throws is NOT recorded in `schema_migrations` (its transaction rolls back),
 * so it retries on the next app start; the error is re-thrown with context
 * rather than swallowed, so a failure (e.g. a duplicate that blocks the
 * unique index) stays visible.
 */
export async function runNumberedMigrations(database: DB): Promise<void> {
  for (const migration of NUMBERED_MIGRATIONS) {
    if (await isApplied(database, migration.version)) continue;

    try {
      await database.transaction(async tx => {
        for (const statement of migration.statements) {
          await tx.execute(statement);
        }
        await tx.execute(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
          [migration.version, Date.now()],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Migration ${migration.version} failed and was left unapplied (will retry on next start): ${message}`,
      );
    }
  }
}
