import type { Transaction } from '../../domain/transactions/transaction.types';
import type { ChainSuggestion } from '../sms-sync/rules/chaining';

/**
 * R5i (G3): join open chain suggestions with their live rows for the Review
 * "Linked by rules" section, applying the D-d de-dupe policy.
 *
 * D-d: the section shows only chain kinds with NO existing Review UI —
 * refund_link and incomplete — PLUS any duplicate / transfer_twin suggestion
 * whose child is not already surfaced by the transfer / duplicate sections
 * (`excludeChildIds`). A duplicate chain child is normally already a
 * DuplicatePairCard (it feeds `findDuplicatePairs`), so it is excluded here.
 */
export interface ChainReviewItem {
  suggestion: ChainSuggestion;
  child: Transaction;
  /** The matched parent (null for 'incomplete'). */
  parent: Transaction | null;
}

/** A row is live enough to act on when it still exists and is pending/approved. */
function isLive(row: Transaction | undefined): row is Transaction {
  return row != null && (row.status === 'pending' || row.status === 'approved');
}

export function chainReviewItems(
  suggestions: ReadonlyArray<ChainSuggestion>,
  transactions: ReadonlyArray<Transaction>,
  excludeChildIds: ReadonlySet<string> = new Set(),
): ChainReviewItem[] {
  const byId = new Map(transactions.map(t => [t.id, t]));
  const items: ChainReviewItem[] = [];
  for (const suggestion of suggestions) {
    if (excludeChildIds.has(suggestion.childId)) continue;
    const child = byId.get(suggestion.childId);
    if (!isLive(child)) continue;
    if (suggestion.kind === 'incomplete') {
      items.push({ suggestion, child, parent: null });
      continue;
    }
    // A link kind needs a parent to act on; the accept re-check revalidates it.
    const parent = suggestion.parentId ? byId.get(suggestion.parentId) ?? null : null;
    if (!isLive(parent ?? undefined)) continue;
    items.push({ suggestion, child, parent });
  }
  return items.sort((a, b) => Date.parse(b.child.occurredAt) - Date.parse(a.child.occurredAt));
}

/** D-e: the proposed relation, by kind. */
export function chainRelationLabel(kind: ChainSuggestion['kind']): string {
  switch (kind) {
    case 'refund_link':
      return 'Refund of an earlier payment';
    case 'transfer_twin':
      return 'Part of a transfer';
    case 'duplicate':
      return 'Looks like a repeat';
    case 'incomplete':
      return 'Waiting for the matching alert';
    default:
      return 'Linked by rules';
  }
}

/** D-e: the Accept action label (incomplete has none). */
export function chainAcceptLabel(kind: ChainSuggestion['kind']): string | null {
  switch (kind) {
    case 'refund_link':
      return 'Link as refund';
    case 'transfer_twin':
      return 'Confirm transfer';
    case 'duplicate':
      return 'Mark duplicate';
    default:
      return null;
  }
}
