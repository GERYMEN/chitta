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
  'transfer_account_id',
  'linked_transaction_id',
  'link_kind',
  'sms_content_hash',
  'ref_digest',
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
    transferAccountId: input.transferAccountId ?? null,
    linkedTransactionId: input.linkedTransactionId ?? null,
    linkKind: input.linkKind ?? null,
    smsContentHash: input.smsContentHash ?? null,
    refDigest: input.refDigest ?? null,
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

  await getDatabase().transaction(async tx => {
    await updateTransactionTx(tx, updated);
    await writeAudit(tx, updated, audit);
  });

  return updated;
}

/** Overwrite every column of one existing row inside the caller's `tx`. */
export async function updateTransactionTx(tx: SqlExecutor, transaction: Transaction): Promise<void> {
  const row = transactionToRow(transaction);
  const assignments = COLUMNS.map(column => `${column} = ?`).join(', ');
  await tx.execute(`UPDATE transactions SET ${assignments} WHERE id = ?`, [
    ...valuesFor(row),
    transaction.id,
  ]);
}

/**
 * Hard delete. The audit rows (incl. the `deleted` snapshot) keep the id so
 * the feed can still show the history; foreign keys are not enforced.
 */
/**
 * R5-fix C4 / R5d: what a deleted SMS item leaves behind — one-way keys only:
 * the `sms-<id>-<date>` hash, the salted content hash (R5d T1) and the salted
 * reference key bound to type + amount (R5d T2). Never SMS content.
 */
export interface SmsTombstoneInput {
  sourceReferenceHash: string;
  smsContentHash: string | null;
  refKey: string | null;
}

async function remove(
  id: string,
  audit: ReadonlyArray<AuditEventDraft> = [],
  accountId: string | null = null,
  smsTombstone: SmsTombstoneInput | null = null,
): Promise<void> {
  await getDatabase().transaction(async tx => {
    await tx.execute('DELETE FROM transactions WHERE id = ?', [id]);
    // R5-fix C4: a deleted SMS item leaves its reference hash (no content) so
    // a re-scan / the 1-day overlap never recreates it.
    if (smsTombstone) {
      await tx.execute(
        'INSERT OR IGNORE INTO sms_deleted_refs (source_reference_hash, deleted_at, sms_content_hash, ref_key) VALUES (?, ?, ?, ?)',
        [
          smsTombstone.sourceReferenceHash,
          new Date().toISOString(),
          smsTombstone.smsContentHash,
          smsTombstone.refKey,
        ],
      );
    }
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
  changes: ReadonlyArray<{
    id: string;
    accountId: string;
    categoryId: string;
    /** B4: the row's type at event time (recorded in the audit metadata). */
    transactionType?: Transaction['type'];
  }>,
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
        metadata: {
          kind: 'edited',
          fields: ['categoryId'],
          ...(change.transactionType ? { transactionType: change.transactionType } : {}),
        },
        transactionId: change.id,
        accountId: change.accountId,
      });
    }
  });
  return now;
}

/**
 * R5d lazy backfill: store the content hash on rows recorded before R5d (or
 * on another phone) when a sync sees the same SMS again by its old key. ONE
 * db.transaction; only sms_content_hash changes (no updated_at, no audit).
 */
async function setContentHashes(
  rows: ReadonlyArray<{ id: string; smsContentHash: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await getDatabase().transaction(async tx => {
    for (const row of rows) {
      await tx.execute('UPDATE transactions SET sms_content_hash = ? WHERE id = ?', [
        row.smsContentHash,
        row.id,
      ]);
    }
  });
}

export const transactionRepository = {
  listAll,
  getById,
  create,
  update,
  delete: remove,
  setCategories,
  setContentHashes,
};
