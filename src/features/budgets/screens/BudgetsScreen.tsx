import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, showDialog, showSnackbar } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui/HeaderBackButton';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { useBudgetsStore } from '../state/budgetsStore';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useNow } from '../../../shared/hooks/useNow';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { categoryLabel } from '../../../domain/categories/category.rules';
import { Budget } from '../../../domain/budgets/budget.types';
import {
  BudgetProgress,
  categoryBudgetProgress,
  currentMonthRange,
  findOverallBudget,
  overallBudgetProgress,
  visibleCategoryBudgets,
} from '../../../domain/budgets/budget.rules';
import { BudgetBar } from '../components/BudgetBar';
import {
  budgetStateColors,
  BUDGET_STATE_LABEL,
  leftOrOverLabel,
  spentOfLabel,
} from '../budgetLabels';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function BudgetsScreen() {
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const navigation = useNavigation<Nav>();
  const budgets = useBudgetsStore(state => state.budgets);
  const refresh = useBudgetsStore(state => state.refresh);
  const removeBudget = useBudgetsStore(state => state.removeBudget);
  const setBudget = useBudgetsStore(state => state.setBudget);
  const transactions = useTransactionsStore(state => state.transactions);
  const categories = useTransactionsStore(state => state.categories);
  const now = useNow(budgets.length);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const range = useMemo(() => currentMonthRange(now), [now]);
  const overallBudget = findOverallBudget(budgets);
  const overall = useMemo(
    () => overallBudgetProgress(budgets, transactions, range),
    [budgets, transactions, range],
  );
  const visible = useMemo(() => visibleCategoryBudgets(budgets, categories), [budgets, categories]);
  const categoryProgress = useMemo(
    () => categoryBudgetProgress(visible, transactions, range),
    [visible, transactions, range],
  );

  async function onRemove(budget: Budget) {
    const removed = await removeBudget(budget);
    showSnackbar({
      message: 'Budget removed',
      actionLabel: 'Undo',
      onAction: async () => {
        await setBudget({ categoryId: removed.categoryId, amountMinor: removed.amountMinor });
      },
    });
  }

  function confirmRemove(budget: Budget, label: string) {
    showDialog({
      title: 'Remove budget?',
      message: `Remove the budget for ${label}. You can undo this.`,
      icon: 'gauge-empty',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Remove', variant: 'primary', onPress: () => onRemove(budget) },
      ],
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Budgets</Text>
        <HeaderSpacer />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.monthNote}>This month</Text>

        <OverallCard
          progress={overall}
          onSet={() => navigation.navigate('SetBudget', { scope: 'overall' })}
          onRemove={overallBudget ? () => confirmRemove(overallBudget, 'all spending') : undefined}
        />

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Category budgets</Text>
          <Button
            label="Add budget"
            variant="brand"
            onPress={() => navigation.navigate('SetBudget', { scope: 'category' })}
            icon={<Icon name="plus" size={18} color={pal.onObsidian} />}
          />
        </View>

        {visible.length === 0 ? (
          <Text style={styles.empty}>
            No category budgets yet. Add one to track a category against a monthly cap.
          </Text>
        ) : null}

        {visible.map(budget => {
          const progress = categoryProgress.find(p => p.budgetId === budget.id);
          const category = categories.find(c => c.id === budget.categoryId);
          const label = categoryLabel(category);
          if (!progress) return null;
          const visual = getCategoryVisual(budget.categoryId ?? '', category, pal);
          return (
            <CategoryRow
              key={budget.id}
              label={label}
              icon={visual.icon}
              iconColor={visual.iconColor}
              iconBg={visual.backgroundColor}
              progress={progress}
              onEdit={() =>
                navigation.navigate('SetBudget', {
                  scope: 'category',
                  categoryId: budget.categoryId ?? undefined,
                })
              }
              onRemove={() => confirmRemove(budget, label)}
            />
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function OverallCard({
  progress,
  onSet,
  onRemove,
}: {
  progress: BudgetProgress | null;
  onSet: () => void;
  onRemove?: () => void;
}) {
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  if (!progress) {
    return (
      <Card style={styles.overallCard}>
        <Text style={styles.overallTitle}>Overall monthly budget</Text>
        <Text style={styles.hint}>Set a cap on all your spending this month.</Text>
        <Button label="Set overall budget" variant="brand" onPress={onSet} style={styles.setButton} />
      </Card>
    );
  }
  const palette = budgetStateColors(pal)[progress.state];
  return (
    <Card style={styles.overallCard}>
      <View style={styles.overallTopRow}>
        <Text style={styles.overallTitle}>Overall monthly budget</Text>
        <View style={[styles.statePill, { backgroundColor: palette.bg }]}>
          <Text style={[styles.statePillText, { color: palette.fg }]}>
            {BUDGET_STATE_LABEL[progress.state]}
          </Text>
        </View>
      </View>
      <Text style={styles.overallAmount}>{spentOfLabel(progress.actualMinor, progress.budgetMinor)}</Text>
      <BudgetBar progress={progress} height={10} />
      <Text style={[styles.leftOver, { color: palette.fg }]}>
        {leftOrOverLabel(progress.remainingMinor, progress.overMinor)}
      </Text>
      <View style={styles.actionsRow}>
        <RowAction label="Edit" icon="pencil-outline" onPress={onSet} />
        {onRemove ? <RowAction label="Remove" icon="close" onPress={onRemove} /> : null}
      </View>
    </Card>
  );
}

function CategoryRow({
  label,
  icon,
  iconColor,
  iconBg,
  progress,
  onEdit,
  onRemove,
}: {
  label: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  progress: BudgetProgress;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const palette = budgetStateColors(pal)[progress.state];
  return (
    <Card style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Icon name={icon} size={18} color={iconColor} />
        </View>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.rowState, { color: palette.fg }]}>{BUDGET_STATE_LABEL[progress.state]}</Text>
      </View>
      <BudgetBar progress={progress} />
      <View style={styles.rowBottom}>
        <Text style={styles.rowAmount}>{spentOfLabel(progress.actualMinor, progress.budgetMinor)}</Text>
        <Text style={[styles.rowLeft, { color: palette.fg }]}>
          {leftOrOverLabel(progress.remainingMinor, progress.overMinor)}
        </Text>
      </View>
      <View style={styles.actionsRow}>
        <RowAction label="Edit" icon="pencil-outline" onPress={onEdit} />
        <RowAction label="Remove" icon="close" onPress={onRemove} />
      </View>
    </Card>
  );
}

function RowAction({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  return (
    <Pressable
      onPress={onPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Icon name={icon} size={16} color={pal.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (pal: ColorTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: pal.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerTitle: { ...typography.headlineSm, color: pal.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: spacing.screen, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  monthNote: { ...typography.labelLg, color: pal.outline, letterSpacing: 0.5 },
  overallCard: { gap: spacing.sm },
  overallTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overallTitle: { ...typography.headlineSm, fontSize: 16, color: pal.onSurface, flex: 1 },
  overallAmount: { ...typography.headlineMd, color: pal.onSurface },
  setButton: { marginTop: spacing.sm },
  hint: { ...typography.bodyMd, color: pal.onSurfaceVariant },
  statePill: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statePillText: { ...typography.labelMd },
  leftOver: { ...typography.labelLg },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { ...typography.headlineSm, fontSize: 16, color: pal.onSurface, flex: 1 },
  empty: { ...typography.bodyMd, color: pal.outline },
  row: { gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...typography.labelLg, color: pal.onSurface, flex: 1 },
  rowState: { ...typography.labelMd },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowAmount: { ...typography.bodyMd, color: pal.onSurfaceVariant },
  rowLeft: { ...typography.labelMd },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48, paddingRight: spacing.sm },
  actionLabel: { ...typography.labelLg, color: pal.primary },
});
