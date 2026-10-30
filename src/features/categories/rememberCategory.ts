import { showDialog, showSnackbar } from '../../shared/ui';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { normalizeMerchant } from '../../domain/merchants/normalizeMerchant';
import { categoryLabel, rememberDecision } from '../../domain/categories/category.rules';

export interface CategoryChangedEvent {
  transactionId: string;
  merchantName: string;
  previousCategoryId: string;
  newCategoryId: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** "Apply to N other <merchant> items?" → one transaction → 5 s Undo. */
function offerApplyToOthers(event: CategoryChangedEvent, categoryName: string) {
  const store = useTransactionsStore.getState();
  const targets = store.ruleTargets(event.merchantName, event.newCategoryId, event.transactionId);
  if (targets.length === 0) return;
  const n = targets.length;
  showDialog({
    title: `Apply to ${n} other ${event.merchantName} ${plural(n, 'item', 'items')}?`,
    message: `${n === 1 ? 'It' : 'They'} will move to ${categoryName}. You can undo for a few seconds.`,
    icon: 'tag-multiple-outline',
    actions: [
      { label: 'Not now', variant: 'ghost' },
      {
        label: `Apply to ${n}`,
        variant: 'primary',
        onPress: async () => {
          const applied = await useTransactionsStore.getState().applyCategoryChanges(targets);
          if (applied.length === 0) return;
          showSnackbar({
            message: `Moved ${applied.length} ${plural(applied.length, 'item', 'items')} to ${categoryName}`,
            actionLabel: 'Undo',
            onAction: () => useTransactionsStore.getState().undoCategoryChanges(applied),
          });
        },
      },
    ],
  });
}

/**
 * R2 T2: called after the user changes one item's category (Edit form,
 * Detail, quick-assign). Asks "Always use <Category> for <merchant>?"; on
 * Always saves the rule (audited 'rule_saved'), then offers apply-to-others.
 * If the rule already points at this category it skips straight to the
 * apply offer. Nothing is asked for Uncategorised or an unchanged category.
 */
export function promptRememberCategory(event: CategoryChangedEvent): void {
  if (event.previousCategoryId === event.newCategoryId) return;
  const store = useTransactionsStore.getState();
  const key = normalizeMerchant(event.merchantName);
  const decision = rememberDecision(key, event.newCategoryId, store.merchantRules[key]);
  if (decision === 'none') return;

  const category = store.categories.find(c => c.id === event.newCategoryId);
  const categoryName = categoryLabel(category);

  if (decision === 'offer-apply-only') {
    offerApplyToOthers(event, categoryName);
    return;
  }

  showDialog({
    title: `Always use ${categoryName} for ${event.merchantName}?`,
    message: 'New SMS items from this merchant will be filed there automatically.',
    icon: 'bookmark-check-outline',
    actions: [
      { label: 'Just this one', variant: 'ghost' },
      {
        label: 'Always',
        variant: 'primary',
        onPress: async () => {
          await useTransactionsStore
            .getState()
            .saveMerchantRule(event.merchantName, event.newCategoryId, event.transactionId);
          offerApplyToOthers(event, categoryName);
        },
      },
    ],
  });
}
