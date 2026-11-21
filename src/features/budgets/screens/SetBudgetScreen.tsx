import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Chip } from '../../../shared/ui';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui/HeaderBackButton';
import { colors, radii, spacing, typography } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { useBudgetsStore } from '../state/budgetsStore';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { pickableCategories, categoryLabel } from '../../../domain/categories/category.rules';
import { budgetedCategoryIds, findCategoryBudget, findOverallBudget, isValidBudgetAmount } from '../../../domain/budgets/budget.rules';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function rupeesToMinor(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

function minorToRupees(minor: number | null): string {
  return minor == null ? '' : (minor / 100).toString();
}

/**
 * R5c (D-d): set or edit the overall monthly budget, or add / edit a
 * per-category budget. `scope: 'overall'` edits the single overall budget;
 * `scope: 'category'` with a categoryId edits that category's amount; without
 * one it adds a budget — pick a category (expense/both only, transfer and
 * income-only excluded, already-budgeted categories excluded, Uncategorised
 * allowed) then an amount.
 */
export function SetBudgetScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'SetBudget'>>();
  const params = route.params;
  const isOverall = params.scope === 'overall';
  const fixedCategoryId = params.scope === 'category' ? params.categoryId ?? null : null;

  const budgets = useBudgetsStore(state => state.budgets);
  const setBudget = useBudgetsStore(state => state.setBudget);
  const categories = useTransactionsStore(state => state.categories);

  const existing = isOverall
    ? findOverallBudget(budgets)
    : fixedCategoryId
    ? findCategoryBudget(budgets, fixedCategoryId)
    : null;

  const choosing = params.scope === 'category' && fixedCategoryId === null;
  const [categoryId, setCategoryId] = useState<string | null>(fixedCategoryId);
  const [amount, setAmount] = useState(minorToRupees(existing?.amountMinor ?? null));
  const [error, setError] = useState<string | null>(null);

  // Expense/both categories not already budgeted (Uncategorised included).
  const choices = useMemo(() => {
    const taken = budgetedCategoryIds(budgets);
    return pickableCategories(categories, 'expense', { includeUncategorised: true }).filter(
      c => !taken.has(c.id),
    );
  }, [budgets, categories]);

  const amountMinor = rupeesToMinor(amount);
  const canSave = isValidBudgetAmount(amountMinor) && (isOverall || categoryId !== null);

  const title = isOverall
    ? existing
      ? 'Edit overall budget'
      : 'Set overall budget'
    : existing
    ? 'Edit budget'
    : 'Add budget';

  async function onSave() {
    if (!isValidBudgetAmount(amountMinor)) {
      setError('Enter an amount greater than ₹0.');
      return;
    }
    if (!isOverall && categoryId === null) {
      setError('Pick a category.');
      return;
    }
    await setBudget({ categoryId: isOverall ? null : categoryId, amountMinor });
    navigation.goBack();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>{title}</Text>
        <HeaderSpacer />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {isOverall ? (
          <Text style={styles.hint}>
            A monthly cap on all your spending this calendar month. Budgets never change your
            balances.
          </Text>
        ) : null}

        {choosing ? (
          <>
            <Text style={styles.label}>Category</Text>
            {choices.length === 0 ? (
              <Text style={styles.hint}>Every category already has a budget.</Text>
            ) : (
              <View style={styles.wrapRow} accessibilityRole="radiogroup">
                {choices.map(category => (
                  <Pressable
                    key={category.id}
                    onPress={() => setCategoryId(category.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: categoryId === category.id }}
                    accessibilityLabel={categoryLabel(category)}
                    testID={`budget-category-${category.id}`}>
                    <Chip
                      label={categoryLabel(category)}
                      tone={categoryId === category.id ? 'active' : 'neutral'}
                    />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : null}

        {!isOverall && fixedCategoryId ? (
          <Text style={styles.label}>
            {categoryLabel(categories.find(c => c.id === fixedCategoryId))}
          </Text>
        ) : null}

        <Text style={styles.label}>Monthly budget (₹)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          placeholderTextColor={colors.outline}
          keyboardType="decimal-pad"
          accessibilityLabel="Monthly budget amount in rupees"
          testID="budget-amount-input"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={existing ? 'Save changes' : 'Save budget'}
          variant="brand"
          onPress={onSave}
          disabled={!canSave}
          style={styles.save}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: spacing.screen, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  hint: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  label: { ...typography.labelLg, color: colors.outline, letterSpacing: 0.5, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: 'center',
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { ...typography.bodyMd, color: colors.error, marginTop: spacing.sm },
  save: { marginTop: spacing.md },
});
