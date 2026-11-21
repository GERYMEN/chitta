import type { RuleChainOverride } from '../../features/sms-sync/rules/rules.types';

/**
 * R5i (G3): a persisted chain suggestion produced by the rules-engine
 * chaining (R5g item 21). IDS + ENUMS ONLY — never an SMS body or a sender
 * number. A suggestion surfaces a pending child + its proposed link; it NEVER
 * touches balances and NEVER creates a transaction on its own (the link is
 * applied only when the user Accepts).
 */

/** The chaining outcome kinds that can be surfaced (never 'none'). */
export type ChainSuggestionKind = 'duplicate' | 'refund_link' | 'transfer_twin' | 'incomplete';

export const CHAIN_SUGGESTION_KINDS: ReadonlyArray<ChainSuggestionKind> = [
  'duplicate',
  'refund_link',
  'transfer_twin',
  'incomplete',
];

/**
 * open      — waiting for the user in Review;
 * accepted  — the user applied the link (reused the existing store action);
 * dismissed — the user kept the items apart (5 s Undo returns it to open);
 * superseded — the pair changed (an accept re-check failed), or the matching
 *              alert arrived and completed an 'incomplete' parent.
 */
export type ChainSuggestionStatus = 'open' | 'accepted' | 'dismissed' | 'superseded';

export const CHAIN_SUGGESTION_STATUSES: ReadonlyArray<ChainSuggestionStatus> = [
  'open',
  'accepted',
  'dismissed',
  'superseded',
];

export interface ChainSuggestionRecord {
  id: string;
  kind: ChainSuggestionKind;
  childId: string;
  parentId: string | null;
  /**
   * The RuleChainOverride enum/boolean fields ONLY (deleted / link /
   * incomplete), applied when the user confirms the pair. Never free text.
   */
  parentOverride: RuleChainOverride | null;
  status: ChainSuggestionStatus;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Keep ONLY the enum/boolean fields of a RuleChainOverride before it is
 * serialised — a defence in depth so a future field can never leak free text
 * or an SMS body into the persisted JSON.
 */
export function sanitizeChainOverride(override: RuleChainOverride | null | undefined): RuleChainOverride | null {
  if (!override) return null;
  const clean: RuleChainOverride = {};
  if (override.incomplete === true) clean.incomplete = true;
  if (override.deleted === true) clean.deleted = true;
  if (override.link === 'refund' || override.link === 'transfer_twin' || override.link === 'duplicate') {
    clean.link = override.link;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}
