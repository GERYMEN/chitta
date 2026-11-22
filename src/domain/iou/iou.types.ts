/**
 * R10 — Personal IOUs. A personal lent/borrowed ledger kept ALONGSIDE
 * transactions (a parallel layer: it never changes an expense's amount in
 * spend). Names are the user's own free text (no contacts, no SMS). Money is
 * integer paise.
 */
export type IouDirection = 'lent' | 'borrowed';

export interface Person {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface IouShare {
  id: string;
  personId: string;
  /** 'lent' = they owe you; 'borrowed' = you owe them. */
  direction: IouDirection;
  /** The split expense (lent, from Split); null for a manual entry. */
  sourceTransactionId: string | null;
  amountMinor: number;
  note: string | null;
  createdAt: string;
  /** null = unsettled. */
  settledAt: string | null;
  /** The credit (lent) / expense (borrowed) linked as the repayment, if any. */
  repaymentTransactionId: string | null;
}

/** One line of the Split sheet: an existing person (id) or a new one (name). */
export interface SplitShareInput {
  personId: string | null;
  /** Used when personId is null (create the person). */
  newName: string | null;
  amountMinor: number;
}
