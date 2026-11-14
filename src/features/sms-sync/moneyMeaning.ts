import { useTransactionsStore } from '../transactions/state/transactionsStore';
import type { Transaction } from '../../domain/transactions/transaction.types';
import type { Account } from '../../domain/accounts/account.types';
import type { MeaningCandidate, MeaningRule, MeaningSuggestion } from '../../domain/meaning/meaning.types';
import {
  counterpartyKeyOf,
  findMeaningRule,
  lateMeaningTransfer,
  resolveMeaningTarget,
} from '../../domain/meaning/meaning.rules';
import { findTransferTwin } from '../../domain/transfers/transfer.rules';
import { activeAccounts } from '../../domain/accounts/account.rules';
import { bankCanonicalForText } from './normalizeAccountKey';
import type { ParsedSmsTransaction } from './smsParser';
import { meaningCandidateFor, refKeyOf } from './smsSyncLogic';

/**
 * R5e T2 / T5 — money meaning during a sync (and an R2b Add/Link import).
 * Pure resolution lives in domain/meaning; this module only applies it:
 * a stored rule converts a NEW item (store.convertByMeaningRule), anything
 * else becomes a persisted suggestion. Existing rows change only as the
 * twin of a new item's conversion (R3a twin rules).
 */

export const bankOfAccount = (account: Pick<Account, 'name'>): string => bankCanonicalForText(account.name);

function suggestionFor(candidate: MeaningCandidate, transactionId: string, target: string | null, reason: MeaningSuggestion['reason'], now: string): MeaningSuggestion {
  return {
    transactionId,
    kind: candidate.kind,
    targetAccountId: target,
    reason,
    bankCanonical: candidate.bankCanonical,
    counterpartyKey: counterpartyKeyOf(candidate),
    createdAt: now,
    resolvedAt: null,
    resolution: null,
  };
}

export interface MeaningApplyResult {
  /**
   * New items a stored meaning rule turned into transfers, their twins, and
   * late counterparts hidden as an existing transfer's twin (R5e-FIX K1) —
   * released from the meaning holds (never from a chain / N1 hold).
   */
  converted: Set<string>;
  /** Suggestions written for new items that are still open. */
  suggested: number;
}

/**
 * New items of this run (M1–M4):
 *  1. every item gets its suggestion first (resolved target / reason), so a
 *     rule conversion can find the other alert of the same move (M2);
 *  2. a stored rule converts (unique target, no N1 disagreement, no R3b
 *     duplicate / R5g chain hold, nothing approved touched);
 *  3. R5e-FIX K1: an item whose move is ALREADY a meaning transfer (from an
 *     earlier sync or step 2) becomes that transfer's twin — never a second
 *     transfer, never a second "Confirm transfer".
 * `facts` = the parsed SMS of each new row id.
 */
export async function applyMoneyMeanings(
  created: ReadonlyArray<Transaction>,
  facts: ReadonlyMap<string, ParsedSmsTransaction>,
): Promise<MeaningApplyResult> {
  const converted = new Set<string>();
  const entries: Array<{ id: string; candidate: MeaningCandidate; parsed: ParsedSmsTransaction; byRule: boolean }> = [];
  const suggestions: MeaningSuggestion[] = [];
  for (const row of created) {
    const parsed = facts.get(row.id);
    if (!parsed) continue;
    const store = useTransactionsStore.getState();
    const live = store.transactions.find(t => t.id === row.id);
    if (!isPlain(live)) continue;
    const candidate = meaningCandidateFor(parsed, live);
    if (!candidate) continue;
    const resolved = resolveMeaningTarget(candidate, activeAccounts(store.accounts), store.meaningRules, bankOfAccount);
    entries.push({ id: row.id, candidate, parsed, byRule: resolved.reason === 'rule' });
    suggestions.push(suggestionFor(candidate, row.id, resolved.target, resolved.reason, new Date().toISOString()));
  }
  await useTransactionsStore.getState().addMeaningSuggestions(suggestions);

  const markConverted = (id: string) => {
    converted.add(id);
    const after = useTransactionsStore.getState().transactions;
    const row = after.find(t => t.id === id);
    if (row?.type === 'transfer') {
      const twin = findTransferTwin(after, id);
      if (twin) converted.add(twin.id);
    } else if (row?.linkKind === 'transfer_twin' && row.linkedTransactionId) {
      converted.add(row.linkedTransactionId);
    }
  };

  for (const entry of entries) {
    if (!entry.byRule || entry.parsed.ruleDisagreement) continue;
    const store = useTransactionsStore.getState();
    if (!isPlain(store.transactions.find(t => t.id === entry.id))) continue;
    const rule = findMeaningRule(entry.candidate, store.meaningRules);
    if (rule && (await store.convertByMeaningRule(entry.id, rule))) markConverted(entry.id);
  }

  for (const entry of entries) {
    const store = useTransactionsStore.getState();
    const live = store.transactions.find(t => t.id === entry.id);
    if (!isPlain(live)) continue;
    const late = lateMeaningTransfer(live, entry.candidate.kind, store.transactions, store.meaningSuggestions);
    if (late && (await store.attachMeaningTwin(entry.id, late.id))) markConverted(entry.id);
  }

  const open = new Set(
    useTransactionsStore
      .getState()
      .meaningSuggestions.filter(s => s.resolvedAt == null)
      .map(s => s.transactionId),
  );
  return { converted, suggested: entries.filter(e => open.has(e.id)).length };
}

/** A live plain income / expense row (not a transfer, twin or linked row). */
function isPlain(t: Transaction | undefined): t is Transaction {
  return t != null && t.linkKind == null && (t.type === 'income' || t.type === 'expense');
}

/**
 * T5 lookup: which EXISTING row a deduplicated candidate is (same old key,
 * same content hash, or the same reference + type + amount).
 */
export interface ExistingRowIndex {
  bySource: Map<string, Transaction>;
  byContent: Map<string, Transaction>;
  byRef: Map<string, Transaction>;
}

export function buildExistingRowIndex(transactions: ReadonlyArray<Transaction>): ExistingRowIndex {
  const index: ExistingRowIndex = { bySource: new Map(), byContent: new Map(), byRef: new Map() };
  for (const t of transactions) {
    if (t.sourceReferenceHash) index.bySource.set(t.sourceReferenceHash, t);
    if (t.smsContentHash) index.byContent.set(t.smsContentHash, t);
    if (t.refDigest) index.byRef.set(refKeyOf(t.refDigest, t.type, t.amountMinor), t);
  }
  return index;
}

/**
 * T5: a re-scan candidate with an M1–M4 meaning that deduplicated against an
 * EXISTING plain expense / income → a meaning suggestion for that row (the
 * row itself is never changed; approved rows convert only on the user's
 * confirm). Null when it does not apply or the row already has one.
 */
export function suggestionForExistingRow(
  candidate: ParsedSmsTransaction,
  index: ExistingRowIndex,
  known: ReadonlySet<string>,
  accounts: ReadonlyArray<Account>,
  rules: ReadonlyArray<MeaningRule>,
  now: string,
): MeaningSuggestion | null {
  const row =
    index.bySource.get(candidate.sourceReferenceHash) ??
    (candidate.smsContentHash ? index.byContent.get(candidate.smsContentHash) : undefined) ??
    (candidate.refDigest ? index.byRef.get(refKeyOf(candidate.refDigest, candidate.type, candidate.amountMinor)) : undefined);
  if (!row || known.has(row.id)) return null;
  if (row.type !== candidate.type || (row.status !== 'pending' && row.status !== 'approved')) return null;
  if (row.linkKind != null || row.linkedTransactionId != null || row.transferAccountId != null) return null;
  const meaning = meaningCandidateFor(candidate, row);
  if (!meaning) return null;
  const resolved = resolveMeaningTarget(meaning, activeAccounts(accounts), rules, bankOfAccount);
  return suggestionFor(meaning, row.id, resolved.target, resolved.reason, now);
}
