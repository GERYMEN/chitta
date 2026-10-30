import { Category, CategoryKind } from './category.types';
import { Transaction, TransactionType } from '../transactions/transaction.types';
import { normalizeMerchant } from '../merchants/normalizeMerchant';
import { countsTowardIncomeExpense } from '../transactions/transaction.rules';

/**
 * System "Uncategorised" bucket (R2), seeded by migration 5. Type-neutral
 * ('both'): one row serves expense and income, so the nudge, the filter and
 * the rules only ever have to look for a single id.
 */
export const UNCATEGORISED_ID = 'cat-uncategorised';

/**
 * R3a system "Transfer" category (migration 6), type-neutral. Every transfer
 * row uses it. It is hidden from EVERY category picker / filter / the
 * Categories management list, and never counts as Uncategorised.
 */
export const TRANSFER_CATEGORY_ID = 'cat-transfer';

/** Hidden system categories never offered in any picker or list. */
export function isHiddenCategory(category: Pick<Category, 'id'>): boolean {
  return category.id === TRANSFER_CATEGORY_ID;
}

/** Every category a user can see in pickers/filters/management (drops hidden system rows). */
export function visibleCategories<T extends Pick<Category, 'id'>>(categories: ReadonlyArray<T>): T[] {
  return categories.filter(category => !isHiddenCategory(category));
}

/** Colour keys a custom category may use — each maps to theme tokens (categoryVisuals.ts). */
export const CATEGORY_COLOR_KEYS = ['green', 'lime', 'amber', 'slate', 'grey', 'red'] as const;
export type CategoryColorKey = (typeof CATEGORY_COLOR_KEYS)[number];

/** Icons offered when creating/editing a custom category. */
export const CATEGORY_ICON_CHOICES = [
  'shape-outline',
  'cart-outline',
  'silverware-fork-knife',
  'home-outline',
  'car-outline',
  'airplane',
  'medical-bag',
  'school-outline',
  'gift-outline',
  'cellphone',
  'lightning-bolt-outline',
  'movie-outline',
  'dumbbell',
  'paw',
  'cash',
  'briefcase-outline',
] as const;

export const CATEGORY_NAME_MAX = 30;

export function isArchivedCategory(category: Pick<Category, 'archivedAt'>): boolean {
  return category.archivedAt !== null;
}

/** "Food", or "QA Category (archived)" — what every list/detail shows. */
export function categoryLabel(category: Pick<Category, 'name' | 'archivedAt'> | null | undefined): string {
  if (!category) return 'Uncategorised';
  return isArchivedCategory(category) ? `${category.name} (archived)` : category.name;
}

export function categoryFitsType(kind: CategoryKind, type: TransactionType): boolean {
  return kind === 'both' || kind === type;
}

/**
 * Categories a picker offers for a transaction type: never archived ones.
 * `keepId` (the item's current category) stays listed even when archived
 * (if it fits the type), so editing an old item never silently drops it.
 */
export function pickableCategories(
  categories: ReadonlyArray<Category>,
  type: TransactionType,
  options: { keepId?: string | null; includeUncategorised?: boolean } = {},
): Category[] {
  const { keepId = null, includeUncategorised = true } = options;
  return categories.filter(category => {
    if (isHiddenCategory(category)) return false;
    if (!categoryFitsType(category.type, type)) return false;
    if (category.id === keepId) return true;
    if (isArchivedCategory(category)) return false;
    return includeUncategorised || category.id !== UNCATEGORISED_ID;
  });
}

/** System categories (seeded) cannot be renamed or archived. */
export function canModifyCategory(category: Pick<Category, 'isSystem'>): boolean {
  return !category.isSystem;
}

export type CategoryNameError = 'empty' | 'too-long' | 'duplicate' | null;

/** Case-insensitive duplicate check against every category except `selfId`. */
export function validateCategoryName(
  name: string,
  categories: ReadonlyArray<Pick<Category, 'id' | 'name'>>,
  selfId: string | null = null,
): CategoryNameError {
  const trimmed = name.trim();
  if (trimmed === '') return 'empty';
  if (trimmed.length > CATEGORY_NAME_MAX) return 'too-long';
  const lower = trimmed.toLowerCase();
  if (categories.some(c => c.id !== selfId && c.name.trim().toLowerCase() === lower)) {
    return 'duplicate';
  }
  return null;
}

/**
 * Items waiting in the Uncategorised bucket (pending + approved). R3a:
 * transfers and transfer twins are never Uncategorised.
 */
export function uncategorisedItems<
  T extends Pick<Transaction, 'categoryId' | 'status'> &
    Partial<Pick<Transaction, 'type' | 'linkKind'>>,
>(transactions: ReadonlyArray<T>): T[] {
  return transactions.filter(
    t =>
      t.categoryId === UNCATEGORISED_ID &&
      (t.status === 'pending' || t.status === 'approved') &&
      (t.type === undefined || countsTowardIncomeExpense({ type: t.type, linkKind: t.linkKind })),
  );
}

export interface CategoryChange {
  id: string;
  accountId: string;
  fromCategoryId: string;
  toCategoryId: string;
}

/**
 * "Apply to N other <merchant> items?": other pending/approved items with the
 * same merchant key whose category differs from the target. Items already in
 * the target category are not counted — applying would not change them.
 */
export function ruleApplyTargets(
  transactions: ReadonlyArray<
    Pick<Transaction, 'id' | 'accountId' | 'merchantName' | 'categoryId' | 'status'> &
      Partial<Pick<Transaction, 'type' | 'linkKind'>>
  >,
  merchantKey: string,
  categoryId: string,
  excludeId: string | null,
): CategoryChange[] {
  if (merchantKey === '') return [];
  return transactions
    .filter(
      t =>
        t.id !== excludeId &&
        (t.status === 'pending' || t.status === 'approved') &&
        // R3a: a merchant rule never re-files a transfer or a transfer twin.
        (t.type === undefined || countsTowardIncomeExpense({ type: t.type, linkKind: t.linkKind })) &&
        t.categoryId !== categoryId &&
        normalizeMerchant(t.merchantName) === merchantKey,
    )
    .map(t => ({
      id: t.id,
      accountId: t.accountId,
      fromCategoryId: t.categoryId,
      toCategoryId: categoryId,
    }));
}

/** The exact inverse of an apply — Undo restores each item's previous id. */
export function invertChanges(changes: ReadonlyArray<CategoryChange>): CategoryChange[] {
  return changes.map(change => ({
    id: change.id,
    accountId: change.accountId,
    fromCategoryId: change.toCategoryId,
    toCategoryId: change.fromCategoryId,
  }));
}

export type RememberDecision = 'ask-always' | 'offer-apply-only' | 'none';

/**
 * After a user changes an item's category: ask "Always use…?" unless the
 * rule already says so (then only offer apply-to-others), and never for
 * Uncategorised or an empty merchant key.
 */
export function rememberDecision(
  merchantKey: string,
  newCategoryId: string,
  existingRuleCategoryId: string | undefined,
): RememberDecision {
  if (merchantKey === '' || newCategoryId === UNCATEGORISED_ID) return 'none';
  return existingRuleCategoryId === newCategoryId ? 'offer-apply-only' : 'ask-always';
}
