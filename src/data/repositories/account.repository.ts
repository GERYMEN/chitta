import { getDatabase } from '../db/connection';
import { Account } from '../../domain/accounts/account.types';
import { rowToAccount, accountToRow } from '../mappers/account.mapper';
import { generateId } from '../../shared/utils/id';
import {
  accountKeyForAccount,
  accountKeyToString,
  AccountKey,
} from '../../features/sms-sync/normalizeAccountKey';

export type CreateAccountInput = Omit<
  Account,
  'id' | 'createdAt' | 'updatedAt' | 'balanceAnchorMinor' | 'balanceAnchorAt' | 'deletedAt'
> &
  Partial<Pick<Account, 'balanceAnchorMinor' | 'balanceAnchorAt' | 'deletedAt'>>;

export type AccountPatch = Partial<Omit<Account, 'id' | 'createdAt' | 'updatedAt'>>;

const COLUMNS = [
  'id',
  'name',
  'type',
  'last_four',
  'opening_balance_minor',
  'currency',
  'is_active',
  'balance_anchor_minor',
  'balance_anchor_at',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

function valuesFor(row: Record<string, string | number | null>): Array<string | number | null> {
  return COLUMNS.map(column => row[column] ?? null);
}

async function listAll(): Promise<Account[]> {
  const result = await getDatabase().execute('SELECT * FROM accounts ORDER BY created_at ASC');
  return result.rows.map(rowToAccount);
}

async function listActiveAccounts(): Promise<Account[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at ASC',
  );
  return result.rows.map(rowToAccount);
}

async function listAllAccounts(): Promise<Account[]> {
  const result = await getDatabase().execute('SELECT * FROM accounts ORDER BY created_at ASC');
  return result.rows.map(rowToAccount);
}

async function getById(id: string): Promise<Account | null> {
  const result = await getDatabase().execute('SELECT * FROM accounts WHERE id = ?', [id]);
  return result.rows.length > 0 ? rowToAccount(result.rows[0]) : null;
}

async function create(input: CreateAccountInput): Promise<Account> {
  const now = new Date().toISOString();
  const account: Account = {
    ...input,
    id: generateId('acc'),
    balanceAnchorMinor: input.balanceAnchorMinor ?? null,
    balanceAnchorAt: input.balanceAnchorAt ?? null,
    deletedAt: input.deletedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const row = accountToRow(account);
  const placeholders = COLUMNS.map(() => '?').join(', ');

  await getDatabase().execute(
    `INSERT INTO accounts (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    valuesFor(row),
  );

  return account;
}

async function update(id: string, patch: AccountPatch): Promise<Account> {
  const existing = await getById(id);
  if (!existing) {
    throw new Error(`Account not found: ${id}`);
  }

  const updated: Account = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const row = accountToRow(updated);
  const assignments = COLUMNS.map(column => `${column} = ?`).join(', ');

  await getDatabase().execute(
    `UPDATE accounts SET ${assignments} WHERE id = ?`,
    [...valuesFor(row), id],
  );

  return updated;
}

/**
 * D10 soft delete. In ONE transaction: stamp `deleted_at` and record a
 * 'deleted' suggestion decision for the account's normalized key so new SMS
 * for it are not imported or re-suggested. Transactions are never touched.
 */
async function softDelete(id: string): Promise<Account> {
  const existing = await getById(id);
  if (!existing) {
    throw new Error(`Account not found: ${id}`);
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const key = accountKeyForAccount(existing);

  await getDatabase().transaction(async tx => {
    await tx.execute('UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      nowMs,
      nowIso,
      id,
    ]);
    await tx.execute(
      `INSERT OR REPLACE INTO account_suggestion_decisions
        (bank_canonical, account_kind, last_four, decision, account_id, normalizer_version, decided_at)
        VALUES (?, ?, ?, 'deleted', ?, ?, ?)`,
      [key.bankCanonical, key.accountKind, key.lastFour, id, key.normalizerVersion, nowMs],
    );
  });

  return { ...existing, deletedAt: nowIso, updatedAt: nowIso };
}

/**
 * D10 restore. In ONE transaction: clear `deleted_at` and drop the account's
 * 'deleted' decision row(s). The next Sync SMS backfills the gap (dedup by
 * source_reference_hash). Transactions are never touched.
 */
async function restore(id: string): Promise<Account> {
  const existing = await getById(id);
  if (!existing) {
    throw new Error(`Account not found: ${id}`);
  }

  const nowIso = new Date().toISOString();

  await getDatabase().transaction(async tx => {
    await tx.execute('UPDATE accounts SET deleted_at = NULL, updated_at = ? WHERE id = ?', [
      nowIso,
      id,
    ]);
    await tx.execute(
      "DELETE FROM account_suggestion_decisions WHERE account_id = ? AND decision = 'deleted'",
      [id],
    );
  });

  return { ...existing, deletedAt: null, updatedAt: nowIso };
}

/** String keys (`accountKeyToString`) of every 'deleted' decision row. */
async function listDeletedDecisionKeys(): Promise<Set<string>> {
  const result = await getDatabase().execute(
    "SELECT bank_canonical, account_kind, last_four, normalizer_version FROM account_suggestion_decisions WHERE decision = 'deleted'",
  );
  return new Set(
    result.rows.map(row =>
      accountKeyToString({
        bankCanonical: String(row.bank_canonical),
        accountKind: String(row.account_kind) as AccountKey['accountKind'],
        lastFour: row.last_four == null ? '' : String(row.last_four),
        normalizerVersion: Number(row.normalizer_version),
      }),
    ),
  );
}

export const accountRepository = {
  listAll,
  listActiveAccounts,
  listAllAccounts,
  getById,
  create,
  update,
  softDelete,
  restore,
  listDeletedDecisionKeys,
};
