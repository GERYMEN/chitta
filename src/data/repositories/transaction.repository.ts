import { getDatabase } from '../db/connection';
import { Transaction } from '../../domain/transactions/transaction.types';
import { rowToTransaction, transactionToRow } from '../mappers/transaction.mapper';
import { generateId } from '../../shared/utils/id';
import { AuditEventDraft } from '../../domain/audit/audit.types';
import { auditRepository, SqlExecutor } from './audit.repository';

export type CreateTransactionInput = Omit<
  Transaction,
  'id' | 'createdAt' | 'updatedAt' | 'bulkBatchId'
> &
  Partial<Pick<Transaction, 'bulkBatchId'>>;

export type TransactionPatch = Partial<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>;

const COLUMNS = [
  'id',
  'type',
  'status',
  'amount_minor',
  'currency',
  'merchant_name',
  'category_id',
  'account_id',
  'payment_method',
  'occurred_at',
  'detected_at',
  'approved_at',
  'note',
  'source_type',
  'source_reference_hash',
  'sanitized_preview',
  'confidence_score',
  'parser_version',
  'bulk_batch_id',
  'created_at',
  'updated_at',
] as const;

function valuesFor(row: Record<string, string | number | null>): Array<string | number | null> {
  return COLUMNS.map(column => row[column] ?? null);
}

async function listAll(): Promise<Transaction[]> {
  const result = await getDatabase().execute('SELECT * FROM transactions ORDER BY occurred_at DESC');
  return result.rows.map(rowToTransaction);
}

async function getById(id: string): Promise<Transaction | null> {
  const result = await getDatabase().execute('SELECT * FROM transactions WHERE id = ?', [id]);
  return result.rows.length > 0 ? rowToTransaction(result.rows[0]) : null;
}

/** Write the audit drafts for one transaction inside the caller's `tx`. */
async function writeAudit(
  tx: SqlExecutor,
  transaction: Pick<Transaction, 'id' | 'accountId'>,
  audit: ReadonlyArray<AuditEventDraft>,
): Promise<void> {
  for (const draft of audit) {
    await auditRepository.insert(tx, {
      ...draft,
      transactionId: transaction.id,
      accountId: transaction.accountId,
    });
  }
}

/**
 * Every mutation takes the audit drafts describing it and writes the change
 * and its audit rows in ONE `db.transaction` — both land or neither does.
 */
/** A new Transaction value with id/timestamps filled (not yet persisted). */
export function buildTransaction(input: CreateTransactionInput): Transaction {
  const now = new Date().toISOString();
  return {
    ...input,
    id: generateId('txn'),
    bulkBatchId: input.bulkBatchId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** INSERT one transaction + its audit rows inside the caller's `tx`. */
export async function insertTransactionTx(
  tx: SqlExecutor,
  transaction: Transaction,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<void> {
  const row = transactionToRow(transaction);
  const placeholders = COLUMNS.map(() => '?').join(', ');
  await tx.execute(
    `INSERT INTO transactions (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    valuesFor(row),
  );
  await writeAudit(tx, transaction, audit);
}

async function create(
  input: CreateTransactionInput,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<Transaction> {
  const transaction = buildTransaction(input);
  await getDatabase().transaction(async tx => {
    await insertTransactionTx(tx, transaction, audit);
  });
  return transaction;
}

async function update(
  id: string,
  patch: TransactionPatch,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<Transaction> {
  const existing = await getById(id);
  if (!existing) {
    throw new Error(`Transaction not found: ${id}`);
  }

  const updated: Transaction = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const row = transactionToRow(updated);
  const assignments = COLUMNS.map(column => `${column} = ?`).join(', ');

  await getDatabase().transaction(async tx => {
    await tx.execute(`UPDATE transactions SET ${assignments} WHERE id = ?`, [
      ...valuesFor(row),
      id,
    ]);
    await writeAudit(tx, updated, audit);
  });

  return updated;
}

/**
 * Hard delete. The audit rows (incl. the `deleted` snapshot) keep the id so
 * the feed can still show the history; foreign keys are not enforced.
 */
async function remove(
  id: string,
  audit: ReadonlyArray<AuditEventDraft> = [],
  accountId: string | null = null,
): Promise<void> {
  await getDatabase().transaction(async tx => {
    await tx.execute('DELETE FROM transactions WHERE id = ?', [id]);
    for (const draft of audit) {
      await auditRepository.insert(tx, { ...draft, transactionId: id, accountId });
    }
  });
}

/**
 * R2 "Apply to N other items" (and its Undo): set each item's category in
 * ONE `db.transaction`, one `edited` audit row (fields ['categoryId']) per
 * item. All land or none do.
 */
async function setCategories(
  changes: ReadonlyArray<{ id: string; accountId: string; categoryId: string }>,
): Promise<string> {
  const now = new Date().toISOString();
  if (changes.length === 0) return now;
  await getDatabase().transaction(async tx => {
    for (const change of changes) {
      await tx.execute('UPDATE transactions SET category_id = ?, updated_at = ? WHERE id = ?', [
        change.categoryId,
        now,
        change.id,
      ]);
      await auditRepository.insert(tx, {
        eventType: 'edited',
        actor: 'user',
        metadata: { kind: 'edited', fields: ['categoryId'] },
        transactionId: change.id,
        accountId: change.accountId,
      });
    }
  });
  return now;
}

export const transactionRepository = {
  listAll,
  getById,
  create,
  update,
  delete: remove,
  setCategories,
};
