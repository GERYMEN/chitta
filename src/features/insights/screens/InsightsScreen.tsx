import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, HeaderBackButton, HeaderSpacer } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { ChartBars } from '../../../components/charts/ChartBars';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { categoryFilterFor } from '../../transactions/filters/transactionFilters';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import {
  monthlyTrend,
  periodTotals,
  spendByCategory,
  topCategories,
  trendRange,
} from '../../../domain/insights/insights.rules';
import { MonthBucket } from '../../../domain/insights/insights.types';
import { RootStackParamList } from '../../../app/navigation/routes';
import { PeriodSelector } from '../components/PeriodSelector';
import { PeriodNotices } from '../components/PeriodNotices';
import { CategoryBars } from '../components/CategoryBars';
import { useSelectedPeriod, usePeriodNotices } from '../hooks/usePeriod';
import {
  monthBarA11yLabel,
  monthBarLabel,
  monthDetailTitle,
  noSpendingLabel,
  PARTIAL_MONTH_FOOTNOTE,
  PERIOD_CAPTION,
  trendCaption,
  trendSpanLabel,
} from '../insightLabels';
import { useRedacted } from '../../../shared/privacy/redaction';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Trend colours: spend in the expense ink, income in the positive green (DESIGN.md flow). */
const SPEND_COLOR = colors.onSurface;
const INCOME_COLOR = colors.primary;

/**
 * R4 Insights (stack screen from Home "Where it went → See all", not a tab):
 * period selector, totals, every category, and month-by-month spend vs
 * income. A category bar opens Transactions filtered to it + the period.
 */
export function InsightsScreen() {
  const navigation = useNavigation<Nav>();
  useRedacted(); // R4c: totals + chart labels masked in the feedback screenshot
  const transactions = useTransactionsStore(state => state.transactions);
  const categories = useTransactionsStore(state => state.categories);
  const { period, setPeriod, now, range } = useSelectedPeriod();
  const { earliestApprovedAt, pendingCount } = usePeriodNotices(range);

  const totals = useMemo(() => periodTotals(transactions, range), [transactions, range]);
  // Every category: the "top N" limit is the whole list.
  const allCategories = useMemo(() => {
    const rows = spendByCategory(transactions, range);
    return topCategories(rows, rows.length);
  }, [transactions, range]);
  const trendWindow = useMemo(() => trendRange(period, now), [period, now]);
  const trend = useMemo(() => monthlyTrend(transactions, trendWindow), [transactions, trendWindow]);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const selectedMonth: MonthBucket | null =
    trend.find(bucket => bucket.monthKey === selectedMonthKey) ?? trend[trend.length - 1] ?? null;
  const bucketByKey = useMemo(() => new Map(trend.map(b => [b.monthKey, b])), [trend]);
  const trendData = useMemo(
    () =>
      trend.map(bucket => ({
        key: bucket.monthKey,
        label: monthBarLabel(bucket),
        value: bucket.spendMinor,
        secondaryValue: bucket.incomeMinor,
        color: SPEND_COLOR,
      })),
    [trend],
  );
  const hasPartialMonth = trend.some(bucket => bucket.partial);

  function openCategory(categoryId: string) {
    useTransactionsStore.getState().setTransactionFilters(categoryFilterFor(categoryId));
    navigation.navigate('Tabs', { screen: 'Transactions' });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Insights</Text>
        <HeaderSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.periodBlock}>
          <PeriodSelector value={period} onChange={setPeriod} />
          <PeriodNotices
            range={range}
            earliestApprovedAt={earliestApprovedAt}
            pendingCount={pendingCount}
          />
        </View>

        <Card style={styles.totalsCard} testID="insights-totals">
          <Text style={styles.cardCaption}>{PERIOD_CAPTION[period]}</Text>
          <View style={styles.totalsRow}>
            <Total label="INCOME" value={formatRupeesFromMinor(totals.incomeMinor)} color={colors.primary} />
            <View style={styles.divider} />
            <Total label="SPENT" value={formatRupeesFromMinor(totals.expenseMinor)} color={colors.onSurface} />
            <View style={styles.divider} />
            <Total
              label="NET"
              value={formatRupeesFromMinor(totals.netMinor, { showPositiveSign: true })}
              color={colors.primary}
            />
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Where it went</Text>
          {allCategories.length === 0 ? (
            <Text style={styles.empty} testID="insights-categories-empty">
              {noSpendingLabel(period)}
            </Text>
          ) : (
            <CategoryBars
              rows={allCategories}
              categories={categories}
              onPressRow={row => {
                if (row.categoryId !== null) openCategory(row.categoryId);
              }}
              testID="insights-category-bars"
            />
          )}
        </Card>

        <Card style={styles.card} testID="insights-trends">
          <Text style={styles.cardTitle}>Trends</Text>
          <Text style={styles.cardCaption}>{trendCaption(period)}</Text>
          <View style={styles.legend}>
            <LegendSwatch color={SPEND_COLOR} label="Spent" />
            <LegendSwatch color={INCOME_COLOR} label="Income" />
          </View>
          {selectedMonth ? (
            <View style={styles.selectedMonth} testID="insights-selected-month">
              <Text style={styles.selectedTitle}>{monthDetailTitle(selectedMonth)}</Text>
              <Text style={styles.selectedValues}>
                Spent {formatRupeesFromMinor(selectedMonth.spendMinor)} · Income{' '}
                {formatRupeesFromMinor(selectedMonth.incomeMinor)}
              </Text>
            </View>
          ) : null}
          <ChartBars
            data={trendData}
            orientation="vertical"
            secondaryColor={INCOME_COLOR}
            formatValue={value => formatRupeesFromMinor(value)}
            accessibilityLabelFor={datum => {
              const bucket = bucketByKey.get(datum.key);
              return bucket ? monthBarA11yLabel(bucket) : datum.label;
            }}
            onPressBar={datum => setSelectedMonthKey(datum.key)}
            testID="insights-trend-bars"
          />
          <Text style={styles.cardCaption}>{trendSpanLabel(trend)}</Text>
          {hasPartialMonth ? <Text style={styles.footnote}>{PARTIAL_MONTH_FOOTNOTE}</Text> : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Total({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={[styles.totalValue, { color }]}>{value}</Text>
    </View>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
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
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  content: {
    padding: spacing.screen,
    paddingTop: 0,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  periodBlock: {
    gap: spacing.xs,
  },
  totalsCard: {
    gap: spacing.sm,
  },
  totalsRow: {
    flexDirection: 'row',
  },
  total: {
    flex: 1,
  },
  totalLabel: {
    ...typography.labelMd,
    color: colors.outline,
  },
  totalValue: {
    ...typography.headlineSm,
    fontSize: 18,
    marginTop: spacing.xs,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.sm,
  },
  card: {
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  cardCaption: {
    ...typography.labelMd,
    color: colors.outline,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    ...typography.labelMd,
    color: colors.onSurfaceVariant,
  },
  selectedMonth: {
    gap: 2,
  },
  selectedTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  selectedValues: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  footnote: {
    ...typography.labelSm,
    color: colors.outline,
  },
});
