import type { Scalar, QueryResult } from '@op-engineering/op-sqlite';
import { getDatabase } from '../db/connection';
import {
  AuditCursor,
  AuditEvent,
  AuditEventInput,
  AuditFeedEvent,
} from '../../domain/audit/audit.types';
import { sanitizeAuditMetadata } from '../../domain/audit/audit.rules';
import { rowToAuditFeedEvent, serializeAuditMetadata } from '../mappers/audit.mapper';
import { generateId } from '../../shared/utils/id';

/**
 * Anything that can run a parameterized statement: the DB itself or the `tx`
 * handed to a `db.transaction` callback. Passing the `tx` keeps the audit row
 * in the SAME transaction as the money change it describes.
 */
export interface SqlExecutor {
  execute: (query: string, params?: Scalar[]) => Promise<QueryResult>;
}

const INSERT_SQL =
  'INSERT INTO audit_events (id, transaction_id, account_id, event_type, event_at, actor, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)';

async function insert(
  executor: SqlExecutor,
  input: AuditEventInput,
): Promise<Omit<AuditEvent, 'seq'>> {
  const metadata = sanitizeAuditMetadata(input.metadata);
  const event: Omit<AuditEvent, 'seq'> = {
    id: generateId('aud'),
    transactionId: input.transactionId ?? null,
    accountId: input.accountId ?? null,
    eventType: input.eventType,
    eventAt: input.eventAt ?? new Date().toISOString(),
    actor: input.actor,
    metadata,
  };

  await executor.execute(INSERT_SQL, [
    event.id,
    event.transactionId,
    event.accountId,
    event.eventType,
    event.eventAt,
    event.actor,
    serializeAuditMetadata(metadata),
  ]);

  return event;
}

const FEED_COLUMNS = `a.rowid AS seq, a.id, a.transaction_id, a.account_id, a.event_type,
  a.event_at, a.actor, a.metadata_json,
  (SELECT d.metadata_json FROM audit_events d
     WHERE d.transaction_id = a.transaction_id AND d.event_type = 'deleted'
     LIMIT 1) AS deleted_metadata_json`;

/**
 * Newest first. `before` is a keyset cursor (eventAt, seq): rows strictly
 * older than it, so events sharing a timestamp are never skipped or repeated.
 */
async function listRecent(limit: number, before?: AuditCursor | null): Promise<AuditFeedEvent[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = before
    ? await getDatabase().execute(
        `SELECT ${FEED_COLUMNS} FROM audit_events a
         WHERE (a.event_at < ? OR (a.event_at = ? AND a.rowid < ?))
         ORDER BY a.event_at DESC, a.rowid DESC LIMIT ?`,
        [before.eventAt, before.eventAt, before.seq, safeLimit],
      )
    : await getDatabase().execute(
        `SELECT ${FEED_COLUMNS} FROM audit_events a
         ORDER BY a.event_at DESC, a.rowid DESC LIMIT ?`,
        [safeLimit],
      );
  return result.rows.map(rowToAuditFeedEvent);
}

export const auditRepository = {
  insert,
  listRecent,
};
