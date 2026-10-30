import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, showDialog } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Category } from '../../../domain/categories/category.types';
import {
  canModifyCategory,
  categoryLabel,
  visibleCategories,
} from '../../../domain/categories/category.rules';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { CategoryFormSheet, CategoryFormValues } from '../components/CategoryFormSheet';

const TYPE_LABEL: Record<Category['type'], string> = {
  expense: 'Expense',
  income: 'Income',
  both: 'Expense & income',
};

/**
 * R2 T5: system + custom categories, create / rename / archive, plus the
 * merchant rules list (delete only). Reached from the Home settings sheet.
 */
export function CategoriesScreen() {
  const navigation = useNavigation();
  const categories = useTransactionsStore(state => state.categories);
  const merchantRules = useTransactionsStore(state => state.merchantRules);
  const [form, setForm] = useState<{ editing: Category | null } | null>(null);

  const { custom, system, archived } = useMemo(() => {
    // R3a: the hidden system "Transfer" category is not listed.
    const sorted = visibleCategories(categories).sort((a, b) => a.name.localeCompare(b.name));
    return {
      custom: sorted.filter(c => !c.isSystem && c.archivedAt === null),
      system: sorted.filter(c => c.isSystem),
      archived: sorted.filter(c => !c.isSystem && c.archivedAt !== null),
    };
  }, [categories]);

  const rules = useMemo(
    () =>
      Object.entries(merchantRules)
        .map(([merchantKey, categoryId]) => ({ merchantKey, categoryId }))
        .sort((a, b) => a.merchantKey.localeCompare(b.merchantKey)),
    [merchantRules],
  );

  async function handleSave(values: CategoryFormValues) {
    const store = useTransactionsStore.getState();
    try {
      if (form?.editing) {
        await store.updateCategory(form.editing.id, {
          name: values.name,
          icon: values.icon,
          color: values.color,
        });
      } else {
        await store.addCategory(values);
      }
      setForm(null);
    } catch {
      ToastAndroid.show('Could not save the category — please try again.', ToastAndroid.LONG);
    }
  }

  function confirmArchive(category: Category) {
    setForm(null);
    showDialog({
      title: `Archive ${category.name}?`,
      message:
        'It disappears from category pickers. Items already in it keep it, shown as "(archived)". Nothing is deleted.',
      icon: 'archive-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Archive',
          variant: 'primary',
          onPress: () => useTransactionsStore.getState().archiveCategory(category.id),
        },
      ],
    });
  }

  function confirmDeleteRule(merchantKey: string) {
    showDialog({
      title: 'Remove this merchant rule?',
      message: 'Existing items keep their category. New SMS items from this merchant go to Uncategorised.',
      icon: 'bookmark-remove-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Remove',
          variant: 'destructive',
          onPress: () => useTransactionsStore.getState().deleteMerchantRule(merchantKey),
        },
      ],
    });
  }

  const categoryById = new Map(categories.map(c => [c.id, c]));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Categories</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Button
          label="New category"
          variant="brand"
          icon={<Icon name="plus" size={18} color={colors.obsidian} />}
          onPress={() => setForm({ editing: null })}
          testID="category-new"
        />

        <Section title="Your categories">
          {custom.length === 0 ? (
            <Text style={styles.emptyText}>No custom categories yet.</Text>
          ) : (
            custom.map(category => (
              <CategoryRow
                key={category.id}
                category={category}
                onPress={() => setForm({ editing: category })}
              />
            ))
          )}
        </Section>

        <Section title="System">
          {system.map(category => (
            <CategoryRow key={category.id} category={category} />
          ))}
          <Text style={styles.footnote}>System categories cannot be renamed or archived.</Text>
        </Section>

        {archived.length > 0 ? (
          <Section title="Archived">
            {archived.map(category => (
              <CategoryRow key={category.id} category={category} />
            ))}
          </Section>
        ) : null}

        <Section title="Merchant rules">
          {rules.length === 0 ? (
            <Text style={styles.emptyText}>
              Choose “Always” when you change an item’s category to remember it for that merchant.
            </Text>
          ) : (
            rules.map(rule => (
              <View key={rule.merchantKey} style={styles.row} testID="merchant-rule-row">
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {rule.merchantKey}
                  </Text>
                  <Text style={styles.rowCaption}>
                    Always {categoryLabel(categoryById.get(rule.categoryId))}
                  </Text>
                </View>
                <Pressable
                  onPress={() => confirmDeleteRule(rule.merchantKey)}
                  style={styles.iconButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove rule for ${rule.merchantKey}`}>
                  <Icon name="close-circle-outline" size={22} color={colors.outline} />
                </Pressable>
              </View>
            ))
          )}
        </Section>
      </ScrollView>

      <CategoryFormSheet
        visible={form !== null}
        onClose={() => setForm(null)}
        editing={form?.editing ?? null}
        categories={categories}
        onSave={handleSave}
        onArchive={confirmArchive}
      />
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function CategoryRow({ category, onPress }: { category: Category; onPress?: () => void }) {
  const visual = getCategoryVisual(category.id, category);
  const editable = canModifyCategory(category) && category.archivedAt === null && onPress;
  return (
    <Pressable
      onPress={editable ? onPress : undefined}
      disabled={!editable}
      accessibilityRole={editable ? 'button' : undefined}
      accessibilityLabel={editable ? `Edit ${category.name}` : categoryLabel(category)}
      testID="category-row"
      style={({ pressed }) => [styles.row, pressed && editable ? styles.pressed : null]}>
      <View style={[styles.rowIcon, { backgroundColor: visual.backgroundColor }]}>
        <Icon name={visual.icon} size={20} color={visual.iconColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {categoryLabel(category)}
        </Text>
        <Text style={styles.rowCaption}>{TYPE_LABEL[category.type]}</Text>
      </View>
      {editable ? (
        <Icon name="pencil-outline" size={20} color={colors.outline} />
      ) : category.isSystem ? (
        <Icon name="lock-outline" size={18} color={colors.outline} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  headerSpacer: {
    width: 22,
  },
  content: {
    padding: spacing.screen,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  pressed: {
    opacity: 0.7,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  rowCaption: {
    ...typography.labelMd,
    color: colors.outline,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  footnote: {
    ...typography.labelMd,
    color: colors.outline,
  },
});
