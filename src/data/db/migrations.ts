import { DB, Scalar } from '@op-engineering/op-sqlite';
import { TRANSFER_CATEGORY_ID } from '../../domain/categories/category.rules';

/**
 * Numbered, non-idempotent migrations. Unlike the flat `SCHEMA_STATEMENTS`
 * list (all `CREATE ... IF NOT EXISTS`, safe to re-run every start), these
 * statements cannot be re-run: an `ALTER TABLE ... ADD COLUMN` executed twice
 * throws "duplicate column name". Each entry is guarded by a
 * `schema_migrations` row and runs inside its own `db.transaction`.
 */
/** A statement with bound parameters (values are never interpolated into SQL). */
export interface ParameterizedStatement {
  sql: string;
  params: Scalar[];
}

export type MigrationStatement = string | ParameterizedStatement;

export interface NumberedMigration {
  version: number;
  statements: MigrationStatement[];
}

/** R3a system "Transfer" category — bound as parameters by migration 6. */
export const TRANSFER_CATEGORY_SEED = {
  id: TRANSFER_CATEGORY_ID,
  name: 'Transfer',
  type: 'both',
  icon: 'swap-horizontal',
} as const;

/** R5e seeds — "EMI & Loans" (expense) and "Interest" (income), bound by migration 10. */
export const MEANING_CATEGORY_SEEDS = [
  { id: 'cat-emi', name: 'EMI & Loans', type: 'expense', icon: 'calendar-sync-outline' },
  { id: 'cat-interest', name: 'Interest', type: 'income', icon: 'percent-outline' },
] as const;

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
  {
    // R3a transfers between own accounts. A transfer is ONE row: account_id =
    // "from", transfer_account_id = "to". A confirmed SMS pair keeps its
    // credit half as a rejected 'transfer_twin' linked to the transfer (for
    // dedup by source_reference_hash). link_kind values: 'transfer_twin'
    // (R3a); 'refund' / 'duplicate' come with R3b. Existing rows are never
    // rewritten: all three columns start NULL. The type-neutral system
    // "Transfer" category is seeded with bound parameters + INSERT OR IGNORE
    // (single row even if re-run). "Not a transfer" decisions live in
    // transfer_pair_dismissals.
    version: 6,
    statements: [
      'ALTER TABLE transactions ADD COLUMN transfer_account_id TEXT',
      'ALTER TABLE transactions ADD COLUMN linked_transaction_id TEXT',
      'ALTER TABLE transactions ADD COLUMN link_kind TEXT',
      {
        sql: 'INSERT OR IGNORE INTO categories (id, name, parent_id, type, icon, is_system) VALUES (?, ?, NULL, ?, ?, 1)',
        params: [
          TRANSFER_CATEGORY_SEED.id,
          TRANSFER_CATEGORY_SEED.name,
          TRANSFER_CATEGORY_SEED.type,
          TRANSFER_CATEGORY_SEED.icon,
        ],
      },
      `CREATE TABLE IF NOT EXISTS transfer_pair_dismissals (
    debit_id TEXT NOT NULL,
    credit_id TEXT NOT NULL,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (debit_id, credit_id)
  )`,
      'CREATE INDEX IF NOT EXISTS ix_tx_linked ON transactions(linked_transaction_id)',
    ],
  },
  {
    // R3b refunds + duplicates. Refund and duplicate links reuse migration 6's
    // linked_transaction_id / link_kind columns ('refund' / 'duplicate'), so
    // no transactions column is added and no existing row is rewritten.
    // "Not duplicates" decisions: one row per unordered pair, a_id < b_id
    // (the repository orders the ids and inserts with bound parameters).
    version: 7,
    statements: [
      `CREATE TABLE IF NOT EXISTS duplicate_pair_dismissals (
    a_id TEXT NOT NULL,
    b_id TEXT NOT NULL,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id < b_id)
  )`,
    ],
  },
  {
    // R5 "Messages not understood": one row per inbox SMS the reader could
    // not turn into a transaction or a known non-transaction class. NO body,
    // NO sender number — only the SMS content-provider id + date (to read it
    // live on tap), a reason code and the public institution id. Device-local:
    // excluded from backups (backup.tables.ts DEVICE_LOCAL_TABLES).
    version: 8,
    statements: [
      `CREATE TABLE IF NOT EXISTS sms_unparsed (
    sms_id TEXT NOT NULL,
    sms_date INTEGER NOT NULL,
    reason_code TEXT NOT NULL,
    institution TEXT NOT NULL,
    parser_version INTEGER NOT NULL,
    detected_at TEXT NOT NULL,
    dismissed_at TEXT,
    resolved_at TEXT,
    PRIMARY KEY (sms_id, sms_date)
  )`,
      'CREATE INDEX IF NOT EXISTS ix_sms_unparsed_open ON sms_unparsed(dismissed_at, resolved_at)',
      // R5-fix C4 (folded into 8 — migration 8 was never released): tombstones
      // of DELETED SMS-sourced transactions, so a re-scan / the 1-day overlap
      // never brings them back. Holds the `sms-<id>-<date>` reference hash
      // only (no SMS content). Backed up: a restore on the same phone keeps
      // deleted items deleted.
      `CREATE TABLE IF NOT EXISTS sms_deleted_refs (
    source_reference_hash TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  )`,
    ],
  },
  {
    // R5d stable SMS identity + persisted reference dedupe. All columns start
    // NULL; no existing row is rewritten here (sync backfills
    // sms_content_hash lazily when it sees the same SMS again).
    //  - sms_content_hash: salted SHA-256 (32 hex) of header + second + body —
    //    survives a changed inbox `_id` (new phone, SMS restore).
    //  - ref_digest: salted SHA-256 (32 hex) of the UPI/IMPS/NEFT reference.
    //  - sms_deleted_refs.ref_key: a deleted row's ref_digest bound to its
    //    type + amount (hashed again), so a deleted debit stays deleted when
    //    a second alert with the same reference arrives, but never blocks
    //    its reversal (a different type).
    // No SMS text, sender or raw reference is stored.
    version: 9,
    statements: [
      'ALTER TABLE transactions ADD COLUMN sms_content_hash TEXT',
      'ALTER TABLE transactions ADD COLUMN ref_digest TEXT',
      'ALTER TABLE sms_deleted_refs ADD COLUMN sms_content_hash TEXT',
      'ALTER TABLE sms_deleted_refs ADD COLUMN ref_key TEXT',
      'CREATE INDEX IF NOT EXISTS ix_transactions_sms_content_hash ON transactions(sms_content_hash)',
      'CREATE INDEX IF NOT EXISTS ix_transactions_ref_digest ON transactions(ref_digest)',
    ],
  },
  {
    // R5e money meaning. Two new tables, no existing row is rewritten:
    //  - money_meaning_rules: "Do this automatically next time" — public bank
    //    id + meaning kind + counterparty key (last-4, 3-digit mask or a
    //    wallet's public id; '' when none) → target account. The same class
    //    of data as account_suggestion_decisions.
    //  - money_meaning_suggestions: one per transaction — the meaning, the
    //    resolved target / reason, the rule key (bank id + counterparty key)
    //    and how it was closed. Ids / enums / last-4 only, never SMS text.
    // Plus the "EMI & Loans" / "Interest" system categories (bound params,
    // INSERT OR IGNORE — replay-safe on restore).
    version: 10,
    statements: [
      `CREATE TABLE IF NOT EXISTS money_meaning_rules (
    id TEXT PRIMARY KEY,
    bank_canonical TEXT NOT NULL,
    kind TEXT NOT NULL,
    counterparty_key TEXT NOT NULL DEFAULT '',
    target_account_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (bank_canonical, kind, counterparty_key)
  )`,
      `CREATE TABLE IF NOT EXISTS money_meaning_suggestions (
    transaction_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_account_id TEXT,
    reason TEXT NOT NULL,
    bank_canonical TEXT NOT NULL DEFAULT '',
    counterparty_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution TEXT
  )`,
      ...MEANING_CATEGORY_SEEDS.map(seed => ({
        sql: 'INSERT OR IGNORE INTO categories (id, name, parent_id, type, icon, is_system) VALUES (?, ?, NULL, ?, ?, 1)',
        params: [seed.id, seed.name, seed.type, seed.icon],
      })),
    ],
  },
  {
    // R5b bills & dues. One new table + one new account column, no existing
    // row is rewritten (credit_limit_minor starts NULL):
    //  - bills: a card statement / pay-later / biller / scheduled-debit /
    //    manual bill. Bills NEVER touch balances and are NEVER transactions.
    //    `payee` is user text or a known issuer display name only (never raw
    //    SMS text, never a sender number); `source_hash` is the R5d salted
    //    content hash (no SMS content). `due_date` is nullable (an SMS bill
    //    with no parseable due date still becomes an open bill). `repeat`
    //    ('none' | 'monthly') drives D-h monthly manual bills.
    //  - accounts.credit_limit_minor: the user's manual credit limit for a
    //    credit_card / pay_later account (paise). Never set from an SMS.
    version: 11,
    statements: [
      'ALTER TABLE accounts ADD COLUMN credit_limit_minor INTEGER',
      `CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    kind TEXT NOT NULL,
    payee TEXT NOT NULL,
    amount_due_minor INTEGER NOT NULL,
    min_due_minor INTEGER,
    statement_date TEXT,
    due_date TEXT,
    status TEXT NOT NULL,
    paid_minor INTEGER NOT NULL DEFAULT 0,
    paid_transaction_id TEXT,
    source TEXT NOT NULL,
    source_hash TEXT,
    repeat TEXT NOT NULL DEFAULT 'none',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
      'CREATE INDEX IF NOT EXISTS ix_bills_status_due ON bills(status, due_date)',
      'CREATE INDEX IF NOT EXISTS ix_bills_source_hash ON bills(source_hash)',
    ],
  },
  {
    // R5i (G3) chain suggestions persisted. Before, rules-engine chaining
    // outcomes (duplicate / refund_link / transfer_twin / incomplete) lived
    // only in a session-only zustand store and died on restart. This table
    // keeps them across restarts and feeds the Review "Linked by rules"
    // section. IDS + ENUMS ONLY — never an SMS body or a sender number:
    //  - kind: the chaining outcome enum;
    //  - child_id: the pending child transaction;
    //  - parent_id: the matched parent (nullable for 'incomplete');
    //  - parent_override: JSON of the RuleChainOverride ENUM/BOOLEAN fields
    //    ONLY (deleted / link / incomplete), applied if the user confirms;
    //  - status: open / accepted / dismissed / superseded.
    // One OPEN row per child_id (a newer suggestion REPLACES the open one —
    // the repository deletes the open row for that child before inserting).
    // Backed up (R4e); a restore of an older backup without the table still
    // works (the table is created by this migration on the current phone).
    version: 12,
    statements: [
      `CREATE TABLE IF NOT EXISTS chain_suggestions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    child_id TEXT NOT NULL,
    parent_id TEXT,
    parent_override TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
      'CREATE INDEX IF NOT EXISTS ix_chain_suggestions_status_child ON chain_suggestions(status, child_id)',
    ],
  },
  {
    // R5c budgets. One new table, no existing row is rewritten. A budget is a
    // monthly spending cap and a READ-ONLY overlay on spend — it NEVER touches
    // balances or transactions. IDS + AN ENUM PERIOD + AN AMOUNT ONLY:
    //  - category_id: NULL = the single overall budget; otherwise the category
    //    it caps. The repository enforces at most one overall budget and at
    //    most one budget per category (upsert by key: a set replaces, never
    //    duplicates — SQLite treats NULLs as distinct in a UNIQUE index, so the
    //    singleness is enforced in TS, not by the index);
    //  - amount_minor: the cap in paise;
    //  - period: only 'monthly' is used now; the column keeps the door open.
    // Backed up (R4e); a restore of an older backup without the table still
    // works (the table is created by this migration on the current phone).
    version: 13,
    statements: [
      `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    amount_minor INTEGER NOT NULL,
    period TEXT NOT NULL DEFAULT 'monthly',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
      'CREATE INDEX IF NOT EXISTS ix_budgets_category ON budgets(category_id)',
    ],
  },
  {
    // R6 balance reconciliation. Three nullable accounts columns, additive, no
    // row rewritten (all start NULL = "no snapshot"). NUMBERS + EPOCH-MS ONLY —
    // never an SMS body, sender or preview:
    //  - sms_balance_minor: the balance (paise) the latest matched bank SMS
    //    reported for this account;
    //  - sms_balance_at: epoch ms of that SMS (latest wins, see
    //    accountRepository.setSmsBalanceSnapshot);
    //  - sms_balance_dismissed_at: the sms_balance_at the user dismissed the
    //    difference for (a newer snapshot re-surfaces it).
    // The snapshot is a fact about the account; it never changes a balance.
    // Backed up (R4e) with sinceVersion 14; an older backup without them
    // restores with the columns NULL.
    version: 14,
    statements: [
      'ALTER TABLE accounts ADD COLUMN sms_balance_minor INTEGER',
      'ALTER TABLE accounts ADD COLUMN sms_balance_at INTEGER',
      'ALTER TABLE accounts ADD COLUMN sms_balance_dismissed_at INTEGER',
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
          if (typeof statement === 'string') await tx.execute(statement);
          else await tx.execute(statement.sql, statement.params);
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
