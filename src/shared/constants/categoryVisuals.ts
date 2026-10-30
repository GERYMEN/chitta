import { colors } from '../../theme';
import { transactionStateColors } from '../../theme/colors';
import type { Category } from '../../domain/categories/category.types';
import type { CategoryColorKey } from '../../domain/categories/category.rules';

export interface CategoryVisual {
  icon: string;
  iconColor: string;
  backgroundColor: string;
}

const DEFAULT_VISUAL: CategoryVisual = {
  icon: 'file-document-outline',
  iconColor: colors.onSurfaceVariant,
  backgroundColor: colors.surfaceContainerHigh,
};

const CATEGORY_VISUALS: Record<string, CategoryVisual> = {
  'cat-food': {
    icon: 'silverware-fork-knife',
    iconColor: colors.onTertiaryContainer,
    backgroundColor: '#FBE3C2',
  },
  'cat-shopping': {
    icon: 'shopping-outline',
    iconColor: colors.onSurfaceVariant,
    backgroundColor: colors.surfaceContainerHigh,
  },
  'cat-transport': {
    icon: 'car-outline',
    iconColor: colors.onSurfaceVariant,
    backgroundColor: colors.surfaceContainerHigh,
  },
  'cat-coffee': {
    icon: 'coffee-outline',
    iconColor: colors.onTertiaryContainer,
    backgroundColor: '#FBE3C2',
  },
  'cat-salary': {
    icon: 'bank-outline',
    iconColor: colors.primary,
    backgroundColor: colors.primaryContainer + '33',
  },
  'cat-freelance': {
    icon: 'laptop',
    iconColor: colors.primary,
    backgroundColor: colors.primaryContainer + '33',
  },
  'cat-uncategorised': {
    icon: 'help-circle-outline',
    iconColor: transactionStateColors.pending.fg,
    backgroundColor: transactionStateColors.pending.bg,
  },
};

/** R2 custom-category colours — every pair is an existing theme token. */
export const CATEGORY_COLOR_SWATCHES: Record<CategoryColorKey, { fg: string; bg: string }> = {
  green: { fg: colors.primary, bg: transactionStateColors.approved.bg },
  lime: { fg: colors.onPrimaryFixedVariant, bg: colors.primaryFixed },
  amber: { fg: colors.onTertiaryContainer, bg: colors.tertiaryFixed },
  slate: { fg: colors.onSurfaceVariant, bg: colors.surfaceContainerHigh },
  grey: { fg: colors.onSecondaryFixedVariant, bg: colors.secondaryFixed },
  red: { fg: colors.onErrorContainer, bg: colors.errorContainer },
};

/**
 * Built-in categories use the fixed visuals above; a custom category uses its
 * own icon + colour key. Unknown ids fall back to a neutral document icon.
 */
export function getCategoryVisual(
  categoryId: string,
  category?: Pick<Category, 'icon' | 'color'> | null,
): CategoryVisual {
  const builtIn = CATEGORY_VISUALS[categoryId];
  if (builtIn) return builtIn;
  if (category) {
    const swatch =
      category.color && category.color in CATEGORY_COLOR_SWATCHES
        ? CATEGORY_COLOR_SWATCHES[category.color as CategoryColorKey]
        : { fg: DEFAULT_VISUAL.iconColor, bg: DEFAULT_VISUAL.backgroundColor };
    return { icon: category.icon, iconColor: swatch.fg, backgroundColor: swatch.bg };
  }
  return DEFAULT_VISUAL;
}
