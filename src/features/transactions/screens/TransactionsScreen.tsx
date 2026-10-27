import React, { useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Chip, TransactionRow } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useShallow } from 'zustand/react/shallow';
import { useTransactionsStore, selectApproved } from '../state/transactionsStore';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { RootStackParamList } from '../../../app/navigation/routes';

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

export function TransactionsScreen() {
  const navigation = useNavigation<Nav>();
  const approved = useTransactionsStore(useShallow(selectApproved));
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      approved.filter(t =>
        t.merchantName.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [approved, query],
  );

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
        netMinor: data.reduce((sum, t) => sum + (t.type === 'income' ? t.amountMinor : -t.amountMinor), 0),
        data,
      }));
  }, [filtered]);

  const inflow = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amountMinor, 0);
  const spent = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amountMinor, 0);

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
            <Text style={styles.subtitle}>{approved.length} Settled · All Verified</Text>

            <Card style={styles.summaryCard}>
              <SummaryStat label="INFLOW" value={formatRupeesFromMinor(inflow)} tone="income" />
              <View style={styles.summaryDivider} />
              <SummaryStat label="SPENT" value={formatRupeesFromMinor(spent)} tone="expense" />
              <View style={styles.summaryDivider} />
              <SummaryStat label="NET" value={formatRupeesFromMinor(inflow - spent, { showPositiveSign: true })} tone="net" />
            </Card>

            <View style={styles.searchBar}>
              <Icon name="magnify" size={18} color={colors.outline} />
              <TextInput
                placeholder="Search by merchant, tag, note..."
                placeholderTextColor={colors.outline}
                value={query}
                onChangeText={setQuery}
                style={styles.searchInput}
              />
            </View>

            <View style={styles.filterRow}>
              <Chip label={`All ${approved.length}`} tone="active" />
              <Chip label={`Expenses ${approved.filter(t => t.type === 'expense').length}`} tone="neutral" />
              <Chip label={`Income ${approved.filter(t => t.type === 'income').length}`} tone="neutral" />
            </View>
          </>
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
          const visual = getCategoryVisual(item.categoryId);
          return (
            <TransactionRow
              merchantName={item.merchantName}
              subtitle={formatTransactionTimestamp(item.occurredAt)}
              amountMinor={item.amountMinor}
              type={item.type}
              status={item.status}
              icon={<Icon name={visual.icon} size={22} color={visual.iconColor} />}
              onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })}
            />
          );
        }}
      />
    </SafeAreaView>
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
    marginBottom: spacing.sm,
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
