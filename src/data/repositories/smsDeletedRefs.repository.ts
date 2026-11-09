import { getDatabase } from '../db/connection';

/**
 * R5-fix C4 — tombstones of deleted SMS-sourced transactions (table
 * sms_deleted_refs, migration 8; R5d migration 9 adds sms_content_hash and
 * ref_key). Only one-way keys are kept — the `sms-<id>-<date>` reference
 * hash, the salted content hash and the salted reference key — never SMS
 * content. Written by transactionRepository.delete in the same
 * db.transaction as the DELETE; read by sync and "New accounts found"
 * imports so deleted items never come back.
 */
export interface SmsTombstoneRow {
  sourceReferenceHash: string;
  smsContentHash: string | null;
  /** refTombstoneKey(ref_digest, type, amount) of the deleted row. */
  refKey: string | null;
}

function nullableString(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

async function listAll(): Promise<SmsTombstoneRow[]> {
  const result = await getDatabase().execute('SELECT * FROM sms_deleted_refs');
  return result.rows.map(raw => {
    const row = raw as Record<string, unknown>;
    return {
      sourceReferenceHash: String(row.source_reference_hash),
      smsContentHash: nullableString(row.sms_content_hash),
      refKey: nullableString(row.ref_key),
    };
  });
}

async function listHashes(): Promise<Set<string>> {
  return new Set((await listAll()).map(row => row.sourceReferenceHash));
}

/**
 * R5d lazy backfill: a re-scan saw the SMS of a pre-R5d tombstone again —
 * store its content hash so the tombstone also holds on a new phone. One
 * db.transaction; no audit row; no other column changes.
 */
async function setContentHashes(
  rows: ReadonlyArray<{ sourceReferenceHash: string; smsContentHash: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await getDatabase().transaction(async tx => {
    for (const row of rows) {
      await tx.execute(
        'UPDATE sms_deleted_refs SET sms_content_hash = ? WHERE source_reference_hash = ?',
        [row.smsContentHash, row.sourceReferenceHash],
      );
    }
  });
}

export const smsDeletedRefsRepository = { listAll, listHashes, setContentHashes };
