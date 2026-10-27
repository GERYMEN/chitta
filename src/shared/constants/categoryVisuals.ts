import { colors } from '../../theme';

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
};

export function getCategoryVisual(categoryId: string): CategoryVisual {
  return CATEGORY_VISUALS[categoryId] ?? DEFAULT_VISUAL;
}
