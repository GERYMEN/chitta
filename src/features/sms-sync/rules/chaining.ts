import { create } from 'zustand';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { ParsedSmsTransaction } from '../parser/readSms';
import type { RuleChainInfo } from './ruleRead';
import type { RuleChainOverride, RuleChainSelector } from './rules.types';

/**
 * R5g item 21 — chaining (Tracker semantics: NEVER deletes or merges rows).
 *
 * A template with `enable_chaining` looks for a PARENT among live + pending
 * rows within the largest `delta` selector (default 1 h) — same issuer
 * (account bank) unless a selector names the account. Outcomes:
 * - parent found + child_override `deleted: true` → the child stays pending,
 *   held, and a DUPLICATE suggestion (R3b pair) is offered with the parent;
 * - parent found + `link: 'refund'` → a refund-link suggestion, held;
 * - parent found + `link: 'transfer_twin'` → held (R3a pairs it);
 * - `incomplete: true` (template or override) → held, "waiting for the
 *   matching alert", until a child completes it or 24 h pass.
 * parent_override fields apply only when the user confirms the pair (kept
 * on the suggestion; nothing is written now). Suggestions live in memory
 * (session only, like "New accounts found"); no SMS content is stored.
 */

export const DEFAULT_CHAIN_WINDOW_MS = 60 * 60 * 1000;
export const INCOMPLETE_HOLD_MS = 24 * 60 * 60 * 1000;

export type ChainRow = Pick<
  Transaction,
  'id' | 'status' | 'type' | 'amountMinor' | 'accountId' | 'occurredAt' | 'refDigest' | 'sourceType'
>;

export interface ChainChild {
  row: ChainRow;
  parsed: Partial<Pick<ParsedSmsTransaction, 'moneyHint' | 'moneyKind' | 'counterpartyLastFour' | 'lastFour' | 'chain'>>;
}

export interface ChainParentFacts {
  row: ChainRow;
  /** Optional derived facts of the parent's SMS (when it came from this run). */
  parsed?: Partial<Pick<ParsedSmsTransaction, 'moneyHint' | 'moneyKind' | 'counterpartyLastFour' | 'lastFour'>>;
}

export type ChainOutcomeKind = 'duplicate' | 'refund_link' | 'transfer_twin' | 'incomplete' | 'none';

export interface ChainOutcome {
  kind: ChainOutcomeKind;
  childId: string;
  parentId: string | null;
  /** True = keep the child pending (never auto-approved). */
  hold: boolean;
  /** Applied only if the user confirms the pair. */
  parentOverride: RuleChainOverride | null;
}

type FieldValue = string | number | null | undefined;

function fieldOf(field: string, row: ChainRow, parsed?: ChainChild['parsed'] | ChainParentFacts['parsed']): FieldValue {
  switch (field) {
    case 'amount':
      return row.amountMinor;
    case 'account':
      return row.accountId;
    case 'date':
      return Date.parse(row.occurredAt);
    case 'transaction_type':
      return row.type === 'expense' ? 'debit' : row.type === 'income' ? 'credit' : row.type;
    case 'network_reference_id':
      return row.refDigest ?? null;
    case 'money_kind':
      return parsed?.moneyKind ?? parsed?.moneyHint ?? null;
    case 'counterparty_pan':
      return parsed?.counterpartyLastFour ?? null;
    case 'pan':
      return parsed?.lastFour ?? null;
    default:
      return null;
  }
}

function selectorPasses(sel: RuleChainSelector, child: ChainChild, parent: ChainParentFacts): boolean {
  const p = fieldOf(sel.parent_field, parent.row, parent.parsed);
  const c = sel.child_field ? fieldOf(sel.child_field, child.row, child.parsed) : undefined;
  switch (sel.match_type) {
    case 'none':
      return true;
    case 'exact':
    case 'same_or_alias':
      // same_or_alias: R5d aliases already route a linked card to its account id.
      return p != null && c != null && p === c;
    case 'exact_if_present':
      return p == null || c == null || p === c;
    case 'delta':
      return typeof p === 'number' && typeof c === 'number' && Math.abs(p - c) <= Number(sel.match_value ?? DEFAULT_CHAIN_WINDOW_MS);
    case 'value':
      return p != null && String(p) === String(sel.match_value);
    default:
      return false;
  }
}

/**
 * The closest-in-time parent passing every selector, or null. `sameIssuer`
 * restricts candidates to the child's issuer unless a selector names the
 * account (then the account decides).
 */
export function findChainParent(
  child: ChainChild,
  chain: RuleChainInfo,
  candidates: ReadonlyArray<ChainParentFacts>,
  sameIssuer: (row: ChainRow) => boolean,
): ChainParentFacts | null {
  const selectors = chain.rule.parent_selection;
  const deltas = selectors.filter(s => s.match_type === 'delta').map(s => Number(s.match_value ?? DEFAULT_CHAIN_WINDOW_MS));
  const windowMs = deltas.length > 0 ? Math.max(...deltas) : DEFAULT_CHAIN_WINDOW_MS;
  const accountSelector = selectors.some(s => s.parent_field === 'account' || s.child_field === 'account');
  const childMs = Date.parse(child.row.occurredAt);
  let best: ChainParentFacts | null = null;
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    const row = candidate.row;
    if (row.id === child.row.id) continue;
    if (row.status !== 'pending' && row.status !== 'approved') continue;
    const diff = Math.abs(Date.parse(row.occurredAt) - childMs);
    if (!Number.isFinite(diff) || diff > windowMs) continue;
    if (!accountSelector && !sameIssuer(row)) continue;
    if (!selectors.every(sel => selectorPasses(sel, child, candidate))) continue;
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  return best;
}

/** What to do with a chained child (suggestions + holds only). */
export function chainOutcome(child: ChainChild, chain: RuleChainInfo, parent: ChainParentFacts | null): ChainOutcome {
  const base = { childId: child.row.id, parentId: parent?.row.id ?? null };
  const override = parent ? chain.rule.parent_match?.child_override : chain.rule.parent_nomatch?.child_override;
  const parentOverride = parent ? chain.rule.parent_match?.parent_override ?? null : null;
  if (parent && override?.deleted === true) return { ...base, kind: 'duplicate', hold: true, parentOverride };
  if (parent && override?.link === 'refund') return { ...base, kind: 'refund_link', hold: true, parentOverride };
  if (parent && override?.link === 'transfer_twin') return { ...base, kind: 'transfer_twin', hold: true, parentOverride };
  if (child.parsed.chain?.incomplete === true || override?.incomplete === true) {
    return { ...base, kind: 'incomplete', hold: true, parentOverride };
  }
  return { ...base, kind: 'none', hold: false, parentOverride };
}

export interface ChainSuggestion {
  kind: Exclude<ChainOutcomeKind, 'none'>;
  childId: string;
  parentId: string | null;
  parentOverride: RuleChainOverride | null;
  createdAt: number;
}

interface ChainSuggestionState {
  suggestions: ChainSuggestion[];
  add: (outcomes: ReadonlyArray<ChainOutcome>, nowMs: number) => void;
  /** The pair was confirmed / dismissed, or the child completed. */
  remove: (childId: string) => void;
  clear: () => void;
}

/** Session-only store of chain suggestions (ids only; never SMS content). */
export const useChainSuggestions = create<ChainSuggestionState>(set => ({
  suggestions: [],
  add: (outcomes, nowMs) =>
    set(state => {
      const fresh = outcomes
        .filter(o => o.kind !== 'none')
        .map(o => ({ kind: o.kind as ChainSuggestion['kind'], childId: o.childId, parentId: o.parentId, parentOverride: o.parentOverride, createdAt: nowMs }));
      const ids = new Set(fresh.map(s => s.childId));
      return { suggestions: [...state.suggestions.filter(s => !ids.has(s.childId)), ...fresh] };
    }),
  remove: childId => set(state => ({ suggestions: state.suggestions.filter(s => s.childId !== childId) })),
  clear: () => set({ suggestions: [] }),
}));

/** Duplicate pairs suggested by chaining (fed to R3b's pair finder). */
export function chainDuplicatePairs(suggestions: ReadonlyArray<ChainSuggestion>): Array<readonly [string, string]> {
  return suggestions
    .filter(s => s.kind === 'duplicate' && s.parentId != null)
    .map(s => [s.parentId as string, s.childId] as const);
}

/** "Waiting for the matching alert" — an incomplete row younger than 24 h. */
export function isWaitingForMatchingAlert(
  suggestions: ReadonlyArray<ChainSuggestion>,
  transactionId: string,
  nowMs: number,
): boolean {
  return suggestions.some(s => s.kind === 'incomplete' && s.childId === transactionId && nowMs - s.createdAt < INCOMPLETE_HOLD_MS);
}
