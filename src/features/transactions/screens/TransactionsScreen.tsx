import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomSheet, Card, Chip, TransactionRow } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { useShallow } from 'zustand/react/shallow';
import {
  useTransactionsStore,
  selectActiveAccounts,
  selectApproved,
  selectDeletedAccounts,
} from '../state/transactionsStore';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import {
  canResetFilters,
  DEFAULT_TRANSACTION_FILTERS,
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
import { isLinkedRefund } from '../../../domain/transactions/transaction.rules';
import { transferRowSubtitle } from '../../transfers/transferLabels';
import { UncategorisedCard } from '../../categories/components/UncategorisedCard';
import { buildDaySections } from '../daySections';
import { PeriodSelector } from '../../insights/components/PeriodSelector';
import { PeriodNotices } from '../../insights/components/PeriodNotices';
import { useSelectedPeriod, usePeriodNotices } from '../../insights/hooks/usePeriod';
import {
  merchantFilterChipLabel,
  PERIOD_CAPTION,
  periodPhrase,
} from '../../insights/insightLabels';
import { redactLast4, redactText, useRedacted } from '../../../shared/privacy/redaction';
import { TourTarget } from '../../tour/components/TourTarget';
import { ALL_AUTO_TAGS } from '../../../domain/tags/tag.rules';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Picker = 'account' | 'category' | 'tag' | null;

export function TransactionsScreen() {
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const navigation = useNavigation<Nav>();
  // R4c: totals, day nets, merchant chip, search text and last-4 masked in
  // the feedback screenshot (rows mask themselves).
  const redacted = useRedacted();
  const approved = useTransactionsStore(useShallow(selectApproved));
  const activeAccountList = useTransactionsStore(useShallow(selectActiveAccounts));
  const deletedAccountList = useTransactionsStore(useShallow(selectDeletedAccounts));
  const accounts = useTransactionsStore(state => state.accounts);
  const categories = useTransactionsStore(state => state.categories);
  const filters = useTransactionsStore(state => state.transactionFilters);
  const setFilters = useTransactionsStore(state => state.setTransactionFilters);
  const resetFilters = useTransactionsStore(state => state.resetTransactionFilters);
  const customTags = useTransactionsStore(state => state.tags);
  const tagLinks = useTransactionsStore(state => state.tagLinks);
  const [picker, setPicker] = useState<Picker>(null);
  // R4: one injected now (device clock, refreshed on focus) feeds the period
  // range AND the TODAY/YESTERDAY headers (fixes B1); the period is shared
  // with Home through the store.
  const { period, setPeriod, now, range } = useSelectedPeriod();
  const { earliestApprovedAt, pendingCount } = usePeriodNotices(range);

  // One pure predicate (transactionFilters.ts) drives the list, the chip
  // counts and the totals, so all three always agree. R4: it includes the
  // selected period.
  // R11: a custom-tag filter needs each row's custom tag keys; attach them only
  // while a tag filter is on (auto tags derive from the payment method).
  const source = useMemo(() => {
    if (filters.tagKey === null) return approved;
    const keyById = new Map(customTags.map(tag => [tag.id, tag.nameKey]));
    return approved.map(t => ({
      ...t,
      customTagKeys: (tagLinks[t.id] ?? []).flatMap(id => {
        const key = keyById.get(id);
        return key ? [key] : [];
      }),
    }));
  }, [approved, filters.tagKey, customTags, tagLinks]);
  const filtered = useMemo(
    () => filterTransactions(source, filters, range),
    [source, filters, range],
  );
  const counts = useMemo(() => typeCounts(source, filters, range), [source, filters, range]);
  const inPeriodCount = useMemo(
    () => filterTransactions(approved, DEFAULT_TRANSACTION_FILTERS, range).length,
    [approved, range],
  );
  const totals = totalsFor(filtered);
  const filtering = hasActiveFilters(filters);
  const canReset = canResetFilters(filters, period);
  const periodCaption = PERIOD_CAPTION[period];

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
      ? `${selectedAccount.name} ••${redactLast4(selectedAccount.lastFour)}`
      : selectedAccount.name
    : 'Account';

  function chooseType(type: TypeFilter) {
    setFilters({ type });
  }

  // R3a: transfers never move a day's net (single income/expense rule).
  const sections = useMemo(() => buildDaySections(filtered, now), [filtered, now]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <SectionList
        sections={sections}
        extraData={redacted}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Transactions</Text>
            <Text style={styles.subtitle} testID="transactions-subtitle">
              {filtering
                ? `Showing ${filtered.length} of ${inPeriodCount} settled · ${periodCaption}`
                : `${inPeriodCount} Settled · ${periodCaption}`}
            </Text>

            <View style={styles.periodBlock}>
              <PeriodSelector value={period} onChange={setPeriod} />
              <PeriodNotices
                range={range}
                earliestApprovedAt={earliestApprovedAt}
                pendingCount={pendingCount}
              />
            </View>

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

            {/* R4c: tour step 4 spotlights search + filters. */}
            <TourTarget targetKey="transactions.search">
              <View style={styles.searchBar}>
                <Icon name="magnify" size={18} color={pal.outline} />
              <TextInput
                placeholder="Search merchant or notes"
                placeholderTextColor={pal.outline}
                value={redactText(filters.query)}
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
              {filters.merchantKey !== null ? (
                <FilterChip
                  testID="filter-merchant"
                  label={merchantFilterChipLabel(redactText(filters.merchantLabel))}
                  accessibilityLabel={`Merchant filter ${filters.merchantLabel ?? ''}. Remove`}
                  active
                  onPress={() => setFilters({ merchantKey: null, merchantLabel: null })}
                />
              ) : null}
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
              <FilterChip
                testID="filter-tag"
                label={filters.tagLabel ? redactText(filters.tagLabel) : 'Tag'}
                icon="tag-outline"
                active={filters.tagKey !== null}
                onPress={() => setPicker('tag')}
              />
              {canReset ? (
                <FilterChip
                  testID="filter-reset"
                  label="Reset"
                  icon="filter-remove-outline"
                  active={false}
                  onPress={resetFilters}
                />
              ) : null}
              </ScrollView>
            </TourTarget>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {filtering
                ? 'No transactions match these filters.'
                : approved.length === 0
                ? 'No approved transactions yet — approve items in Pending to see them here.'
                : `No settled transactions ${periodPhrase(period)}.`}
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
          const visual = getCategoryVisual(item.categoryId, categoryById.get(item.categoryId), pal);
          return (
            <TransactionRow
              merchantName={item.merchantName}
              subtitle={
                item.type === 'transfer'
                  ? transferRowSubtitle(item, accounts, filters.accountId)
                  : formatTransactionTimestamp(item.occurredAt, now)
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

      <BottomSheet visible={picker === 'tag'} onClose={() => setPicker(null)}>
        <Text style={styles.sheetTitle}>Filter by tag</Text>
        <PickerOption
          label="All tags"
          selected={filters.tagKey === null}
          onPress={() => {
            setFilters({ tagKey: null, tagLabel: null });
            setPicker(null);
          }}
        />
        {ALL_AUTO_TAGS.map(tag => (
          <PickerOption
            key={tag}
            label={tag}
            selected={filters.tagKey === tag}
            onPress={() => {
              setFilters({ tagKey: tag, tagLabel: tag });
              setPicker(null);
            }}
          />
        ))}
        {customTags.length > 0 ? <Text style={styles.sheetHeading}>Your tags</Text> : null}
        {customTags.map(tag => (
          <PickerOption
            key={tag.id}
            label={`#${redactText(tag.name)}`}
            selected={filters.tagKey === tag.nameKey}
            onPress={() => {
              setFilters({ tagKey: tag.nameKey, tagLabel: `#${tag.name}` });
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
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: string;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const pal = useColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}>
      <Chip
        label={label}
        tone={active ? 'active' : 'neutral'}
        icon={
          icon ? (
            <Icon name={icon} size={14} color={active ? pal.onObsidian : pal.onSurfaceVariant} />
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
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}>
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={20} color={pal.primary} /> : null}
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
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const color = tone === 'income' ? pal.primary : tone === 'expense' ? pal.onSurface : pal.primary;
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
    </View>
  );
}

const makeStyles = (pal: ColorTokens) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: pal.surface,
  },
  content: {
    padding: spacing.screen,
    paddingBottom: spacing.xl * 2,
  },
  title: {
    ...typography.headlineLgMobile,
    color: pal.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: pal.outline,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  periodBlock: {
    gap: spacing.xs,
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
    backgroundColor: pal.outlineVariant,
    marginHorizontal: spacing.sm,
  },
  summaryLabel: {
    ...typography.labelMd,
    color: pal.outline,
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
    backgroundColor: pal.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: pal.outlineVariant,
    borderRadius: radii.full,
    height: 48,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyLg,
    color: pal.onSurface,
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
    color: pal.outline,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodyMd,
    color: pal.outline,
    textAlign: 'center',
  },
  sheetTitle: {
    ...typography.headlineSm,
    fontSize: 18,
    color: pal.onSurface,
    marginBottom: spacing.sm,
  },
  sheetHeading: {
    ...typography.labelLg,
    color: pal.outline,
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
    color: pal.onSurface,
    flex: 1,
  },
  optionLabelSelected: {
    color: pal.primary,
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
    color: pal.outline,
    letterSpacing: 0.5,
  },
});
