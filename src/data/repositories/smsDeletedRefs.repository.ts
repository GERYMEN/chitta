import { getDatabase } from '../db/connection';

/**
 * R5-fix C4 — tombstones of deleted SMS-sourced transactions (table
 * sms_deleted_refs, migration 8). Only the `sms-<id>-<date>` reference hash
 * is kept — never SMS content. Written by transactionRepository.delete in the
 * same db.transaction as the DELETE; read by sync and "New accounts found"
 * imports so deleted items never come back.
 */
async function listHashes(): Promise<Set<string>> {
  const result = await getDatabase().execute('SELECT * FROM sms_deleted_refs');
  return new Set(result.rows.map(row => String((row as Record<string, unknown>).source_reference_hash)));
}

export const smsDeletedRefsRepository = { listHashes };
