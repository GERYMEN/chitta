import {
  AuditActor,
  AuditEvent,
  AuditEventType,
  AuditFeedEvent,
  AuditMetadata,
} from '../../domain/audit/audit.types';
import { asNullableString, asNumber, asString, SqlRow } from './coerce';

/** Parse `metadata_json` defensively — a malformed row must never crash the feed. */
export function parseAuditMetadata(raw: unknown): AuditMetadata | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && typeof parsed.kind === 'string'
      ? (parsed as AuditMetadata)
      : null;
  } catch {
    return null;
  }
}

export function serializeAuditMetadata(metadata: AuditMetadata | null | undefined): string | null {
  return metadata ? JSON.stringify(metadata) : null;
}

export function rowToAuditEvent(row: SqlRow): AuditEvent {
  return {
    id: asString(row.id),
    seq: asNumber(row.seq),
    transactionId: asNullableString(row.transaction_id),
    accountId: asNullableString(row.account_id),
    eventType: asString(row.event_type) as AuditEventType,
    eventAt: asString(row.event_at),
    actor: asString(row.actor) as AuditActor,
    metadata: parseAuditMetadata(row.metadata_json),
  };
}

export function rowToAuditFeedEvent(row: SqlRow): AuditFeedEvent {
  const snapshot = parseAuditMetadata(row.deleted_metadata_json);
  return {
    ...rowToAuditEvent(row),
    deletedSnapshot: snapshot && snapshot.kind === 'deleted' ? snapshot : null,
  };
}
