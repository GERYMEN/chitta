/**
 * R4e: synthetic rows for EVERY backup table (QA names only, no real data),
 * written with the columns of the current schema. `rowsAt(version)` trims
 * them to what a database at that older schema version could hold.
 */
import {
  BACKUP_TABLES,
  backupTableSpec,
  columnsAt,
} from '../../domain/backup/backup.tables';
import type { BackupRow, BackupTables } from '../../domain/backup/backup.payload';

const T0 = '2026-10-01T09:00:00.000Z';
const T1 = '2026-10-05T10:30:00.000Z';

const tx = (id: string, patch: BackupRow): BackupRow => ({
  id,
  type: 'expense',
  status: 'approved',
  amount_minor: 12345,
  currency: 'INR',
  merchant_name: `QA-Merchant-${id}`,
  category_id: 'cat-food',
  account_id: 'acc-qa-1',
  payment_method: 'upi',
  occurred_at: T1,
  detected_at: T1,
  approved_at: T1,
  note: null,
  source_type: 'manual',
  source_reference_hash: null,
  sanitized_preview: null,
  confidence_score: null,
  parser_version: null,
  created_at: T1,
  updated_at: T1,
  bulk_batch_id: null,
  transfer_account_id: null,
  linked_transaction_id: null,
  link_kind: null,
  ...patch,
});

export const FULL_BACKUP_ROWS: BackupTables = {
  categories: [
    { id: 'cat-food', name: 'Food & Dining', parent_id: null, type: 'expense', icon: 'silverware-fork-knife', is_system: 1, archived_at: null, color: null },
    { id: 'cat-qa-custom', name: 'QA Category', parent_id: null, type: 'expense', icon: 'shape-outline', is_system: 0, archived_at: T1, color: 'amber' },
  ],
  accounts: [
    { id: 'acc-qa-1', name: 'QA Bank', type: 'bank', last_four: '9999', opening_balance_minor: 100000, currency: 'INR', is_active: 1, created_at: T0, updated_at: T0, balance_anchor_minor: 250000, balance_anchor_at: 1759300000000, deleted_at: null },
    { id: 'acc-qa-2', name: 'QA Wallet', type: 'wallet', last_four: null, opening_balance_minor: 0, currency: 'INR', is_active: 1, created_at: T0, updated_at: T0, balance_anchor_minor: null, balance_anchor_at: null, deleted_at: 1759400000000 },
  ],
  transactions: [
    tx('qa-t1', { note: 'QA note' }),
    tx('qa-t2', {
      status: 'pending',
      approved_at: null,
      source_type: 'sms',
      source_reference_hash: 'qa-hash-1',
      sanitized_preview: 'QA preview text',
      confidence_score: 0.85,
      parser_version: 'qa-1',
    }),
    tx('qa-t3', { type: 'transfer', category_id: 'cat-transfer', transfer_account_id: 'acc-qa-2', bulk_batch_id: 'qa-batch' }),
    tx('qa-t4', { type: 'income', status: 'rejected', linked_transaction_id: 'qa-t3', link_kind: 'transfer_twin', source_type: 'sms', source_reference_hash: 'qa-hash-2', confidence_score: 92 }),
  ],
  audit_events: [
    { id: 'qa-a1', transaction_id: 'qa-t1', event_type: 'created', event_at: T1, actor: 'user', metadata_json: '{"kind":"created","transactionType":"expense"}', account_id: null },
    { id: 'qa-a2', transaction_id: null, event_type: 'account_created', event_at: T1, actor: 'user', metadata_json: null, account_id: 'acc-qa-1' },
    // Same timestamp as qa-a2: rowid order is the feed tie-breaker and must survive.
    { id: 'qa-a0', transaction_id: 'qa-gone', event_type: 'deleted', event_at: T1, actor: 'user', metadata_json: '{"kind":"deleted","merchantName":"QA-Merchant-09","amountMinor":100,"type":"expense","status":"approved"}', account_id: null },
  ],
  app_settings: [
    { key: 'has_onboarded', value: 'true' },
    { key: 'user_name', value: 'QA' },
    { key: 'approval_mode', value: 'manual' },
    { key: 'sms_sync_start_mode', value: 'custom' },
    { key: 'sms_sync_start_at', value: T0 },
    { key: 'sms_last_synced_at', value: T1 },
    { key: 'tour_completed_at', value: T1 },
    { key: 'feedback_button_position', value: '{"side":"left","centerY":300}' },
  ],
  merchant_rules: [
    { merchant_key: 'qa merchant', category_id: 'cat-qa-custom', created_at: T1, updated_at: T1 },
  ],
  account_suggestion_decisions: [
    { bank_canonical: 'QABANK', account_kind: 'bank', last_four: '9999', decision: 'added', account_id: 'acc-qa-1', normalizer_version: 1, decided_at: 1759300000000 },
  ],
  account_suggestion_candidates: [
    { bank_canonical: 'QABANK', account_kind: 'card', last_four: '1111', txn_count: 3, first_seen_at: 1759000000000, last_seen_at: 1759300000000, normalizer_version: 1 },
  ],
  sms_sync_runs: [
    { id: 'qa-run-1', kind: 'initial', range_from: 1759000000000, range_to: 1759300000000, cursor_date: null, cursor_sms_id: null, status: 'done', started_at: 1759300000000, finished_at: 1759300005000 },
  ],
  transfer_pair_dismissals: [{ debit_id: 'qa-t1', credit_id: 'qa-t4', dismissed_at: T1 }],
  duplicate_pair_dismissals: [{ a_id: 'qa-t1', b_id: 'qa-t2', dismissed_at: T1 }],
};

/** The fixture as a database at `version` could hold it (tables + columns). */
export function rowsAt(version: number): BackupTables {
  const out: BackupTables = {};
  for (const spec of BACKUP_TABLES) {
    if (spec.sinceVersion > version) continue;
    const allowed = new Set(columnsAt(backupTableSpec(spec.name)!, version));
    out[spec.name] = (FULL_BACKUP_ROWS[spec.name] ?? []).map(row =>
      Object.fromEntries(Object.entries(row).filter(([column]) => allowed.has(column))),
    );
  }
  return out;
}
