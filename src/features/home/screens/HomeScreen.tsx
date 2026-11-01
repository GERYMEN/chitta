import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { BalanceCard } from '../components/BalanceCard';
import { StatTile } from '../components/StatTile';
import { PendingTransactionCard } from '../../pending/components/PendingTransactionCard';
import { TransactionRow, showDialog } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import {
  useTransactionsStore,
  selectPending,
  selectApproved,
  selectActiveAccounts,
} from '../../transactions/state/transactionsStore';
import { calculateBalance } from '../../../domain/accounts/account.rules';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { canFastApprove, isLinkedRefund } from '../../../domain/transactions/transaction.rules';
import { ReviewCard } from '../../review/components/ReviewCard';
import { transferRowSubtitle } from '../../transfers/transferLabels';
import { SmsSyncError } from '../../sms-sync/syncSms';
import { runSmsSync, useSyncRunStore } from '../../sms-sync/syncRunner';
import type { SyncWindow } from '../../../domain/settings/smsSyncStart.rules';
import { formatSyncToast } from '../../sms-sync/syncToast';
import { greetingFor } from '../../profile/utils/greeting';
import { ProfileSettingsSheet } from '../../profile/components/ProfileSettingsSheet';
import { UncategorisedCard } from '../../categories/components/UncategorisedCard';
import { MainTabParamList, RootStackParamList } from '../../../app/navigation/routes';
import {
  periodTotals,
  spendByCategory,
} from '../../../domain/insights/insights.rules';
import { categoryFilterFor } from '../../transactions/filters/transactionFilters';
import { PeriodSelector } from '../../insights/components/PeriodSelector';
import { PeriodNotices } from '../../insights/components/PeriodNotices';
import { WhereItWentCard } from '../../insights/components/WhereItWentCard';
import { useSelectedPeriod, usePeriodNotices } from '../../insights/hooks/usePeriod';
import { formatMonthYear, PERIOD_CAPTION } from '../../insights/insightLabels';
import { useRedacted } from '../../../shared/privacy/redaction';
import { registerTourScroller, useTourTarget } from '../../tour/tourTargets';
import { replayTour } from '../../tour/tourStore';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const transactions = useTransactionsStore(state => state.transactions);
  const accounts = useTransactionsStore(useShallow(selectActiveAccounts));
  const allAccounts = useTransactionsStore(state => state.accounts);
  const approve = useTransactionsStore(state => state.approve);
  const pending = useTransactionsStore(useShallow(selectPending));
  const approved = useTransactionsStore(useShallow(selectApproved));
  const userName = useTransactionsStore(state => state.userName);
  const categories = useTransactionsStore(state => state.categories);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // R4c: the tour scrolls Home so a target is visible, and spotlights the
  // period chips.
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const periodTargetRef = useTourTarget('home.periods');
  useEffect(
    () =>
      registerTourScroller('Home', {
        scrollBy: dy =>
          scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + dy), animated: true }),
      }),
    [],
  );
  // R4b: live scan progress (counts only) for the Balance card.
  const syncRunning = useSyncRunStore(state => state.running);
  const syncScanned = useSyncRunStore(state => state.scanned);
  const syncTotal = useSyncRunStore(state => state.total);
  const syncCancelling = useSyncRunStore(state => state.cancelRequested);
  const cancelSync = useSyncRunStore(state => state.cancel);
  // R4c: the user's name (greeting + avatar initial) and every amount are
  // masked while the feedback screenshot is taken.
  const redacted = useRedacted();
  const shownName = redacted ? '' : userName;
  const greeting = greetingFor(new Date(), shownName);
  const avatarInitial = shownName.trim().charAt(0).toUpperCase();

  // R4: the selected period (shared with Transactions) + this screen's
  // injected now (device clock, refreshed on focus).
  const { period, setPeriod, now, range } = useSelectedPeriod();
  const { earliestApprovedAt, pendingCount } = usePeriodNotices(range);

  // Total balance stays all-time (balances are never period-limited).
  const totalBalanceMinor = accounts
    .filter(account => account.type !== 'credit_card')
    .reduce((sum, account) => sum + calculateBalance(account, transactions, account.id), 0);

  // R4 (fixes B5): the tiles follow the selected period — approved rows in
  // the range only. R3a/R3b: one income/expense rule for every total —
  // transfers and hidden duplicates never count; a linked refund reduces
  // spend instead of counting as income.
  const { incomeMinor: periodIncome, expenseMinor: periodExpense } = useMemo(
    () => periodTotals(transactions, range),
    [transactions, range],
  );
  // R4e: all categories — the donut folds the small ones into "Other".
  const breakdown = useMemo(() => spendByCategory(transactions, range), [transactions, range]);
  const periodCaption = PERIOD_CAPTION[period];

  function openCategory(categoryId: string) {
    useTransactionsStore.getState().setTransactionFilters(categoryFilterFor(categoryId));
    navigation.navigate('Transactions');
  }

  const fastApprovablePending = pending.filter(t => canFastApprove(t.confidenceScore)).slice(0, 2);
  const recent = approved.slice(0, 4);

  /**
   * Normal Sync, or (R4b) a Settings gap scan: `gap.window` is scanned and
   * `gap.onCompleted` (save the new start) runs only if the scan finished.
   */
  async function handleSyncSms(gap?: { window: SyncWindow; onCompleted: () => Promise<void> }) {
    try {
      const result = await runSmsSync(gap ? { window: gap.window } : {});
      if (!result) {
        ToastAndroid.show('A scan is already running.', ToastAndroid.SHORT);
        return;
      }
      if (result.declined) return;
      if (gap) {
        if (result.cancelled) {
          ToastAndroid.show(
            `${formatSyncToast(result)} · start date not changed`,
            ToastAndroid.LONG,
          );
        } else {
          await gap.onCompleted();
          ToastAndroid.show(formatSyncToast(result), ToastAndroid.LONG);
        }
      } else {
        ToastAndroid.show(formatSyncToast(result), ToastAndroid.LONG);
      }
      if (result.suggestions.length > 0) {
        navigation.navigate('SmsSuggestions', { runId: result.suggestionRunId });
      }
    } catch (error) {
      if (error instanceof SmsSyncError) {
        if (error.code === 'permission-denied') {
          showDialog({
            title: 'SMS permission needed',
            message:
              'Allow SMS access to sync transactions. You can grant it the next time you tap Sync SMS.',
            icon: 'message-lock-outline',
            actions: [{ label: 'OK', variant: 'primary' }],
          });
        } else if (error.code === 'permission-permanently-denied') {
          showDialog({
            title: 'SMS permission blocked',
            message:
              'SMS access was denied with "Don\'t ask again". To enable it, open Settings and allow SMS permission for Tracker.',
            icon: 'shield-alert-outline',
            actions: [
              { label: 'Cancel', variant: 'ghost' },
              { label: 'Open Settings', variant: 'primary', onPress: () => Linking.openSettings() },
            ],
          });
        } else if (error.code === 'no-accounts') {
          showDialog({
            title: 'Add an account first',
            message: 'Add a money source before syncing SMS.',
            icon: 'wallet-plus-outline',
            actions: [
              { label: 'Cancel', variant: 'ghost' },
              { label: 'Go to Accounts', variant: 'primary', onPress: () => navigation.navigate('Accounts') },
            ],
          });
        } else {
          ToastAndroid.show('Sync failed — please try again.', ToastAndroid.LONG);
        }
      } else {
        ToastAndroid.show('Sync failed — please try again.', ToastAndroid.LONG);
      }
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={event => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}>
        <Pressable
          style={({ pressed }) => [styles.greetingRow, pressed && styles.pressed]}
          onPress={() => setSettingsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${greeting}. Edit profile and approval settings`}
          testID="home-greeting">
          <View style={styles.avatar}>
            {avatarInitial ? (
              <Text style={styles.avatarText}>{avatarInitial}</Text>
            ) : (
              <Icon name="account-outline" size={22} color={colors.onPrimaryContainer} />
            )}
          </View>
          <View style={styles.greetingTextWrap}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.dateLine}>{formatMonthYear(now)}</Text>
          </View>
          <Icon name="pencil-outline" size={20} color={colors.outline} />
        </Pressable>

      <BalanceCard
        totalBalanceMinor={totalBalanceMinor}
        onAddRecord={() => navigation.navigate('AddRecord')}
        onSyncSms={() => handleSyncSms()}
        syncProgress={
          syncRunning
            ? { scanned: syncScanned, total: syncTotal, cancelling: syncCancelling }
            : null
        }
        onCancelSync={cancelSync}
      />

      <View ref={periodTargetRef} collapsable={false} style={styles.periodBlock}>
        <PeriodSelector value={period} onChange={setPeriod} />
        <PeriodNotices
          range={range}
          earliestApprovedAt={earliestApprovedAt}
          pendingCount={pendingCount}
        />
      </View>

      <View style={styles.statsRow}>
        <StatTile label="INCOME" amountMinor={periodIncome} caption={periodCaption} tone="income" />
        <StatTile label="EXPENSES" amountMinor={periodExpense} caption={periodCaption} tone="expense" />
      </View>

      <UncategorisedCard onPress={() => navigation.navigate('Uncategorised')} />

      <ReviewCard onPress={() => navigation.navigate('Review')} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Pending Approval</Text>
            <View style={styles.waitingBadge}>
              <Text style={styles.waitingBadgeText}>{pending.length} waiting</Text>
            </View>
          </View>
          <Text style={styles.seeAll} onPress={() => navigation.navigate('Pending')}>
            See All →
          </Text>
        </View>

        <View style={styles.infoBanner}>
          <Icon name="message-text-outline" size={18} color={colors.onSurfaceVariant} />
          <Text style={styles.infoBannerText}>
            Detected from SMS & UPI. Approve before recording.
          </Text>
        </View>

        {fastApprovablePending.map(transaction => (
          <PendingTransactionCard
            key={transaction.id}
            transaction={transaction}
            onApprove={t => approve(t.id)}
            onReview={t => navigation.navigate('TransactionDetail', { transactionId: t.id })}
          />
        ))}
      </View>

      <WhereItWentCard
        rows={breakdown}
        categories={categories}
        period={period}
        onPressCategory={openCategory}
        onSeeAll={() => navigation.navigate('Insights')}
      />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <Text style={styles.seeAll} onPress={() => navigation.navigate('Transactions')}>
            View All
          </Text>
        </View>

        {recent.map(transaction => {
          const visual = getCategoryVisual(
            transaction.categoryId,
            categories.find(c => c.id === transaction.categoryId),
          );
          return (
            <TransactionRow
              key={transaction.id}
              merchantName={transaction.merchantName}
              subtitle={
                transaction.type === 'transfer'
                  ? transferRowSubtitle(transaction, allAccounts)
                  : formatTransactionTimestamp(transaction.occurredAt, now)
              }
              amountMinor={transaction.amountMinor}
              type={transaction.type}
              status={transaction.status}
              tag={isLinkedRefund(transaction) ? 'Refund' : null}
              icon={<Icon name={visual.icon} size={22} color={visual.iconColor} />}
              onPress={() =>
                navigation.navigate('TransactionDetail', { transactionId: transaction.id })
              }
            />
          );
        })}
        </View>
      </ScrollView>
      <ProfileSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenActivity={() => {
          setSettingsOpen(false);
          navigation.navigate('Activity');
        }}
        onOpenCategories={() => {
          setSettingsOpen(false);
          navigation.navigate('Categories');
        }}
        onScanGap={(window, onCompleted) => {
          setSettingsOpen(false);
          handleSyncSms({ window, onCompleted });
        }}
        onOpenBackup={() => {
          setSettingsOpen(false);
          navigation.navigate('Backup');
        }}
        onOpenRestore={() => {
          setSettingsOpen(false);
          navigation.navigate('Restore');
        }}
        onReplayTour={() => {
          setSettingsOpen(false);
          scrollRef.current?.scrollTo({ y: 0, animated: false });
          replayTour();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.screen,
    gap: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.7,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.headlineSm,
    color: colors.onPrimaryContainer,
  },
  greetingTextWrap: {
    flex: 1,
  },
  greeting: {
    ...typography.headlineLgMobile,
    color: colors.onSurface,
  },
  dateLine: {
    ...typography.bodyMd,
    color: colors.outline,
    marginTop: spacing.xs,
  },
  periodBlock: {
    gap: spacing.xs,
    marginBottom: -spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  waitingBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  waitingBadgeText: {
    ...typography.labelMd,
    color: '#B7791F',
  },
  seeAll: {
    ...typography.labelLg,
    color: colors.primary,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 12,
    padding: spacing.md,
  },
  infoBannerText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    flex: 1,
  },
});
