import { getDatabase } from '../db/connection';
import { IouShare, Person } from '../../domain/iou/iou.types';
import { Transaction } from '../../domain/transactions/transaction.types';
import { asNullableString, asNumber, asString, SqlRow } from '../mappers/coerce';
import { auditRepository, SqlExecutor } from './audit.repository';
import { insertPersonTx } from './people.repository';
import { updateTransactionTx } from './transaction.repository';

/**
 * R10 IOU shares persistence (migration 15). Every change writes its row(s) and
 * its audit row(s) in ONE `db.transaction` (all land or none do). Linking a
 * credit as the repayment also writes the credit's link fields through the SAME
 * transaction.repository helper the R3 links use (no forked linking).
 * Audit metadata: ids / enums / amounts only — never a name or note.
 */

export function rowToShare(row: SqlRow): IouShare {
  return {
    id: asString(row.id),
    personId: asString(row.person_id),
    direction: asString(row.direction) === 'borrowed' ? 'borrowed' : 'lent',
    sourceTransactionId: asNullableString(row.source_transaction_id),
    amountMinor: asNumber(row.amount_minor),
    note: asNullableString(row.note),
    createdAt: asString(row.created_at),
    settledAt: asNullableString(row.settled_at),
    repaymentTransactionId: asNullableString(row.repayment_transaction_id),
  };
}

const INSERT =
  `INSERT INTO iou_shares (id, person_id, direction, source_transaction_id, amount_minor, note,
     created_at, settled_at, repayment_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function insertShareTx(tx: SqlExecutor, share: IouShare): Promise<void> {
  await tx.execute(INSERT, [
    share.id,
    share.personId,
    share.direction,
    share.sourceTransactionId,
    share.amountMinor,
    share.note,
    share.createdAt,
    share.settledAt,
    share.repaymentTransactionId,
  ]);
  await auditRepository.insert(tx, {
    eventType: 'iou_share_added',
    actor: 'user',
    metadata: {
      kind: 'iou_share_added',
      shareId: share.id,
      personId: share.personId,
      direction: share.direction,
      amountMinor: share.amountMinor,
      sourceTransactionId: share.sourceTransactionId,
    },
  });
}

async function listAll(): Promise<IouShare[]> {
  const result = await getDatabase().execute('SELECT * FROM iou_shares ORDER BY created_at ASC, id ASC');
  return result.rows.map(r => rowToShare(r as SqlRow));
}

/**
 * Save new people (if any) + shares in one transaction. Used by Split (lent,
 * source = the expense) and the manual entry (borrowed / lent, no source).
 */
async function addShares(input: {
  newPeople: ReadonlyArray<Person>;
  shares: ReadonlyArray<IouShare>;
  /** Undo of a delete: re-link the credit that repaid the restored share. */
  credit?: Transaction | null;
}): Promise<void> {
  await getDatabase().transaction(async tx => {
    for (const person of input.newPeople) await insertPersonTx(tx, person);
    for (const share of input.shares) await insertShareTx(tx, share);
    if (input.credit) await updateTransactionTx(tx, input.credit);
  });
}

type RepaymentKind = 'iou_repayment_recorded' | 'iou_repayment_undone';

async function repaymentAudit(
  tx: SqlExecutor,
  kind: RepaymentKind,
  share: IouShare,
  transactionId: string | null,
): Promise<void> {
  await auditRepository.insert(tx, {
    eventType: kind,
    actor: 'user',
    metadata: {
      kind,
      shareId: share.id,
      personId: share.personId,
      direction: share.direction,
      amountMinor: share.amountMinor,
      transactionId,
    },
  });
}

/**
 * Settle in full. `credit` (already patched by linkRepaymentPatch) is persisted
 * in the same transaction when a transaction is linked as the repayment.
 */
async function settle(
  share: IouShare,
  settledAt: string,
  repaymentTransactionId: string | null,
  linked: Transaction | null,
): Promise<IouShare> {
  const settled: IouShare = { ...share, settledAt, repaymentTransactionId };
  await getDatabase().transaction(async tx => {
    await tx.execute('UPDATE iou_shares SET settled_at = ?, repayment_transaction_id = ? WHERE id = ?', [
      settled.settledAt,
      settled.repaymentTransactionId,
      share.id,
    ]);
    if (linked) await updateTransactionTx(tx, linked);
    await repaymentAudit(tx, 'iou_repayment_recorded', settled, settled.repaymentTransactionId);
  });
  return settled;
}

/** Exact Undo of `settle`: reopen the share and (if any) restore the credit row. */
async function undoSettle(prior: IouShare, restoredCredit: Transaction | null): Promise<void> {
  await getDatabase().transaction(async tx => {
    await tx.execute('UPDATE iou_shares SET settled_at = ?, repayment_transaction_id = ? WHERE id = ?', [
      prior.settledAt,
      prior.repaymentTransactionId,
      prior.id,
    ]);
    if (restoredCredit) await updateTransactionTx(tx, restoredCredit);
    await repaymentAudit(tx, 'iou_repayment_undone', prior, restoredCredit ? restoredCredit.id : null);
  });
}

/**
 * Delete a share (+ 'iou_share_deleted'). A credit that repaid it is unlinked in
 * the same transaction (it counts as income again). Undo re-adds via `addShares`.
 */
async function remove(share: IouShare, unlinkedCredit: Transaction | null = null): Promise<void> {
  await getDatabase().transaction(async tx => {
    await tx.execute('DELETE FROM iou_shares WHERE id = ?', [share.id]);
    if (unlinkedCredit) await updateTransactionTx(tx, unlinkedCredit);
    await auditRepository.insert(tx, {
      eventType: 'iou_share_deleted',
      actor: 'user',
      metadata: {
        kind: 'iou_share_deleted',
        shareId: share.id,
        personId: share.personId,
        direction: share.direction,
        amountMinor: share.amountMinor,
      },
    });
  });
}

export const iouShareRepository = { listAll, addShares, settle, undoSettle, remove };
