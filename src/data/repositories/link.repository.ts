import { getDatabase } from '../db/connection';
import { Transaction } from '../../domain/transactions/transaction.types';
import { AuditMetadata } from '../../domain/audit/audit.types';
import {
  DuplicateDismissal,
  DuplicateRowSnapshot,
  orderedPairIds,
} from '../../domain/duplicates/duplicate.rules';
import { asNumber, asString, SqlRow } from '../mappers/coerce';
import { parseAuditMetadata } from '../mappers/audit.mapper';
import { auditRepository } from './audit.repository';
import { updateTransactionTx } from './transaction.repository';

/**
 * R3b refund + duplicate link persistence. Every money change writes its row
 * and its ONE audit row in a single `db.transaction` — all land or none do.
 * Audit metadata carries ids and enum/id/timestamp fields only.
 */

type Metadata<K extends AuditMetadata['kind']> = Extract<AuditMetadata, { kind: K }>;

/** Newest audit payload of `kind` for this transaction that matches `accept`. */
async function latestMetadata<K extends AuditMetadata['kind']>(
  transactionId: string,
  kind: K,
  accept: (metadata: Metadata<K>) => boolean,
): Promise<Metadata<K> | null> {
  const result = await getDatabase().execute(
    'SELECT * FROM audit_events WHERE transaction_id = ?',
    [transactionId],
  );
  const rows = result.rows
    .filter((row: SqlRow) => row.event_type === kind)
    .sort(
      (a: SqlRow, b: SqlRow) =>
        asString(b.event_at).localeCompare(asString(a.event_at)) ||
        asNumber(b.rowid ?? 0) - asNumber(a.rowid ?? 0),
    );
  for (const row of rows) {
    const metadata = parseAuditMetadata(row.metadata_json);
    if (metadata?.kind === kind && accept(metadata as Metadata<K>)) return metadata as Metadata<K>;
  }
  return null;
}

/** "Link to original expense": the linked refund row + 'refund_linked'. */
async function linkRefund(
  refund: Transaction,
  expenseId: string,
  previousCategoryId: string | null,
): Promise<void> {
  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, refund);
    await auditRepository.insert(tx, {
      eventType: 'refund_linked',
      actor: 'user',
      transactionId: refund.id,
      accountId: refund.accountId,
      metadata: {
        kind: 'refund_linked',
        refund_id: refund.id,
        expense_id: expenseId,
        previous_category_id: previousCategoryId,
        category_id: refund.categoryId,
      },
    });
  });
}

/** "Unlink refund": the unlinked refund row + 'refund_unlinked'. */
async function unlinkRefund(refund: Transaction, expenseId: string): Promise<void> {
  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, refund);
    await auditRepository.insert(tx, {
      eventType: 'refund_unlinked',
      actor: 'user',
      transactionId: refund.id,
      accountId: refund.accountId,
      metadata: { kind: 'refund_unlinked', refund_id: refund.id, expense_id: expenseId },
    });
  });
}

/** The newest 'refund_linked' payload for this refund + expense (Unlink source). */
function latestRefundLink(refundId: string, expenseId: string) {
  return latestMetadata(refundId, 'refund_linked', m => m.expense_id === expenseId);
}

async function listDuplicateDismissals(): Promise<DuplicateDismissal[]> {
  const result = await getDatabase().execute('SELECT * FROM duplicate_pair_dismissals');
  return result.rows.map((row: SqlRow) => ({
    aId: asString(row.a_id),
    bId: asString(row.b_id),
    dismissedAt: asString(row.dismissed_at),
  }));
}

/**
 * "Not duplicates". No money changes, so no audit row (R3a precedent).
 * Ids are ordered (a_id < b_id); INSERT OR IGNORE keeps a repeat tap harmless.
 */
async function dismissDuplicatePair(x: string, y: string): Promise<DuplicateDismissal> {
  const [aId, bId] = orderedPairIds(x, y);
  const dismissal = { aId, bId, dismissedAt: new Date().toISOString() };
  await getDatabase().execute(
    'INSERT OR IGNORE INTO duplicate_pair_dismissals (a_id, b_id, dismissed_at) VALUES (?, ?, ?)',
    [aId, bId, dismissal.dismissedAt],
  );
  return dismissal;
}

/** Mark duplicate: the hidden row + 'duplicate_marked' (with its previous fields). */
async function markDuplicate(
  duplicate: Transaction,
  keptId: string,
  previous: DuplicateRowSnapshot,
): Promise<void> {
  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, duplicate);
    await auditRepository.insert(tx, {
      eventType: 'duplicate_marked',
      actor: 'user',
      transactionId: duplicate.id,
      accountId: duplicate.accountId,
      metadata: { kind: 'duplicate_marked', kept_id: keptId, duplicate_id: duplicate.id, previous },
    });
  });
}

/** "Not a duplicate": the restored row + 'duplicate_restored'. */
async function restoreDuplicate(restored: Transaction, keptId: string): Promise<void> {
  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, restored);
    await auditRepository.insert(tx, {
      eventType: 'duplicate_restored',
      actor: 'user',
      transactionId: restored.id,
      accountId: restored.accountId,
      metadata: { kind: 'duplicate_restored', kept_id: keptId, duplicate_id: restored.id },
    });
  });
}

/** The newest 'duplicate_marked' payload for this hidden row + kept row (restore source). */
function latestDuplicateMark(duplicateId: string, keptId: string) {
  return latestMetadata(
    duplicateId,
    'duplicate_marked',
    m => m.duplicate_id === duplicateId && m.kept_id === keptId,
  );
}

export const linkRepository = {
  linkRefund,
  unlinkRefund,
  latestRefundLink,
  listDuplicateDismissals,
  dismissDuplicatePair,
  markDuplicate,
  restoreDuplicate,
  latestDuplicateMark,
};
