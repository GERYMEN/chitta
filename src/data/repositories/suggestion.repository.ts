import { getDatabase } from '../db/connection';
import { Account } from '../../domain/accounts/account.types';
import { Transaction } from '../../domain/transactions/transaction.types';
import { AccountKey } from '../../features/sms-sync/normalizeAccountKey';
import { auditRepository } from './audit.repository';
import {
  buildAccount,
  CreateAccountInput,
  insertAccountTx,
  writeDecisionTx,
} from './account.repository';
import {
  buildTransaction,
  CreateTransactionInput,
  insertTransactionTx,
} from './transaction.repository';

export type SuggestionTarget =
  | { kind: 'add'; account: CreateAccountInput }
  | { kind: 'link'; accountId: string };

export interface ImportSuggestionInput {
  target: SuggestionTarget;
  /** Normalized key the 'added' / 'linked' decision is recorded under. */
  decisionKey: AccountKey;
  /** Pending SMS rows WITHOUT an account yet (filled with the target id). */
  transactions: ReadonlyArray<Omit<CreateTransactionInput, 'accountId'>>;
}

export interface ImportSuggestionResult {
  /** The newly created account (add) or null (link). */
  account: Account | null;
  accountId: string;
  transactions: Transaction[];
}

/**
 * R2b "Add account" / "Link to existing" from New Accounts Found, in ONE
 * `db.transaction` — all land or none do:
 *  - add: INSERT the account + 'account_created' (user) audit;
 *  - the 'added' / 'linked' decision row for the key (future SMS for the key
 *    route to this account);
 *  - one pending transaction per waiting item + its 'detected' (system,
 *    confidence only) audit — the same row/audit shape as Sync SMS.
 * Dedup by sourceReferenceHash is the caller's job (it filters before).
 */
async function importSuggestion(input: ImportSuggestionInput): Promise<ImportSuggestionResult> {
  let account: Account | null = null;
  let accountId: string;
  if (input.target.kind === 'add') {
    account = buildAccount(input.target.account);
    accountId = account.id;
  } else {
    accountId = input.target.accountId;
  }
  const transactions = input.transactions.map(row => buildTransaction({ ...row, accountId }));

  const db = getDatabase();
  await db.transaction(async tx => {
    if (account) {
      await insertAccountTx(tx, account, [{ eventType: 'account_created', actor: 'user' }]);
    }
    await writeDecisionTx(tx, input.decisionKey, account ? 'added' : 'linked', accountId);
    if (!account) {
      // R5: the link itself is audited (public bank id, kind, count only).
      await auditRepository.insert(tx, {
        eventType: 'account_linked',
        actor: 'user',
        accountId,
        metadata: {
          kind: 'account_linked',
          bankCanonical: input.decisionKey.bankCanonical,
          accountKind: input.decisionKey.accountKind,
          items: transactions.length,
        },
      });
    }
    for (const transaction of transactions) {
      await insertTransactionTx(tx, transaction, [
        {
          eventType: 'detected',
          actor: 'system',
          metadata: {
            kind: 'detected',
            confidence: transaction.confidenceScore,
            transactionType: transaction.type,
          },
        },
      ]);
    }
  });

  return { account, accountId, transactions };
}

export interface UndoLinkInput {
  decisionKey: AccountKey;
  accountId: string;
  /**
   * The rows the link inserted that still exist (R5-fix C11: pending AND
   * those the opt-in auto rule approved during the link).
   */
  pending: ReadonlyArray<Pick<Transaction, 'id' | 'merchantName' | 'amountMinor' | 'type' | 'status'>>;
}

/**
 * R5 Undo of "Link to existing", in ONE `db.transaction`: remove the
 * 'linked' decision (only if it still points at that account), delete every
 * row the link inserted that still exists — pending or auto-approved during
 * the link (R5-fix C11) — each audited 'deleted' with the usual snapshot
 * (status included), and write one 'account_unlinked' audit. No tombstone:
 * the restored card must be importable again. Returns the number deleted.
 */
async function undoLink(input: UndoLinkInput): Promise<number> {
  const key = input.decisionKey;
  await getDatabase().transaction(async tx => {
    await tx.execute(
      "DELETE FROM account_suggestion_decisions WHERE bank_canonical = ? AND account_kind = ? AND last_four = ? AND decision = 'linked' AND account_id = ?",
      [key.bankCanonical, key.accountKind, key.lastFour, input.accountId],
    );
    for (const row of input.pending) {
      await tx.execute('DELETE FROM transactions WHERE id = ?', [row.id]);
      await auditRepository.insert(tx, {
        eventType: 'deleted',
        actor: 'user',
        transactionId: row.id,
        accountId: input.accountId,
        metadata: {
          kind: 'deleted',
          merchantName: row.merchantName,
          amountMinor: row.amountMinor,
          type: row.type,
          status: row.status,
        },
      });
    }
    await auditRepository.insert(tx, {
      eventType: 'account_unlinked',
      actor: 'user',
      accountId: input.accountId,
      metadata: {
        kind: 'account_unlinked',
        bankCanonical: key.bankCanonical,
        accountKind: key.accountKind,
        items: input.pending.length,
      },
    });
  });
  return input.pending.length;
}

export const suggestionRepository = { importSuggestion, undoLink };
