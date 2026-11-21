import { getDatabase } from '../db/connection';
import {
  ChainSuggestionKind,
  ChainSuggestionRecord,
  ChainSuggestionStatus,
  CHAIN_SUGGESTION_KINDS,
  CHAIN_SUGGESTION_STATUSES,
  sanitizeChainOverride,
} from '../../domain/chains/chainSuggestion.types';
import type { RuleChainOverride } from '../../features/sms-sync/rules/rules.types';
import { asNullableString, asString } from '../mappers/coerce';
import { auditRepository, SqlExecutor } from './audit.repository';
import type { AuditEventInput } from '../../domain/audit/audit.types';

/**
 * R5i (G3): persistence for chain suggestions (migration 12). IDS + ENUMS
 * ONLY — the only free-form column is `parent_override`, a JSON of the
 * RuleChainOverride ENUM/BOOLEAN fields (deleted / link / incomplete),
 * sanitised before it is written. No SMS body, no sender number.
 *
 * One OPEN row per child: writing an open suggestion for a child first drops
 * the child's existing open row. Status transitions keep the row (so Activity
 * / history survives) and only move `status`.
 */

const KIND_SET: ReadonlySet<string> = new Set(CHAIN_SUGGESTION_KINDS);
const STATUS_SET: ReadonlySet<string> = new Set(CHAIN_SUGGESTION_STATUSES);

function kindOf(value: unknown): ChainSuggestionKind {
  const s = asString(value);
  return KIND_SET.has(s) ? (s as ChainSuggestionKind) : 'incomplete';
}

function statusOf(value: unknown): ChainSuggestionStatus {
  const s = asString(value);
  return STATUS_SET.has(s) ? (s as ChainSuggestionStatus) : 'open';
}

function overrideOf(value: unknown): RuleChainOverride | null {
  const s = asNullableString(value);
  if (!s) return null;
  try {
    return sanitizeChainOverride(JSON.parse(s) as RuleChainOverride);
  } catch {
    return null;
  }
}

function rowToRecord(raw: Record<string, unknown>): ChainSuggestionRecord {
  return {
    id: asString(raw.id),
    kind: kindOf(raw.kind),
    childId: asString(raw.child_id),
    parentId: asNullableString(raw.parent_id),
    parentOverride: overrideOf(raw.parent_override),
    status: statusOf(raw.status),
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at),
  };
}

const INSERT =
  `INSERT INTO chain_suggestions
    (id, kind, child_id, parent_id, parent_override, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function insertParams(record: ChainSuggestionRecord): Array<string | null> {
  const clean = sanitizeChainOverride(record.parentOverride);
  return [
    record.id,
    record.kind,
    record.childId,
    record.parentId,
    clean ? JSON.stringify(clean) : null,
    record.status,
    record.createdAt,
    record.updatedAt,
  ];
}

async function listAll(): Promise<ChainSuggestionRecord[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM chain_suggestions ORDER BY created_at ASC',
  );
  return result.rows.map(r => rowToRecord(r as Record<string, unknown>));
}

/** The open suggestions (what Review and the de-dupe read). */
async function listOpen(): Promise<ChainSuggestionRecord[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM chain_suggestions WHERE status = ?',
    ['open'],
  );
  return result.rows
    .map(r => rowToRecord(r as Record<string, unknown>))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function listByChild(childId: string): Promise<ChainSuggestionRecord[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM chain_suggestions WHERE child_id = ?',
    [childId],
  );
  return result.rows.map(r => rowToRecord(r as Record<string, unknown>));
}

/**
 * Persist new OPEN suggestions. One row per child — a newer suggestion
 * REPLACES the open one (the old open row for that child is deleted first).
 */
async function replaceOpen(records: ReadonlyArray<ChainSuggestionRecord>): Promise<void> {
  if (records.length === 0) return;
  await getDatabase().transaction(async tx => {
    for (const record of records) {
      await tx.execute(
        "DELETE FROM chain_suggestions WHERE child_id = ? AND status = 'open'",
        [record.childId],
      );
      await tx.execute(INSERT, insertParams({ ...record, status: 'open' }));
      // D-i: ids + enum kind only; the audit row's transaction is the child.
      await auditRepository.insert(tx, {
        eventType: 'chain_suggested',
        actor: 'system',
        transactionId: record.childId,
        metadata: {
          kind: 'chain_suggested',
          childId: record.childId,
          parentId: record.parentId,
          chainKind: record.kind,
        },
      });
    }
  });
}

/** D-i: the user-facing status changes (accepted / dismissed) write an audit row. */
function auditFor(record: ChainSuggestionRecord, status: ChainSuggestionStatus): AuditEventInput | null {
  if (status === 'accepted') {
    return {
      eventType: 'chain_accepted',
      actor: 'user',
      transactionId: record.childId,
      metadata: { kind: 'chain_accepted', childId: record.childId, parentId: record.parentId, chainKind: record.kind },
    };
  }
  if (status === 'dismissed') {
    return {
      eventType: 'chain_dismissed',
      actor: 'user',
      transactionId: record.childId,
      metadata: { kind: 'chain_dismissed', childId: record.childId, chainKind: record.kind },
    };
  }
  return null;
}

/** Move the OPEN row of `childId` to `status`; returns the updated row or null. */
async function setStatusByChild(
  childId: string,
  status: ChainSuggestionStatus,
  nowIso: string,
): Promise<ChainSuggestionRecord | null> {
  const open = (await listByChild(childId)).find(r => r.status === 'open');
  if (!open) return null;
  const audit = auditFor(open, status);
  const write = async (executor: SqlExecutor) => {
    await executor.execute(
      'UPDATE chain_suggestions SET status = ?, updated_at = ? WHERE id = ?',
      [status, nowIso, open.id],
    );
    if (audit) await auditRepository.insert(executor, audit);
  };
  if (audit) await getDatabase().transaction(write);
  else await write(getDatabase());
  return { ...open, status, updatedAt: nowIso };
}

/** Move one row (by id) to `status` — used by Dismiss / its Undo. */
async function setStatusById(
  id: string,
  status: ChainSuggestionStatus,
  nowIso: string,
): Promise<void> {
  await getDatabase().execute(
    'UPDATE chain_suggestions SET status = ?, updated_at = ? WHERE id = ?',
    [status, nowIso, id],
  );
}

export const chainSuggestionRepository = {
  listAll,
  listOpen,
  listByChild,
  replaceOpen,
  setStatusByChild,
  setStatusById,
};
