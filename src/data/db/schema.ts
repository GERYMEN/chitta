/**
 * SQLite DDL. Booleans are stored as INTEGER 0/1 (SQLite has no native
 * boolean) and mapped to/from JS `boolean` in the mapper layer — the 0/1
 * INTEGER never leaks into domain objects.
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    last_four TEXT,
    opening_balance_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    type TEXT NOT NULL,
    icon TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0
  );`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    merchant_name TEXT NOT NULL,
    category_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    approved_at TEXT,
    note TEXT,
    source_type TEXT NOT NULL,
    source_reference_hash TEXT,
    sanitized_preview TEXT,
    confidence_score REAL,
    parser_version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );`,

  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    event_type TEXT NOT NULL,
    event_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id)
  );`,

  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS account_suggestion_decisions (
    bank_canonical     TEXT    NOT NULL,
    account_kind       TEXT    NOT NULL,
    last_four          TEXT    NOT NULL DEFAULT '',
    decision           TEXT    NOT NULL
                       CHECK (decision IN ('added','linked','ignored','deleted')),
    account_id         TEXT,
    normalizer_version INTEGER NOT NULL,
    decided_at         INTEGER NOT NULL,
    PRIMARY KEY (bank_canonical, account_kind, last_four)
  );`,

  `CREATE TABLE IF NOT EXISTS account_suggestion_candidates (
    bank_canonical     TEXT    NOT NULL,
    account_kind       TEXT    NOT NULL,
    last_four          TEXT    NOT NULL DEFAULT '',
    txn_count          INTEGER NOT NULL,
    first_seen_at      INTEGER NOT NULL,
    last_seen_at       INTEGER NOT NULL,
    normalizer_version INTEGER NOT NULL,
    PRIMARY KEY (bank_canonical, account_kind, last_four)
  );`,

  `CREATE TABLE IF NOT EXISTS sms_sync_runs (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('initial','incremental','backfill')),
    range_from    INTEGER NOT NULL,
    range_to      INTEGER,
    cursor_date   INTEGER,
    cursor_sms_id INTEGER,
    status        TEXT NOT NULL CHECK (status IN ('running','done','failed')),
    started_at    INTEGER NOT NULL,
    finished_at   INTEGER
  );`,

  `CREATE INDEX IF NOT EXISTS ix_tx_status_date ON transactions(status, occurred_at);`,

  `CREATE INDEX IF NOT EXISTS ix_tx_account_date ON transactions(account_id, occurred_at);`,
];
