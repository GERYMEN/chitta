import { getDatabase } from '../db/connection';
import { Transaction } from '../../domain/transactions/transaction.types';
import { rowToTransaction, transactionToRow } from '../mappers/transaction.mapper';
import { generateId } from '../../shared/utils/id';

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

async function create(input: CreateTransactionInput): Promise<Transaction> {
  const now = new Date().toISOString();
  const transaction: Transaction = {
    ...input,
    id: generateId('txn'),
    bulkBatchId: input.bulkBatchId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const row = transactionToRow(transaction);
  const placeholders = COLUMNS.map(() => '?').join(', ');

  await getDatabase().execute(
    `INSERT INTO transactions (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    valuesFor(row),
  );

  return transaction;
}

async function update(id: string, patch: TransactionPatch): Promise<Transaction> {
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

  await getDatabase().execute(
    `UPDATE transactions SET ${assignments} WHERE id = ?`,
    [...valuesFor(row), id],
  );

  return updated;
}

async function remove(id: string): Promise<void> {
  await getDatabase().execute('DELETE FROM transactions WHERE id = ?', [id]);
}

export const transactionRepository = {
  listAll,
  getById,
  create,
  update,
  delete: remove,
};
