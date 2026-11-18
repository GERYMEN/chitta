import type { Account, AccountType } from '../accounts/account.types';
import { isDeletedAccount } from '../accounts/account.rules';
import { TRANSFER_CATEGORY_ID } from '../categories/category.rules';
import type { Transaction } from '../transactions/transaction.types';
import {
  findTransferPairs,
  findTransferTwin,
  isPairCandidate,
  snapshotTransferRow,
  TransferDismissal,
  TransferRowSnapshot,
} from '../transfers/transfer.rules';
import type {
  MeaningCandidate,
  MeaningKind,
  MeaningRule,
  MeaningSide,
  MeaningSuggestion,
  MeaningTarget,
} from './meaning.types';
import { MEANING_KINDS } from './meaning.types';

/**
 * R5e — pure rules for money meaning: which hints are meanings, the
 * counterparty key a rule is stored under, the target resolver (T1) and the
 * one-row transfer conversion (R3a model) with its exact undo.
 */

/** The hints (moneyHint / money_kind) that become a meaning suggestion (M1–M4). */
export function meaningKindOf(hint: string | null | undefined): MeaningKind | null {
  return hint != null && (MEANING_KINDS as ReadonlyArray<string>).includes(hint) ? (hint as MeaningKind) : null;
}

export function meaningSideOf(type: Transaction['type']): MeaningSide | null {
  return type === 'expense' ? 'out' : type === 'income' ? 'in' : null;
}

const IN_PREFIX = 'in:';

/**
 * The counterparty part of a rule key: the other side's last-4, else its
 * 3-digit mask, else the wallet's institution id, else ''. The 'in' side gets
 * an 'in:' prefix (a card's "payment received" must never reuse the rule
 * learnt from the bank's debit of the same bill).
 */
export function counterpartyKeyOf(
  candidate: Pick<MeaningCandidate, 'side' | 'counterpartyLastFour' | 'counterpartyLastDigits' | 'counterpartyInstitution'>,
): string {
  const core =
    (candidate.counterpartyLastFour && /^\d{4}$/.test(candidate.counterpartyLastFour) && candidate.counterpartyLastFour) ||
    (candidate.counterpartyLastDigits && /^\d{3}$/.test(candidate.counterpartyLastDigits) && candidate.counterpartyLastDigits) ||
    (candidate.counterpartyInstitution && /^[a-z]{1,20}$/.test(candidate.counterpartyInstitution) && candidate.counterpartyInstitution) ||
    '';
  return candidate.side === 'in' ? `${IN_PREFIX}${core}` : core;
}

/** The candidate a stored suggestion describes (for live re-resolution). */
export function candidateFromSuggestion(
  suggestion: Pick<MeaningSuggestion, 'kind' | 'bankCanonical' | 'counterpartyKey'>,
  accountId: string,
): MeaningCandidate {
  const side: MeaningSide = suggestion.counterpartyKey.startsWith(IN_PREFIX) ? 'in' : 'out';
  const core = side === 'in' ? suggestion.counterpartyKey.slice(IN_PREFIX.length) : suggestion.counterpartyKey;
  return {
    kind: suggestion.kind,
    side,
    accountId,
    bankCanonical: suggestion.bankCanonical,
    counterpartyLastFour: /^\d{4}$/.test(core) ? core : null,
    counterpartyLastDigits: /^\d{3}$/.test(core) ? core : null,
    counterpartyInstitution: /^[a-z]{1,20}$/.test(core) ? core : null,
  };
}

/** The bank an account belongs to, from its name (same lookup as the R5d suffix rule). */
export type BankOfAccount = (account: Pick<Account, 'name'>) => string;

/** Account types a target may have — also filters the "Choose account" picker. */
export function targetAccountTypes(kind: MeaningKind, side: MeaningSide): ReadonlyArray<AccountType> {
  if (kind === 'atm') return ['cash'];
  // R5b D-a: a card bill payment can target a credit_card OR a pay_later line.
  if (side === 'out' && kind === 'card_payment') return ['credit_card', 'pay_later'];
  if (side === 'out' && kind === 'wallet_load') return ['other'];
  // The bank side of a card's "payment received" / a wallet's own top-up alert.
  if (kind === 'card_payment' || kind === 'wallet_load') return ['bank', 'upi', 'other', 'cash'];
  return ['bank', 'cash', 'credit_card', 'pay_later', 'upi', 'other'];
}

function pick(kind: MeaningKind, hits: ReadonlyArray<Pick<Account, 'id'>>): MeaningTarget {
  if (hits.length === 1) return { kind, target: hits[0].id, reason: 'unique' };
  return { kind, target: null, reason: hits.length > 1 ? 'ambiguous' : 'missing' };
}

/** The stored rule for this candidate's key, if any. */
export function findMeaningRule(
  candidate: MeaningCandidate,
  rules: ReadonlyArray<MeaningRule>,
): MeaningRule | null {
  const key = counterpartyKeyOf(candidate);
  return (
    rules.find(
      r => r.bankCanonical === candidate.bankCanonical && r.kind === candidate.kind && r.counterpartyKey === key,
    ) ?? null
  );
}

/**
 * T1 — where the money went (side 'out') or came from (side 'in'):
 *  - a stored meaning rule whose target is an active other account → 'rule';
 *  - card_payment (out): credit cards with last_four = the counterparty
 *    last-4; else the R5d suffix rule on a 3-digit mask (same bank); else,
 *    with no digits, the credit cards of the same bank canonical;
 *  - atm: the active 'cash' accounts;
 *  - wallet_load (out): 'other' accounts of the wallet's institution (all
 *    'other' accounts when the wallet is not named);
 *  - card_payment / wallet_load (in) and transfer: own accounts matched by
 *    the counterparty last-4 when present, otherwise the user picks.
 * Exactly one hit → 'unique'; more → 'ambiguous'; none → 'missing'. The
 * item's own account and soft-deleted accounts are never targets.
 */
export function resolveMeaningTarget(
  candidate: MeaningCandidate,
  accounts: ReadonlyArray<Account>,
  rules: ReadonlyArray<MeaningRule>,
  bankOf: BankOfAccount,
): MeaningTarget {
  const { kind, side } = candidate;
  const types = targetAccountTypes(kind, side);
  const others = accounts.filter(
    a => !isDeletedAccount(a) && a.id !== candidate.accountId && types.includes(a.type),
  );
  const rule = findMeaningRule(candidate, rules);
  if (rule && others.some(a => a.id === rule.targetAccountId)) {
    return { kind, target: rule.targetAccountId, reason: 'rule' };
  }
  const four = candidate.counterpartyLastFour && /^\d{4}$/.test(candidate.counterpartyLastFour) ? candidate.counterpartyLastFour : null;
  const three = candidate.counterpartyLastDigits && /^\d{3}$/.test(candidate.counterpartyLastDigits) ? candidate.counterpartyLastDigits : null;
  const bank = candidate.bankCanonical;

  if (kind === 'card_payment' && side === 'out') {
    if (four) return pick(kind, others.filter(a => a.lastFour === four));
    if (three) {
      if (bank === 'unknown') return pick(kind, []);
      return pick(
        kind,
        others.filter(a => (a.lastFour ?? '').length === 4 && (a.lastFour ?? '').endsWith(three) && bankOf(a) === bank),
      );
    }
    return pick(kind, bank === 'unknown' ? [] : others.filter(a => bankOf(a) === bank));
  }
  if (kind === 'atm') return pick(kind, others);
  if (kind === 'wallet_load' && side === 'out') {
    const institution = candidate.counterpartyInstitution;
    return pick(kind, institution ? others.filter(a => bankOf(a) === institution) : others);
  }
  // transfer (either side) and the bank side of card / wallet credits.
  if (four) return pick(kind, others.filter(a => a.lastFour === four));
  return { kind, target: null, reason: others.length > 0 ? 'ambiguous' : 'missing' };
}

// ---- conversion (R3a one-row transfer) ---------------------------------------

/** TransferRowSnapshot + the account (an income's "from" moves it). */
export interface MeaningRowSnapshot extends TransferRowSnapshot {
  accountId: string;
}

export function snapshotMeaningRow(t: Transaction): MeaningRowSnapshot {
  return { ...snapshotTransferRow(t), accountId: t.accountId };
}

export interface MeaningConversionPrevious {
  transfer: MeaningRowSnapshot;
  twin: MeaningRowSnapshot | null;
}

export interface MeaningConversion {
  /** The row that IS the transfer now (account_id = from, transfer_account_id = to). */
  transfer: Transaction;
  /** The counterpart SMS row kept as a rejected 'transfer_twin' (R3a), if any. */
  twin: Transaction | null;
  previous: MeaningConversionPrevious;
}

const CONVERTIBLE_STATUSES: ReadonlySet<Transaction['status']> = new Set(['pending', 'approved']);

function convertible(t: Transaction): boolean {
  return (t.type === 'income' || t.type === 'expense') && CONVERTIBLE_STATUSES.has(t.status) && isPairCandidate(t);
}

/**
 * Confirm a meaning: the item becomes ONE transfer row (R3a) — an expense on
 * A to target B (from A to B), an income on A from target B (from B to A);
 * category cat-transfer; merchant, hash and preview kept. With a counterpart
 * SMS row (`partner`: the opposite type, same amount, on the target account)
 * the EXPENSE becomes the transfer and the income its rejected twin (R3a twin
 * rules), so the move is never counted twice. `approve` = a user confirm
 * (approved now, or keeps its approval); otherwise the status is kept (a
 * stored rule in manual mode leaves it pending). Null when not allowed.
 */
export function buildMeaningConversion(
  row: Transaction,
  targetAccountId: string,
  partner: Transaction | null,
  now: string,
  options: { approve: boolean },
): MeaningConversion | null {
  if (!convertible(row) || targetAccountId === '' || targetAccountId === row.accountId) return null;
  const status = (t: Transaction): Pick<Transaction, 'status' | 'approvedAt'> =>
    options.approve
      ? { status: 'approved', approvedAt: t.status === 'approved' && t.approvedAt ? t.approvedAt : now }
      : { status: t.status, approvedAt: t.approvedAt };

  if (partner) {
    if (
      !convertible(partner) ||
      partner.id === row.id ||
      partner.type === row.type ||
      partner.amountMinor !== row.amountMinor ||
      partner.accountId !== targetAccountId
    ) {
      return null;
    }
    const debit = row.type === 'expense' ? row : partner;
    const credit = row.type === 'expense' ? partner : row;
    return {
      previous: { transfer: snapshotMeaningRow(debit), twin: snapshotMeaningRow(credit) },
      transfer: {
        ...debit,
        // R5e-FIX M7 (R3a confirmTransferPair): the DEBIT keeps its own approval.
        ...status(debit),
        type: 'transfer',
        transferAccountId: credit.accountId,
        categoryId: TRANSFER_CATEGORY_ID,
        linkedTransactionId: null,
        linkKind: null,
        updatedAt: now,
      },
      twin: {
        ...credit,
        status: 'rejected',
        linkKind: 'transfer_twin',
        linkedTransactionId: debit.id,
        updatedAt: now,
      },
    };
  }

  const fromAccount = row.type === 'expense' ? row.accountId : targetAccountId;
  const toAccount = row.type === 'expense' ? targetAccountId : row.accountId;
  return {
    previous: { transfer: snapshotMeaningRow(row), twin: null },
    transfer: {
      ...row,
      ...status(row),
      type: 'transfer',
      accountId: fromAccount,
      transferAccountId: toAccount,
      categoryId: TRANSFER_CATEGORY_ID,
      linkedTransactionId: null,
      linkKind: null,
      updatedAt: now,
    },
    twin: null,
  };
}

function applySnapshot(t: Transaction, snapshot: MeaningRowSnapshot, now: string): Transaction {
  return { ...t, ...snapshot, updatedAt: now };
}

/**
 * Undo a confirmed meaning exactly: both rows get their saved fields back
 * (updatedAt = now). Null when the rows are no longer that conversion.
 */
export function undoMeaningConversion(
  transfer: Transaction,
  twin: Transaction | null,
  previous: MeaningConversionPrevious,
  now: string,
): { transfer: Transaction; twin: Transaction | null } | null {
  if (transfer.type !== 'transfer') return null;
  if (previous.twin) {
    if (!twin || twin.linkKind !== 'transfer_twin' || twin.linkedTransactionId !== transfer.id) return null;
    return { transfer: applySnapshot(transfer, previous.transfer, now), twin: applySnapshot(twin, previous.twin, now) };
  }
  return { transfer: applySnapshot(transfer, previous.transfer, now), twin: null };
}

/** Open = not resolved yet. */
export function isOpenSuggestion(s: Pick<MeaningSuggestion, 'resolvedAt'>): boolean {
  return s.resolvedAt == null;
}

/** Ids of transactions with an open meaning suggestion. */
export function openMeaningIds(suggestions: ReadonlyArray<MeaningSuggestion>): Set<string> {
  return new Set(suggestions.filter(isOpenSuggestion).map(s => s.transactionId));
}

/**
 * R3a pairing still runs: the counterpart SMS row of `row` (a suggested
 * transfer pair whose OTHER side is on the chosen target account), so a
 * confirmed meaning hides it as the transfer's twin instead of counting the
 * move twice. Null when there is no such pair.
 */
export function meaningPartner(
  row: Transaction,
  targetAccountId: string,
  transactions: ReadonlyArray<Transaction>,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'deletedAt'>>,
  dismissals: ReadonlyArray<Pick<TransferDismissal, 'debitId' | 'creditId'>>,
): Transaction | null {
  for (const pair of findTransferPairs(transactions, accounts, dismissals)) {
    if (pair.debit.id === row.id && pair.credit.accountId === targetAccountId) return pair.credit;
    if (pair.credit.id === row.id && pair.debit.accountId === targetAccountId) return pair.debit;
  }
  return null;
}

/** True when `row` is in ANY suggested transfer pair (the user decides which reading wins). */
export function isInTransferPair(
  rowId: string,
  transactions: ReadonlyArray<Transaction>,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'deletedAt'>>,
  dismissals: ReadonlyArray<Pick<TransferDismissal, 'debitId' | 'creditId'>>,
): boolean {
  return findTransferPairs(transactions, accounts, dismissals).some(
    pair => pair.debit.id === rowId || pair.credit.id === rowId,
  );
}

/**
 * R5e-FIX M2 / K1 — how far apart a bank debit and the card / wallet alert of
 * the same move may be (the R5g chaining templates' 'payment received'
 * transfer_twin window, 72 h; R3a pairing only looks 24 h).
 */
export const MEANING_COUNTERPART_WINDOW_MS = 72 * 60 * 60 * 1000;

function withinCounterpartWindow(a: Pick<Transaction, 'occurredAt'>, b: Pick<Transaction, 'occurredAt'>): boolean {
  const diff = Math.abs(Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  return Number.isFinite(diff) && diff <= MEANING_COUNTERPART_WINDOW_MS;
}

/** The single closest row (by time) — null when none, or when two tie. */
function closest<T extends Pick<Transaction, 'occurredAt'>>(row: Pick<Transaction, 'occurredAt'>, hits: ReadonlyArray<T>): T | null {
  if (hits.length === 0) return null;
  const at = Date.parse(row.occurredAt);
  const ranked = [...hits].sort((a, b) => Math.abs(Date.parse(a.occurredAt) - at) - Math.abs(Date.parse(b.occurredAt) - at));
  if (
    ranked.length > 1 &&
    Math.abs(Date.parse(ranked[0].occurredAt) - at) === Math.abs(Date.parse(ranked[1].occurredAt) - at)
  ) {
    return null;
  }
  return ranked[0];
}

/**
 * R5e-FIX M2 — the OTHER SMS of the same move outside R3a's 24 h window: on
 * the target account, the opposite type, the same amount, within 72 h, a
 * plain live row (not linked, not a transfer) that itself carries a meaning
 * suggestion of the same kind on the opposite side (open, or kept as an
 * expense / income) pointing back at `row`'s account (or not resolved). That
 * suggestion is what tells it apart from an unrelated same-amount item.
 */
export function meaningCounterpart(
  row: Transaction,
  kind: MeaningKind,
  targetAccountId: string,
  transactions: ReadonlyArray<Transaction>,
  suggestions: ReadonlyArray<MeaningSuggestion>,
): Transaction | null {
  const side = meaningSideOf(row.type);
  if (!side) return null;
  const byRow = new Map(suggestions.map(s => [s.transactionId, s]));
  const hits = transactions.filter(c => {
    if (c.id === row.id || !convertible(c) || c.linkKind != null || c.linkedTransactionId != null) return false;
    if (c.type === row.type || c.amountMinor !== row.amountMinor || c.accountId !== targetAccountId) return false;
    if (!withinCounterpartWindow(c, row)) return false;
    const s = byRow.get(c.id);
    if (!s || s.kind !== kind || s.resolution === 'transfer' || s.resolution === 'paired') return false;
    const sSide: MeaningSide = s.counterpartyKey.startsWith(IN_PREFIX) ? 'in' : 'out';
    if (sSide === side || sSide !== meaningSideOf(c.type)) return false;
    return s.targetAccountId == null || s.targetAccountId === row.accountId;
  });
  return closest(row, hits);
}

/**
 * R5e-FIX K1 — the meaning transfer `row` is the late counterpart of: a
 * transfer made by a confirmed / rule meaning of the same kind (its own
 * suggestion closed as 'transfer'), still without a twin, the same amount,
 * within 72 h, that moved money INTO `row`'s account (an income) or OUT of it
 * (an expense). Null when none (or two tie).
 */
export function lateMeaningTransfer(
  row: Transaction,
  kind: MeaningKind,
  transactions: ReadonlyArray<Transaction>,
  suggestions: ReadonlyArray<MeaningSuggestion>,
): Transaction | null {
  const side = meaningSideOf(row.type);
  if (!side || !convertible(row) || row.linkKind != null || row.linkedTransactionId != null) return null;
  const converted = new Set(
    suggestions.filter(s => s.kind === kind && s.resolution === 'transfer').map(s => s.transactionId),
  );
  const hits = transactions.filter(t => {
    if (t.id === row.id || t.type !== 'transfer' || !converted.has(t.id)) return false;
    if (t.status !== 'pending' && t.status !== 'approved') return false;
    if (t.amountMinor !== row.amountMinor || !withinCounterpartWindow(t, row)) return false;
    const geometry =
      side === 'in'
        ? t.transferAccountId === row.accountId && t.accountId !== row.accountId
        : t.accountId === row.accountId && t.transferAccountId !== row.accountId;
    return geometry && findTransferTwin(transactions, t.id) === null;
  });
  return closest(row, hits);
}

/** K1: `row` hidden as the existing transfer's rejected twin (R3a twin rules). */
export function buildMeaningTwinAttach(
  row: Transaction,
  transfer: Transaction,
  now: string,
): { twin: Transaction; previous: MeaningConversionPrevious } | null {
  if (!convertible(row) || transfer.type !== 'transfer' || transfer.amountMinor !== row.amountMinor) return null;
  return {
    // The transfer itself does not change: its snapshot is its current state,
    // so an Undo of this step only brings the late row back.
    previous: { transfer: snapshotMeaningRow(transfer), twin: snapshotMeaningRow(row) },
    twin: { ...row, status: 'rejected', linkKind: 'transfer_twin', linkedTransactionId: transfer.id, updatedAt: now },
  };
}

/** What a confirm with "Do this automatically next time" does to the rules. */
export interface MeaningRulePlan {
  /** null = the rule already points at this account (nothing to write). */
  write: { op: 'insert'; rule: MeaningRule } | { op: 'retarget'; id: string; targetAccountId: string } | null;
  ruleId: string;
  created: boolean;
  /** The target the rule had before (Undo re-points it); null when new. */
  previousTarget: string | null;
}

export function planMeaningRule(
  rules: ReadonlyArray<MeaningRule>,
  key: Pick<MeaningRule, 'bankCanonical' | 'kind' | 'counterpartyKey'>,
  targetAccountId: string,
  newId: string,
  now: string,
): MeaningRulePlan {
  const existing = rules.find(
    r => r.bankCanonical === key.bankCanonical && r.kind === key.kind && r.counterpartyKey === key.counterpartyKey,
  );
  if (!existing) {
    return {
      write: { op: 'insert', rule: { id: newId, ...key, targetAccountId, createdAt: now } },
      ruleId: newId,
      created: true,
      previousTarget: null,
    };
  }
  return {
    write: existing.targetAccountId === targetAccountId ? null : { op: 'retarget', id: existing.id, targetAccountId },
    ruleId: existing.id,
    created: false,
    previousTarget: existing.targetAccountId,
  };
}
