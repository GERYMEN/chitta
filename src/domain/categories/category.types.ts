export type CategoryKind = 'income' | 'expense' | 'both';

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  type: CategoryKind;
  icon: string;
  isSystem: boolean;
  /** R2: archived categories are hidden from pickers; items keep the label. */
  archivedAt: string | null;
  /** R2: theme colour key (CATEGORY_COLOR_KEYS) for custom categories; null = built-in visual. */
  color: string | null;
}

/** R2: normalized merchant key → category the user chose "Always" for. */
export interface MerchantRule {
  merchantKey: string;
  categoryId: string;
  createdAt: string;
  updatedAt: string;
}
