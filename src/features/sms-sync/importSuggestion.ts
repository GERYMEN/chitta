import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { CreateAccountInput } from '../../data/repositories/account.repository';
import { CreateTransactionInput } from '../../data/repositories/transaction.repository';
import { Category } from '../../domain/categories/category.types';
import { UNCATEGORISED_ID } from '../../domain/categories/category.rules';
import { shouldAutoApprove } from '../../domain/settings/approval.rules';
import { Transaction } from '../../domain/transactions/transaction.types';
import { ACCOUNT_KEY_NORMALIZER_VERSION, AccountKey } from './normalizeAccountKey';
import { ParsedSmsTransaction } from './smsParser';
import { buildSmsPendingRow, resolveCategoryIdForSms } from './smsSyncLogic';
import { SuggestionGroup } from './suggestionGroups';
import { getSuggestionGroup, useSuggestionSession } from './suggestionSession';
import { showSnackbar } from '../../shared/ui/Snackbar';
import { openPendingForAccount } from '../../app/navigation/navigationRef';

export type PendingRowInput = Omit<CreateTransactionInput, 'accountId'>;

/**
 * Pure: turn a card's waiting candidates into pending rows. Skips any whose
 * sourceReferenceHash already exists (or repeats), resolves the category
 * exactly like Sync SMS (merchant rule, else Uncategorised; skipped if
 * neither exists).
 */
export function preparePendingRows(
  items: ReadonlyArray<ParsedSmsTransaction>,
  categories: ReadonlyArray<Category>,
  rules: Readonly<Record<string, string>>,
  existingHashes: ReadonlySet<string>,
  detectedAt: string,
): { rows: PendingRowInput[]; uncategorised: number } {
  const seen = new Set(existingHashes);
  const rows: PendingRowInput[] = [];
  let uncategorised = 0;
  for (const parsed of items) {
    if (seen.has(parsed.sourceReferenceHash)) continue;
    const categoryId = resolveCategoryIdForSms(categories, parsed.type, parsed.merchantName, rules);
    if (categoryId == null) continue;
    seen.add(parsed.sourceReferenceHash);
    rows.push(buildSmsPendingRow(parsed, categoryId, detectedAt));
    if (categoryId === UNCATEGORISED_ID) uncategorised++;
  }
  return { rows, uncategorised };
}

/** The normalized decision key of a card. */
export function groupAccountKey(group: SuggestionGroup): AccountKey {
  return {
    bankCanonical: group.bankCanonical,
    accountKind: group.suggestion.accountKind,
    lastFour: group.suggestion.lastFour ?? '',
    normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
  };
}

export interface SuggestionImportOutcome {
  accountId: string;
  /** Rows inserted (after dedup). */
  created: number;
  /** Of those, approved by the opt-in auto rule (same rule as Sync SMS). */
  autoApproved: number;
  uncategorised: number;
}

/** Snackbar copy after Add/Link. Counts only. */
export function importSnackbarMessage(outcome: SuggestionImportOutcome, linked: boolean): string {
  const pending = outcome.created - outcome.autoApproved;
  if (outcome.created === 0) return linked ? 'Account linked — nothing new to add' : 'Account added — nothing new to add';
  let text = `${pending} transaction${pending === 1 ? '' : 's'} added to Pending`;
  if (outcome.autoApproved > 0) text += `, ${outcome.autoApproved} auto-approved`;
  return text;
}

async function runImport(
  group: SuggestionGroup,
  target: { kind: 'add'; account: CreateAccountInput } | { kind: 'link'; accountId: string },
): Promise<SuggestionImportOutcome> {
  const store = useTransactionsStore.getState();
  const existingHashes = new Set(
    store.transactions
      .map(transaction => transaction.sourceReferenceHash)
      .filter((hash): hash is string => hash != null),
  );
  const { rows, uncategorised } = preparePendingRows(
    group.items,
    store.categories,
    store.merchantRules,
    existingHashes,
    new Date().toISOString(),
  );

  const result = await store.importSuggestion({
    target,
    decisionKey: groupAccountKey(group),
    transactions: rows,
  });

  // Opt-in auto mode: exactly the Sync SMS rule and path (system actor).
  const { approvalMode, autoApproveThreshold } = useTransactionsStore.getState();
  let autoApproved = 0;
  for (const transaction of result.transactions) {
    if (!shouldAutoApprove(approvalMode, autoApproveThreshold, transaction.confidenceScore)) {
      continue;
    }
    await useTransactionsStore.getState().approve(transaction.id, {
      confidence: transaction.confidenceScore ?? 0,
      threshold: autoApproveThreshold,
    });
    const after: Transaction | undefined = useTransactionsStore
      .getState()
      .transactions.find(t => t.id === transaction.id);
    if (after?.status === 'approved') autoApproved++;
  }

  return {
    accountId: result.accountId,
    created: result.transactions.length,
    autoApproved,
    uncategorised,
  };
}

/**
 * "Add account" on a card: create the account (from the validated Add
 * Account form) and insert the card's waiting items as pending on it, then
 * drop the card from the session. Null when the session run is stale.
 */
export async function addSuggestedAccount(
  runId: string,
  key: string,
  account: CreateAccountInput,
): Promise<SuggestionImportOutcome | null> {
  const group = getSuggestionGroup(runId, key);
  if (!group) return null;
  const outcome = await runImport(group, { kind: 'add', account });
  useSuggestionSession.getState().remove(runId, key);
  return outcome;
}

/** "Link to existing": same as Add, onto an existing active account. */
export async function linkSuggestion(
  runId: string,
  key: string,
  accountId: string,
): Promise<SuggestionImportOutcome | null> {
  const group = getSuggestionGroup(runId, key);
  if (!group) return null;
  const outcome = await runImport(group, { kind: 'link', accountId });
  useSuggestionSession.getState().remove(runId, key);
  return outcome;
}

/** "Ignore": record the 'ignored' decision and drop the card. */
export async function ignoreSuggestionGroup(runId: string, key: string): Promise<boolean> {
  const group = getSuggestionGroup(runId, key);
  if (!group) return false;
  await useTransactionsStore.getState().ignoreSuggestion(groupAccountKey(group));
  useSuggestionSession.getState().remove(runId, key);
  return true;
}

/** Snackbar after Add/Link: "N transactions added to Pending — VIEW". */
export function showImportSnackbar(outcome: SuggestionImportOutcome, linked: boolean): void {
  const hasPending = outcome.created - outcome.autoApproved > 0;
  showSnackbar({
    message: importSnackbarMessage(outcome, linked),
    ...(hasPending
      ? { actionLabel: 'View', onAction: () => openPendingForAccount(outcome.accountId) }
      : {}),
  });
}
