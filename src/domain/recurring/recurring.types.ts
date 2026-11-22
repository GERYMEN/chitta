export type RecurringCadence = 'weekly' | 'monthly' | 'yearly';

/**
 * R8a: a payment pattern detected from approved spend history. Derived in
 * memory only — never stored. `typicalAmountMinor` is an ESTIMATE (median).
 */
export interface RecurringSeries {
  merchantKey: string;
  /** Merchant name as last seen (display only; never written anywhere). */
  displayName: string;
  cadence: RecurringCadence;
  typicalAmountMinor: number;
  lastAt: string;
  nextDueAt: string;
  occurrenceCount: number;
}
