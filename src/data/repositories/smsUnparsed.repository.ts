import { getDatabase } from '../db/connection';
import type { NotUnderstoodReason } from '../../features/sms-sync/parser/readSms';

/**
 * R5 "Messages not understood" (table sms_unparsed, migration 8).
 *
 * Privacy: rows hold the SMS content-provider id + date, a reason code and a
 * public institution id — never the body, never the sender number. The body
 * is read live by id when the user taps a row, into component state only.
 */
export interface SmsUnparsedRow {
  smsId: string;
  smsDate: number;
  reasonCode: NotUnderstoodReason;
  institution: string;
  parserVersion: number;
  detectedAt: string;
  dismissedAt: string | null;
  resolvedAt: string | null;
}

export interface SmsUnparsedInput {
  smsId: string;
  smsDate: number;
  reasonCode: NotUnderstoodReason;
  institution: string;
  parserVersion: number;
}

const REASONS: ReadonlySet<string> = new Set(['no_amount', 'no_direction', 'unknown_format']);

function toRow(row: Record<string, unknown>): SmsUnparsedRow {
  const reason = String(row.reason_code);
  return {
    smsId: String(row.sms_id),
    smsDate: Number(row.sms_date),
    reasonCode: (REASONS.has(reason) ? reason : 'unknown_format') as NotUnderstoodReason,
    institution: String(row.institution ?? 'unknown'),
    parserVersion: Number(row.parser_version ?? 0),
    detectedAt: String(row.detected_at),
    dismissedAt: row.dismissed_at == null ? null : String(row.dismissed_at),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
  };
}

/** Key used in memory to match a row to an SMS (same parts as the txn hash). */
export function unparsedKey(smsId: string, smsDate: number): string {
  return `${smsId}:${smsDate}`;
}

/**
 * Insert new rows in ONE transaction. INSERT OR IGNORE: a row the user
 * already dismissed (or resolved) stays as it is when a later sync sees the
 * same SMS again. Returns the number of rows actually inserted.
 */
async function recordMany(rows: ReadonlyArray<SmsUnparsedInput>, now: Date = new Date()): Promise<number> {
  if (rows.length === 0) return 0;
  const detectedAt = now.toISOString();
  let inserted = 0;
  await getDatabase().transaction(async tx => {
    for (const row of rows) {
      const result = await tx.execute(
        'INSERT OR IGNORE INTO sms_unparsed (sms_id, sms_date, reason_code, institution, parser_version, detected_at) VALUES (?, ?, ?, ?, ?, ?)',
        [row.smsId, row.smsDate, row.reasonCode, row.institution, row.parserVersion, detectedAt],
      );
      // R5-fix C8: count only rows really inserted (a dismissed / resolved
      // row is ignored and must not count as newly not understood).
      inserted += Number((result as { rowsAffected?: number } | undefined)?.rowsAffected ?? 0);
    }
  });
  return inserted;
}

/** Rows not dismissed and not resolved, newest SMS first. */
async function listOpen(): Promise<SmsUnparsedRow[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM sms_unparsed WHERE dismissed_at IS NULL AND resolved_at IS NULL ORDER BY sms_date DESC',
  );
  return result.rows.map(row => toRow(row as Record<string, unknown>));
}

/** Keys of open rows (sync uses them to resolve rows a newer reader understands). */
async function openKeys(): Promise<Set<string>> {
  const rows = await listOpen();
  return new Set(rows.map(row => unparsedKey(row.smsId, row.smsDate)));
}

async function setColumn(
  column: 'dismissed_at' | 'resolved_at',
  keys: ReadonlyArray<{ smsId: string; smsDate: number }>,
  now: Date,
): Promise<void> {
  if (keys.length === 0) return;
  const at = now.toISOString();
  await getDatabase().transaction(async tx => {
    for (const key of keys) {
      await tx.execute(
        `UPDATE sms_unparsed SET ${column} = ? WHERE sms_id = ? AND sms_date = ? AND ${column} IS NULL`,
        [at, key.smsId, key.smsDate],
      );
    }
  });
}

/** "Not a transaction". */
async function dismiss(smsId: string, smsDate: number, now: Date = new Date()): Promise<void> {
  await setColumn('dismissed_at', [{ smsId, smsDate }], now);
}

/** Added by the user, or understood by a newer reader. */
async function resolveMany(
  keys: ReadonlyArray<{ smsId: string; smsDate: number }>,
  now: Date = new Date(),
): Promise<void> {
  await setColumn('resolved_at', keys, now);
}

export const smsUnparsedRepository = {
  recordMany,
  listOpen,
  openKeys,
  dismiss,
  resolveMany,
};
