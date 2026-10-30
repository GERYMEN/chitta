import { getDatabase } from '../db/connection';
import { Account } from '../../domain/accounts/account.types';
import { rowToAccount, accountToRow } from '../mappers/account.mapper';
import { generateId } from '../../shared/utils/id';
import {
  accountKeyForAccount,
  accountKeyToString,
  AccountKey,
} from '../../features/sms-sync/normalizeAccountKey';
import { AuditEventDraft } from '../../domain/audit/audit.types';
import { auditRepository, SqlExecutor } from './audit.repository';

/** Write account audit drafts inside the caller's `tx` (same transaction). */
async function writeAudit(
  tx: SqlExecutor,
  accountId: string,
  audit: ReadonlyArray<AuditEventDraft>,
): Promise<void> {
  for (const draft of audit) {
    await auditRepository.insert(tx, { ...draft, transactionId: null, accountId });
  }
}

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

/** A new Account value with id/timestamps filled (not yet persisted). */
export function buildAccount(input: CreateAccountInput): Account {
  const now = new Date().toISOString();
  return {
    ...input,
    id: generateId('acc'),
    balanceAnchorMinor: input.balanceAnchorMinor ?? null,
    balanceAnchorAt: input.balanceAnchorAt ?? null,
    deletedAt: input.deletedAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** INSERT one account + its audit rows inside the caller's `tx`. */
export async function insertAccountTx(
  tx: SqlExecutor,
  account: Account,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<void> {
  const row = accountToRow(account);
  const placeholders = COLUMNS.map(() => '?').join(', ');
  await tx.execute(
    `INSERT INTO accounts (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
    valuesFor(row),
  );
  await writeAudit(tx, account.id, audit);
}

export type SuggestionDecision = 'added' | 'linked' | 'ignored' | 'deleted';

/**
 * Record an explicit "New Accounts Found" decision for a normalized key
 * inside the caller's `tx` (one row per key; a later decision replaces it).
 */
export async function writeDecisionTx(
  tx: SqlExecutor,
  key: AccountKey,
  decision: SuggestionDecision,
  accountId: string | null,
): Promise<void> {
  await tx.execute(
    `INSERT OR REPLACE INTO account_suggestion_decisions
      (bank_canonical, account_kind, last_four, decision, account_id, normalizer_version, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [key.bankCanonical, key.accountKind, key.lastFour, decision, accountId, key.normalizerVersion, Date.now()],
  );
}

async function create(
  input: CreateAccountInput,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<Account> {
  const account = buildAccount(input);
  await getDatabase().transaction(async tx => {
    await insertAccountTx(tx, account, audit);
  });
  return account;
}

async function update(
  id: string,
  patch: AccountPatch,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<Account> {
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

  await getDatabase().transaction(async tx => {
    await tx.execute(`UPDATE accounts SET ${assignments} WHERE id = ?`, [...valuesFor(row), id]);
    await writeAudit(tx, id, audit);
  });

  return updated;
}

/**
 * D10 soft delete. In ONE transaction: stamp `deleted_at` and record a
 * 'deleted' suggestion decision for the account's normalized key so new SMS
 * for it are not imported or re-suggested. Transactions are never touched.
 */
async function softDelete(
  id: string,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<Account> {
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
    await writeAudit(tx, id, audit);
  });

  return { ...existing, deletedAt: nowIso, updatedAt: nowIso };
}

/**
 * D10 restore. In ONE transaction: clear `deleted_at` and drop the account's
 * 'deleted' decision row(s). The next Sync SMS backfills the gap (dedup by
 * source_reference_hash). Transactions are never touched.
 */
async function restore(
  id: string,
  audit: ReadonlyArray<AuditEventDraft> = [],
): Promise<Account> {
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
    await writeAudit(tx, id, audit);
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

export interface SuggestionDecisionRow {
  /** `accountKeyToString` form. */
  key: string;
  decision: SuggestionDecision;
  accountId: string | null;
}

/** Every suggestion decision row (small table: one row per decided key). */
async function listSuggestionDecisions(): Promise<SuggestionDecisionRow[]> {
  const result = await getDatabase().execute('SELECT * FROM account_suggestion_decisions');
  return result.rows.map(row => ({
    key: accountKeyToString({
      bankCanonical: String(row.bank_canonical),
      accountKind: String(row.account_kind) as AccountKey['accountKind'],
      lastFour: row.last_four == null ? '' : String(row.last_four),
      normalizerVersion: Number(row.normalizer_version),
    }),
    decision: String(row.decision) as SuggestionDecision,
    accountId: row.account_id == null ? null : String(row.account_id),
  }));
}

/**
 * R2b "Ignore": record an 'ignored' decision so SMS for this key are never
 * imported or suggested again. No money changes, so no audit row.
 */
async function ignoreSuggestion(key: AccountKey): Promise<void> {
  await getDatabase().transaction(async tx => {
    await writeDecisionTx(tx, key, 'ignored', null);
  });
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
  listSuggestionDecisions,
  ignoreSuggestion,
};
