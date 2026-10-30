import { getDatabase } from '../db/connection';
import { Account } from '../../domain/accounts/account.types';
import { Transaction } from '../../domain/transactions/transaction.types';
import { AccountKey } from '../../features/sms-sync/normalizeAccountKey';
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
    for (const transaction of transactions) {
      await insertTransactionTx(tx, transaction, [
        {
          eventType: 'detected',
          actor: 'system',
          metadata: { kind: 'detected', confidence: transaction.confidenceScore },
        },
      ]);
    }
  });

  return { account, accountId, transactions };
}

export const suggestionRepository = { importSuggestion };
