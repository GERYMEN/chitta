import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { TransactionType } from '../../../domain/transactions/transaction.types';
import { categoryLabel, pickableCategories } from '../../../domain/categories/category.rules';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';

export interface CategoryPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  type: TransactionType;
  selectedId: string | null;
  onSelect: (categoryId: string) => void;
  /** Quick-assign hides Uncategorised (picking it would be a no-op). */
  includeUncategorised?: boolean;
  title?: string;
}

/**
 * Assign-a-category picker (Detail, quick-assign). Archived categories are
 * never offered (pickableCategories); the current one stays visible.
 */
export function CategoryPickerSheet({
  visible,
  onClose,
  type,
  selectedId,
  onSelect,
  includeUncategorised = true,
  title = 'Choose a category',
}: CategoryPickerSheetProps) {
  const categories = useTransactionsStore(state => state.categories);
  const options = useMemo(
    () => pickableCategories(categories, type, { keepId: selectedId, includeUncategorised }),
    [categories, type, selectedId, includeUncategorised],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      {options.map(category => {
        const visual = getCategoryVisual(category.id, category);
        const selected = category.id === selectedId;
        return (
          <Pressable
            key={category.id}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={categoryLabel(category)}
            testID={`category-option-${category.id}`}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
            <View style={[styles.icon, { backgroundColor: visual.backgroundColor }]}>
              <Icon name={visual.icon} size={18} color={visual.iconColor} />
            </View>
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {categoryLabel(category)}
            </Text>
            {selected ? <Icon name="check" size={20} color={colors.primary} /> : null}
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
  },
  pressed: {
    opacity: 0.6,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.bodyLg,
    color: colors.onSurface,
    flex: 1,
  },
  labelSelected: {
    color: colors.primary,
  },
});
