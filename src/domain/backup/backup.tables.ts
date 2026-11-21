/**
 * R4e: every user-data table a backup carries, with the schema version
 * (numbered migration) each table and column first appeared in. Version 0 =
 * the base `SCHEMA_STATEMENTS` (data/db/schema.ts).
 *
 * Order matters: parents before children (categories/accounts before
 * transactions, transactions before audit_events). Restore deletes in reverse
 * order and inserts in this order.
 *
 * Not exported: `schema_migrations` (bookkeeping of the DB itself — the
 * backup records its number as `schemaVersion` instead) and the
 * DEVICE_LOCAL_TABLES below.
 *
 * A test (backup.tables.test.ts) builds the real schema in SQLite and fails
 * when a migration adds a table or column that is missing here — update this
 * list with every new migration.
 */
export interface BackupTableSpec {
  name: string;
  /** Migration that created the table (0 = base schema). */
  sinceVersion: number;
  /** Column → migration that added it (0 = base schema). */
  columns: Readonly<Record<string, number>>;
}

const base = (...names: string[]): Record<string, number> =>
  Object.fromEntries(names.map(name => [name, 0]));

export const BACKUP_TABLES: ReadonlyArray<BackupTableSpec> = [
  {
    name: 'categories',
    sinceVersion: 0,
    columns: {
      ...base('id', 'name', 'parent_id', 'type', 'icon', 'is_system'),
      archived_at: 5,
      color: 5,
    },
  },
  {
    name: 'accounts',
    sinceVersion: 0,
    columns: {
      ...base(
        'id',
        'name',
        'type',
        'last_four',
        'opening_balance_minor',
        'currency',
        'is_active',
        'created_at',
        'updated_at',
      ),
      balance_anchor_minor: 1,
      balance_anchor_at: 1,
      deleted_at: 1,
      // R5b: the user's manual credit limit (never from an SMS).
      credit_limit_minor: 11,
    },
  },
  {
    name: 'transactions',
    sinceVersion: 0,
    columns: {
      ...base(
        'id',
        'type',
        'status',
        'amount_minor',
        'currency',
        'merchant_name',
        'category_id',
        'account_id',
        'payment_method',
        'occurred_at',
        'detected_at',
        'approved_at',
        'note',
        'source_type',
        'source_reference_hash',
        'sanitized_preview',
        'confidence_score',
        'parser_version',
        'created_at',
        'updated_at',
      ),
      bulk_batch_id: 1,
      transfer_account_id: 6,
      linked_transaction_id: 6,
      link_kind: 6,
      // R5d: salted identity hashes (no SMS content) — restored rows keep deduping.
      sms_content_hash: 9,
      ref_digest: 9,
    },
  },
  {
    name: 'audit_events',
    sinceVersion: 0,
    columns: {
      ...base('id', 'transaction_id', 'event_type', 'event_at', 'actor', 'metadata_json'),
      account_id: 4,
    },
  },
  { name: 'app_settings', sinceVersion: 0, columns: base('key', 'value') },
  {
    name: 'merchant_rules',
    sinceVersion: 5,
    columns: { merchant_key: 5, category_id: 5, created_at: 5, updated_at: 5 },
  },
  {
    name: 'account_suggestion_decisions',
    sinceVersion: 0,
    columns: base(
      'bank_canonical',
      'account_kind',
      'last_four',
      'decision',
      'account_id',
      'normalizer_version',
      'decided_at',
    ),
  },
  {
    name: 'account_suggestion_candidates',
    sinceVersion: 0,
    columns: base(
      'bank_canonical',
      'account_kind',
      'last_four',
      'txn_count',
      'first_seen_at',
      'last_seen_at',
      'normalizer_version',
    ),
  },
  {
    name: 'sms_sync_runs',
    sinceVersion: 0,
    columns: base(
      'id',
      'kind',
      'range_from',
      'range_to',
      'cursor_date',
      'cursor_sms_id',
      'status',
      'started_at',
      'finished_at',
    ),
  },
  {
    name: 'transfer_pair_dismissals',
    sinceVersion: 6,
    columns: { debit_id: 6, credit_id: 6, dismissed_at: 6 },
  },
  {
    name: 'duplicate_pair_dismissals',
    sinceVersion: 7,
    columns: { a_id: 7, b_id: 7, dismissed_at: 7 },
  },
  {
    // R5-fix C4: tombstones of deleted SMS items (reference hash only). Backed
    // up so a restore on the same phone keeps deleted items deleted.
    name: 'sms_deleted_refs',
    sinceVersion: 8,
    columns: { source_reference_hash: 8, deleted_at: 8, sms_content_hash: 9, ref_key: 9 },
  },
  {
    // R5e: "Do this automatically next time" meaning rules (bank id + kind +
    // last-4 / wallet id → account).
    name: 'money_meaning_rules',
    sinceVersion: 10,
    columns: {
      id: 10,
      bank_canonical: 10,
      kind: 10,
      counterparty_key: 10,
      target_account_id: 10,
      created_at: 10,
    },
  },
  {
    // R5e: one meaning suggestion per transaction (open or closed).
    name: 'money_meaning_suggestions',
    sinceVersion: 10,
    columns: {
      transaction_id: 10,
      kind: 10,
      target_account_id: 10,
      reason: 10,
      bank_canonical: 10,
      counterparty_key: 10,
      created_at: 10,
      resolved_at: 10,
      resolution: 10,
    },
  },
  {
    // R5b: bills & dues. References accounts and (optionally) a transaction,
    // so it restores after both. `payee` is user text / a known issuer display
    // name only; `source_hash` is the salted content hash (no SMS content).
    name: 'bills',
    sinceVersion: 11,
    columns: {
      id: 11,
      account_id: 11,
      kind: 11,
      payee: 11,
      amount_due_minor: 11,
      min_due_minor: 11,
      statement_date: 11,
      due_date: 11,
      status: 11,
      paid_minor: 11,
      paid_transaction_id: 11,
      source: 11,
      source_hash: 11,
      repeat: 11,
      created_at: 11,
      updated_at: 11,
    },
  },
  {
    // R5i (G3): persisted chain suggestions (ids + enums only). References a
    // child / parent transaction, so it restores after `transactions`.
    // `parent_override` is a JSON of the RuleChainOverride enum/boolean fields
    // only — never SMS text. A restore of an older backup without this table
    // still works (the table is created by migration 12 on the phone).
    name: 'chain_suggestions',
    sinceVersion: 12,
    columns: {
      id: 12,
      kind: 12,
      child_id: 12,
      parent_id: 12,
      parent_override: 12,
      status: 12,
      created_at: 12,
      updated_at: 12,
    },
  },
  {
    // R5c: budgets (monthly spending caps). A READ-ONLY overlay on spend —
    // ids, an enum period and an amount only. `category_id` is NULL for the
    // overall budget, else the category it caps (references `categories`, so it
    // restores after it). A restore of an older backup without this table still
    // works (the table is created by migration 13 on the phone).
    name: 'budgets',
    sinceVersion: 13,
    columns: {
      id: 13,
      category_id: 13,
      amount_minor: 13,
      period: 13,
      created_at: 13,
      updated_at: 13,
    },
  },
];

/**
 * R5: tables that describe THIS phone's inbox, not the user's data — never
 * written into a backup and never touched by a restore. `sms_unparsed` holds
 * SMS content-provider ids, which mean nothing on another phone.
 */
export const DEVICE_LOCAL_TABLES: ReadonlyArray<string> = ['sms_unparsed'];

export const BACKUP_TABLE_NAMES: ReadonlyArray<string> = BACKUP_TABLES.map(t => t.name);

/**
 * app_settings keys that describe THIS phone, not the user's data: never
 * written into a backup and never overwritten by a restore.
 */
export const DEVICE_LOCAL_SETTING_KEYS: ReadonlyArray<string> = [
  'last_backup_at',
  // R5: auto-read follows this phone's RECEIVE_SMS grant; the reader-version
  // hint is about this phone's inbox.
  'sms_auto_read',
  'sms_reader_version_seen',
];

export function backupTableSpec(name: string): BackupTableSpec | undefined {
  return BACKUP_TABLES.find(t => t.name === name);
}

/** Columns a row of `table` may carry in a backup made at `schemaVersion`. */
export function columnsAt(spec: BackupTableSpec, schemaVersion: number): string[] {
  return Object.entries(spec.columns)
    .filter(([, since]) => since <= schemaVersion)
    .map(([name]) => name);
}
