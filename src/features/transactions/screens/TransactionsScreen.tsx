import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomSheet, Card, Chip, TransactionRow } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useShallow } from 'zustand/react/shallow';
import {
  useTransactionsStore,
  selectActiveAccounts,
  selectApproved,
  selectDeletedAccounts,
} from '../state/transactionsStore';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import {
  filterTransactions,
  hasActiveFilters,
  totalsFor,
  TypeFilter,
  typeCounts,
} from '../filters/transactionFilters';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { RootStackParamList } from '../../../app/navigation/routes';
import {
  categoryLabel,
  isArchivedCategory,
  visibleCategories,
} from '../../../domain/categories/category.rules';
import { incomeExpenseTotals, isLinkedRefund } from '../../../domain/transactions/transaction.rules';
import { transferRowSubtitle } from '../../transfers/transferLabels';
import { UncategorisedCard } from '../../categories/components/UncategorisedCard';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function dayKey(iso: string): string {
  const date = new Date(iso);
  return date.toDateString();
}

/** Fixture "today" — Milestone 2 replaces this with the real device clock. */
const NOW = new Date('2026-10-01T23:59:00.000Z');

function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (dayKey(iso) === dayKey(now.toISOString())) return 'TODAY';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'YESTERDAY';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase();
}

type Picker = 'account' | 'category' | null;

export function TransactionsScreen() {
  const navigation = useNavigation<Nav>();
  const approved = useTransactionsStore(useShallow(selectApproved));
  const activeAccountList = useTransactionsStore(useShallow(selectActiveAccounts));
  const deletedAccountList = useTransactionsStore(useShallow(selectDeletedAccounts));
  const accounts = useTransactionsStore(state => state.accounts);
  const categories = useTransactionsStore(state => state.categories);
  const filters = useTransactionsStore(state => state.transactionFilters);
  const setFilters = useTransactionsStore(state => state.setTransactionFilters);
  const resetFilters = useTransactionsStore(state => state.resetTransactionFilters);
  const [picker, setPicker] = useState<Picker>(null);

  // One pure predicate (transactionFilters.ts) drives the list, the chip
  // counts and the totals, so all three always agree.
  const filtered = useMemo(() => filterTransactions(approved, filters), [approved, filters]);
  const counts = useMemo(() => typeCounts(approved, filters), [approved, filters]);
  const totals = totalsFor(filtered);
  const filtering = hasActiveFilters(filters);

  const selectedAccount = accounts.find(a => a.id === filters.accountId) ?? null;
  const selectedCategory = categories.find(c => c.id === filters.categoryId) ?? null;
  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  // Filters are for finding things, so archived categories stay filterable —
  // listed under their own heading, like deleted accounts.
  // R3a: the hidden system "Transfer" category is never offered (use the Transfers chip).
  const activeCategoryList = useMemo(
    () => visibleCategories(categories).filter(c => !isArchivedCategory(c)),
    [categories],
  );
  const archivedCategoryList = useMemo(
    () => visibleCategories(categories).filter(isArchivedCategory),
    [categories],
  );
  const accountChipLabel = selectedAccount
    ? selectedAccount.lastFour
      ? `${selectedAccount.name} ••${selectedAccount.lastFour}`
      : selectedAccount.name
    : 'Account';

  function chooseType(type: TypeFilter) {
    setFilters({ type });
  }

  const sections = useMemo(() => {
    const byDay = new Map<string, typeof filtered>();
    for (const transaction of filtered) {
      const key = dayKey(transaction.occurredAt);
      const list = byDay.get(key) ?? [];
      list.push(transaction);
      byDay.set(key, list);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => new Date(b[1][0].occurredAt).getTime() - new Date(a[1][0].occurredAt).getTime())
      .map(([, data]) => ({
        title: dayLabel(data[0].occurredAt, NOW),
        // R3a: transfers never move a day's net (single income/expense rule).
        netMinor: incomeExpenseTotals(data).netMinor,
        data,
      }));
  }, [filtered]);


  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Transactions</Text>
            <Text style={styles.subtitle}>
              {filtering
                ? `Showing ${filtered.length} of ${approved.length} settled`
                : `${approved.length} Settled · All Verified`}
            </Text>

            <UncategorisedCard
              style={styles.nudge}
              onPress={() => navigation.navigate('Uncategorised')}
            />

            <Card style={styles.summaryCard}>
              <SummaryStat label="INFLOW" value={formatRupeesFromMinor(totals.inflowMinor)} tone="income" />
              <View style={styles.summaryDivider} />
              <SummaryStat label="SPENT" value={formatRupeesFromMinor(totals.spentMinor)} tone="expense" />
              <View style={styles.summaryDivider} />
              <SummaryStat label="NET" value={formatRupeesFromMinor(totals.netMinor, { showPositiveSign: true })} tone="net" />
            </Card>
            {filtering ? (
              <Text style={styles.totalsNote} testID="filtered-totals-note">
                Totals reflect the current filters
              </Text>
            ) : null}

            <View style={styles.searchBar}>
              <Icon name="magnify" size={18} color={colors.outline} />
              <TextInput
                placeholder="Search merchant or notes"
                placeholderTextColor={colors.outline}
                value={filters.query}
                onChangeText={query => setFilters({ query })}
                style={styles.searchInput}
                testID="transactions-search"
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              keyboardShouldPersistTaps="handled">
              <FilterChip
                testID="filter-all"
                label={`All ${counts.all}`}
                active={filters.type === 'all'}
                onPress={() => chooseType('all')}
              />
              <FilterChip
                testID="filter-expense"
                label={`Expenses ${counts.expense}`}
                active={filters.type === 'expense'}
                onPress={() => chooseType('expense')}
              />
              <FilterChip
                testID="filter-income"
                label={`Income ${counts.income}`}
                active={filters.type === 'income'}
                onPress={() => chooseType('income')}
              />
              <FilterChip
                testID="filter-transfer"
                label={`Transfers ${counts.transfer}`}
                active={filters.type === 'transfer'}
                onPress={() => chooseType('transfer')}
              />
              <FilterChip
                testID="filter-account"
                label={accountChipLabel}
                icon="bank-outline"
                active={filters.accountId !== null}
                onPress={() => setPicker('account')}
              />
              <FilterChip
                testID="filter-category"
                label={selectedCategory ? categoryLabel(selectedCategory) : 'Category'}
                icon="shape-outline"
                active={filters.categoryId !== null}
                onPress={() => setPicker('category')}
              />
              {filtering ? (
                <FilterChip
                  testID="filter-reset"
                  label="Reset"
                  icon="filter-remove-outline"
                  active={false}
                  onPress={resetFilters}
                />
              ) : null}
            </ScrollView>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {filtering
                ? 'No transactions match these filters.'
                : 'No approved transactions yet — approve items in Pending to see them here.'}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Chip
              label={`Net ${formatRupeesFromMinor(section.netMinor, { showPositiveSign: true })}`}
              tone="neutral"
            />
          </View>
        )}
        renderItem={({ item }) => {
          const visual = getCategoryVisual(item.categoryId, categoryById.get(item.categoryId));
          return (
            <TransactionRow
              merchantName={item.merchantName}
              subtitle={
                item.type === 'transfer'
                  ? transferRowSubtitle(item, accounts, filters.accountId)
                  : formatTransactionTimestamp(item.occurredAt)
              }
              amountMinor={item.amountMinor}
              type={item.type}
              status={item.status}
              tag={isLinkedRefund(item) ? 'Refund' : null}
              icon={<Icon name={visual.icon} size={22} color={visual.iconColor} />}
              onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })}
            />
          );
        }}
      />

      <BottomSheet visible={picker === 'account'} onClose={() => setPicker(null)}>
        <Text style={styles.sheetTitle}>Filter by account</Text>
        <PickerOption
          label="All accounts"
          selected={filters.accountId === null}
          onPress={() => {
            setFilters({ accountId: null });
            setPicker(null);
          }}
        />
        {activeAccountList.map(account => (
          <PickerOption
            key={account.id}
            label={accountDisplayLabel(account)}
            selected={filters.accountId === account.id}
            onPress={() => {
              setFilters({ accountId: account.id });
              setPicker(null);
            }}
          />
        ))}
        {deletedAccountList.length > 0 ? (
          <Text style={styles.sheetHeading}>Deleted</Text>
        ) : null}
        {deletedAccountList.map(account => (
          <PickerOption
            key={account.id}
            label={accountDisplayLabel(account)}
            selected={filters.accountId === account.id}
            onPress={() => {
              setFilters({ accountId: account.id });
              setPicker(null);
            }}
          />
        ))}
      </BottomSheet>

      <BottomSheet visible={picker === 'category'} onClose={() => setPicker(null)}>
        <Text style={styles.sheetTitle}>Filter by category</Text>
        <PickerOption
          label="All categories"
          selected={filters.categoryId === null}
          onPress={() => {
            setFilters({ categoryId: null });
            setPicker(null);
          }}
        />
        {activeCategoryList.map(category => (
          <PickerOption
            key={category.id}
            label={category.name}
            selected={filters.categoryId === category.id}
            onPress={() => {
              setFilters({ categoryId: category.id });
              setPicker(null);
            }}
          />
        ))}
        {archivedCategoryList.length > 0 ? (
          <Text style={styles.sheetHeading}>Archived</Text>
        ) : null}
        {archivedCategoryList.map(category => (
          <PickerOption
            key={category.id}
            label={categoryLabel(category)}
            selected={filters.categoryId === category.id}
            onPress={() => {
              setFilters({ categoryId: category.id });
              setPicker(null);
            }}
          />
        ))}
      </BottomSheet>
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
  icon,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={testID}>
      <Chip
        label={label}
        tone={active ? 'active' : 'neutral'}
        icon={
          icon ? (
            <Icon name={icon} size={14} color={active ? colors.onObsidian : colors.onSurfaceVariant} />
          ) : undefined
        }
      />
    </Pressable>
  );
}

function PickerOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}>
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={20} color={colors.primary} /> : null}
    </Pressable>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'income' | 'expense' | 'net';
}) {
  const color = tone === 'income' ? colors.primary : tone === 'expense' ? colors.onSurface : colors.primary;
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: spacing.screen,
    paddingBottom: spacing.xl * 2,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.outline,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  nudge: {
    marginBottom: spacing.md,
  },
  summaryCard: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  summaryStat: {
    flex: 1,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.sm,
  },
  summaryLabel: {
    ...typography.labelMd,
    color: colors.outline,
  },
  summaryValue: {
    ...typography.headlineSm,
    fontSize: 18,
    marginTop: spacing.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.full,
    height: 48,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyLg,
    color: colors.onSurface,
    padding: 0,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  totalsNote: {
    ...typography.labelMd,
    color: colors.outline,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
  },
  sheetTitle: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  sheetHeading: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    gap: spacing.sm,
  },
  optionPressed: {
    opacity: 0.6,
  },
  optionLabel: {
    ...typography.bodyLg,
    color: colors.onSurface,
    flex: 1,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
  },
});
