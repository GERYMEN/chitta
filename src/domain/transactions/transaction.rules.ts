import { Transaction, TransactionStatus } from './transaction.types';

/**
 * Confidence policy (docs/PROJECT.md §15).
 * Confidence never equals approval — it only decides which affordance
 * ("Approve" vs "Review") is primary in the UI.
 */
export const CONFIDENCE_HIGH = 90;
export const CONFIDENCE_NEEDS_REVIEW = 70;

export type ConfidenceTier = 'high' | 'needsReview' | 'uncertain';

export function confidenceTier(score: number | null): ConfidenceTier {
  if (score === null) return 'uncertain';
  if (score >= CONFIDENCE_HIGH) return 'high';
  if (score >= CONFIDENCE_NEEDS_REVIEW) return 'needsReview';
  return 'uncertain';
}

export function canFastApprove(score: number | null): boolean {
  return confidenceTier(score) === 'high';
}

/**
 * Only an explicit user action moves a transaction into a state that
 * affects the ledger. Confidence, detection, and parsing never do.
 */
export const LEDGER_AFFECTING_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'approved',
]);

export function affectsBalance(transaction: Pick<Transaction, 'status'>): boolean {
  return LEDGER_AFFECTING_STATUSES.has(transaction.status);
}

const VALID_TRANSITIONS: Record<TransactionStatus, ReadonlySet<TransactionStatus>> = {
  pending: new Set(['approved', 'rejected']),
  approved: new Set([]),
  rejected: new Set([]),
  invalid: new Set([]),
};

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return VALID_TRANSITIONS[from].has(to);
}
