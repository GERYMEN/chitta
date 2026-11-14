/**
 * R5e — money meaning. An SMS item whose money only moves between the
 * owner's own accounts (a credit-card bill payment, an ATM withdrawal, a
 * wallet top-up, an own-account transfer) is a TRANSFER, not an expense.
 * Pure types only (no React, no store, no SQL).
 */

/** The meanings that turn an item into an R3a transfer (M1–M4). */
export type MeaningKind = 'card_payment' | 'atm' | 'wallet_load' | 'transfer';

export const MEANING_KINDS: ReadonlyArray<MeaningKind> = ['card_payment', 'atm', 'wallet_load', 'transfer'];

/**
 * Which side of the move the SMS item is: 'out' = money left the item's own
 * account (an expense: the target is where it went), 'in' = money arrived on
 * the item's own account (an income: the target is where it came from).
 */
export type MeaningSide = 'out' | 'in';

/** How the target account was found. */
export type MeaningReason = 'rule' | 'unique' | 'ambiguous' | 'missing';

/** How an open suggestion was closed. */
export type MeaningResolution = 'transfer' | 'expense' | 'paired';

/**
 * "Do this automatically next time": the user confirmed a meaning once for
 * (bank canonical, kind, counterparty key) → later matches convert to a
 * transfer to `targetAccountId`. Holds a public bank id, an enum and a last-4
 * or a public wallet id only (the same class of data as account suggestion
 * decisions) — never SMS text.
 */
export interface MeaningRule {
  id: string;
  bankCanonical: string;
  kind: MeaningKind;
  /** '' none · '1234' last-4 · '123' 3-digit mask · 'paytm' wallet id; 'in:' prefix for the 'in' side. */
  counterpartyKey: string;
  targetAccountId: string;
  createdAt: string;
}

/** A meaning waiting for (or closed by) the user, one per transaction. */
export interface MeaningSuggestion {
  transactionId: string;
  kind: MeaningKind;
  /** The resolved target when it was unique (or a rule's), else null. */
  targetAccountId: string | null;
  reason: MeaningReason;
  /** The SMS bank id + counterparty key the rule would be stored under. */
  bankCanonical: string;
  counterpartyKey: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: MeaningResolution | null;
}

/** What the target resolver needs to know about one SMS item. */
export interface MeaningCandidate {
  kind: MeaningKind;
  side: MeaningSide;
  /** The item's own account (never a target). */
  accountId: string;
  bankCanonical: string;
  counterpartyLastFour?: string | null;
  /** A 3-digit mask on the other side (R5d suffix rule). */
  counterpartyLastDigits?: string | null;
  /** A wallet's public institution id ('paytm', 'amazonpay'). */
  counterpartyInstitution?: string | null;
}

export interface MeaningTarget {
  kind: MeaningKind;
  target: string | null;
  reason: MeaningReason;
}
