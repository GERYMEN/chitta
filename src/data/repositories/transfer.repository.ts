import { getDatabase } from '../db/connection';
import { Transaction } from '../../domain/transactions/transaction.types';
import { AuditMetadata } from '../../domain/audit/audit.types';
import { TransferDismissal, TransferPairPrevious } from '../../domain/transfers/transfer.rules';
import { asNumber, asString, SqlRow } from '../mappers/coerce';
import { parseAuditMetadata } from '../mappers/audit.mapper';
import { auditRepository } from './audit.repository';
import { updateTransactionTx } from './transaction.repository';

/**
 * R3a transfer pairing persistence. Each money change writes both rows and
 * its audit row in ONE `db.transaction` — all land or none do.
 */

async function listDismissals(): Promise<TransferDismissal[]> {
  const result = await getDatabase().execute('SELECT * FROM transfer_pair_dismissals');
  return result.rows.map((row: SqlRow) => ({
    debitId: asString(row.debit_id),
    creditId: asString(row.credit_id),
    dismissedAt: asString(row.dismissed_at),
  }));
}

/**
 * "Not a transfer". No money changes, so no audit row (the pair simply
 * stops being suggested). INSERT OR IGNORE keeps a repeat tap harmless.
 */
async function dismissPair(debitId: string, creditId: string): Promise<TransferDismissal> {
  const dismissal = { debitId, creditId, dismissedAt: new Date().toISOString() };
  await getDatabase().execute(
    'INSERT OR IGNORE INTO transfer_pair_dismissals (debit_id, credit_id, dismissed_at) VALUES (?, ?, ?)',
    [debitId, creditId, dismissal.dismissedAt],
  );
  return dismissal;
}

/**
 * "It's a transfer": write the converted debit + the rejected twin + one
 * 'transfer_paired' audit row (ids + previous enum/id fields only).
 */
async function confirmPair(
  debit: Transaction,
  credit: Transaction,
  previous: TransferPairPrevious,
): Promise<void> {
  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, debit);
    await updateTransactionTx(tx, credit);
    await auditRepository.insert(tx, {
      eventType: 'transfer_paired',
      actor: 'user',
      transactionId: debit.id,
      accountId: debit.accountId,
      metadata: { kind: 'transfer_paired', debit_id: debit.id, credit_id: credit.id, previous },
    });
  });
}

/** "Undo transfer": write both restored rows + one 'transfer_unpaired' audit row. */
async function undoPair(debit: Transaction, credit: Transaction): Promise<void> {
  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, debit);
    await updateTransactionTx(tx, credit);
    await auditRepository.insert(tx, {
      eventType: 'transfer_unpaired',
      actor: 'user',
      transactionId: debit.id,
      accountId: debit.accountId,
      metadata: { kind: 'transfer_unpaired', debit_id: debit.id, credit_id: credit.id },
    });
  });
}

/** The newest 'transfer_paired' payload recorded for this transfer (Undo source). */
async function latestPairing(
  debitId: string,
): Promise<Extract<AuditMetadata, { kind: 'transfer_paired' }> | null> {
  const result = await getDatabase().execute(
    'SELECT * FROM audit_events WHERE transaction_id = ?',
    [debitId],
  );
  const paired = result.rows
    .filter((row: SqlRow) => row.event_type === 'transfer_paired')
    .sort(
      (a: SqlRow, b: SqlRow) =>
        asString(b.event_at).localeCompare(asString(a.event_at)) ||
        asNumber(b.rowid ?? 0) - asNumber(a.rowid ?? 0),
    );
  for (const row of paired) {
    const metadata = parseAuditMetadata(row.metadata_json);
    if (metadata?.kind === 'transfer_paired' && metadata.debit_id === debitId) return metadata;
  }
  return null;
}

export const transferRepository = {
  listDismissals,
  dismissPair,
  confirmPair,
  undoPair,
  latestPairing,
};
