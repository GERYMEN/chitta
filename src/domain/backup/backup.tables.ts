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
 * backup records its number as `schemaVersion` instead).
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
];

export const BACKUP_TABLE_NAMES: ReadonlyArray<string> = BACKUP_TABLES.map(t => t.name);

/**
 * app_settings keys that describe THIS phone, not the user's data: never
 * written into a backup and never overwritten by a restore.
 */
export const DEVICE_LOCAL_SETTING_KEYS: ReadonlyArray<string> = ['last_backup_at'];

export function backupTableSpec(name: string): BackupTableSpec | undefined {
  return BACKUP_TABLES.find(t => t.name === name);
}

/** Columns a row of `table` may carry in a backup made at `schemaVersion`. */
export function columnsAt(spec: BackupTableSpec, schemaVersion: number): string[] {
  return Object.entries(spec.columns)
    .filter(([, since]) => since <= schemaVersion)
    .map(([name]) => name);
}
