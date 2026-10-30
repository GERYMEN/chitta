import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CompositeNavigationProp, RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { PendingTransactionCard } from '../components/PendingTransactionCard';
import { TransactionDetailContent } from '../../transactions/components/TransactionDetailContent';
import { BottomSheet, Button, Chip, showDialog, showSnackbar } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { useShallow } from 'zustand/react/shallow';
import { useTransactionsStore, selectPending } from '../../transactions/state/transactionsStore';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { MainTabParamList, RootStackParamList } from '../../../app/navigation/routes';
import { TransferPair } from '../../../domain/transfers/transfer.rules';
import { useTransferPairs } from '../../transfers/useTransferPairs';
import { TransferPairCard } from '../../transfers/components/TransferPairCard';
import {
  autoApproveButtonState,
  autoApproveConfirmTitle,
  autoApproveEligible,
  groupPendingByAccount,
} from '../pendingGroups';

type Filter = 'all' | 'expense' | 'income';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Pending'>,
  NativeStackNavigationProp<RootStackParamList>
>;
type Route = RouteProp<MainTabParamList, 'Pending'>;

function Separator() {
  return <View style={styles.separator} />;
}

export function PendingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const pending = useTransactionsStore(useShallow(selectPending));
  const accounts = useTransactionsStore(state => state.accounts);
  const approvalMode = useTransactionsStore(state => state.approvalMode);
  const threshold = useTransactionsStore(state => state.autoApproveThreshold);
  const approve = useTransactionsStore(state => state.approve);
  const reject = useTransactionsStore(state => state.reject);
  const refresh = useTransactionsStore(state => state.refresh);

  const [filter, setFilter] = useState<Filter>('all');
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<Transaction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [pairBusy, setPairBusy] = useState(false);
  const allPairs = useTransferPairs();
  // R3a: "Looks like a transfer" — pairs of pending OR approved rows; the
  // account chip narrows them to pairs touching that account.
  const pairs = useMemo(
    () =>
      accountFilter
        ? allPairs.filter(
            p => p.debit.accountId === accountFilter || p.credit.accountId === accountFilter,
          )
        : allPairs,
    [allPairs, accountFilter],
  );

  async function confirmPair(pair: TransferPair) {
    setPairBusy(true);
    try {
      const ok = await useTransactionsStore
        .getState()
        .confirmTransferPair(pair.debit.id, pair.credit.id);
      showSnackbar({ message: ok ? 'Recorded as a transfer' : 'This pair changed — not recorded' });
    } finally {
      setPairBusy(false);
    }
  }

  async function dismissPair(pair: TransferPair) {
    setPairBusy(true);
    try {
      await useTransactionsStore.getState().dismissTransferPair(pair.debit.id, pair.credit.id);
      showSnackbar({ message: 'Kept as separate items' });
    } finally {
      setPairBusy(false);
    }
  }

  // R2b: the Add/Link snackbar's "View" opens Pending filtered to that account.
  const paramAccountId = route.params?.accountId;
  const focusKey = route.params?.focusKey;
  useEffect(() => {
    if (paramAccountId) {
      setAccountFilter(paramAccountId);
      setFilter('all');
    }
  }, [paramAccountId, focusKey]);

  const scoped = useMemo(
    () => (accountFilter ? pending.filter(t => t.accountId === accountFilter) : pending),
    [pending, accountFilter],
  );
  const expenseCount = scoped.filter(t => t.type === 'expense').length;
  const incomeCount = scoped.filter(t => t.type === 'income').length;

  const visible = useMemo(() => {
    if (filter === 'all') return scoped;
    return scoped.filter(t => t.type === filter);
  }, [scoped, filter]);

  const sections = useMemo(() => groupPendingByAccount(visible, accounts), [visible, accounts]);
  const autoState = autoApproveButtonState(approvalMode, threshold, visible);
  const filteredAccount = accountFilter ? accounts.find(a => a.id === accountFilter) : undefined;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  function confirmAutoApprove() {
    const targets = autoApproveEligible(visible, approvalMode, threshold);
    if (targets.length === 0) return;
    showDialog({
      title: autoApproveConfirmTitle(targets.length, autoState.threshold),
      message: 'They will count toward your balances. Lower-confidence items stay in Pending.',
      icon: 'lightning-bolt',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Approve',
          variant: 'primary',
          onPress: async () => {
            setApproving(true);
            try {
              const { autoApproveThreshold } = useTransactionsStore.getState();
              let approved = 0;
              for (const t of targets) {
                await approve(t.id, {
                  confidence: t.confidenceScore ?? 0,
                  threshold: autoApproveThreshold,
                  actor: 'user',
                });
                const after = useTransactionsStore
                  .getState()
                  .transactions.find(x => x.id === t.id);
                if (after?.status === 'approved') approved++;
              }
              showSnackbar({
                message: `Approved ${approved} transaction${approved === 1 ? '' : 's'}`,
              });
            } finally {
              setApproving(false);
            }
          },
        },
      ],
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Pending Transactions</Text>
        <Pressable
          onPress={handleRefresh}
          disabled={refreshing}
          style={styles.refreshButton}
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          testID="pending-refresh">
          <Icon name="refresh" size={24} color={colors.onSurface} />
        </Pressable>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <>
            <Text style={styles.subtitle}>
              Review detected transactions before adding them to your records.
            </Text>

            <View style={styles.summaryCard}>
              <View style={styles.summaryIcon}>
                <Icon name="lightning-bolt" size={20} color={colors.primary} />
              </View>
              <View style={styles.summaryTextWrap}>
                <Text style={styles.summaryTitle}>{pending.length} waiting for approval</Text>
                <Text style={styles.summaryCaption}>
                  Detected · Recorded — parsed via SMS &amp; UPI with zero manual entry.
                </Text>
              </View>
            </View>

            {autoState.visible ? (
              <View style={styles.autoWrap}>
                <Button
                  label={`Auto-approve (${autoState.count})`}
                  variant="brand"
                  disabled={autoState.disabled || approving}
                  loading={approving}
                  onPress={confirmAutoApprove}
                  icon={<Icon name="lightning-bolt" size={16} color={colors.obsidian} />}
                  testID="pending-auto-approve"
                />
                {autoState.hint ? (
                  <Text style={styles.autoHint} testID="pending-auto-approve-hint">
                    {autoState.hint}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.filterRow}>
              {accountFilter ? (
                <Pressable
                  onPress={() => setAccountFilter(null)}
                  style={styles.chipHit}
                  accessibilityRole="button"
                  accessibilityLabel="Show all accounts">
                  <Chip
                    label={`${accountDisplayLabel(filteredAccount)} ✕`}
                    tone="active"
                  />
                </Pressable>
              ) : null}
              <Pressable onPress={() => setFilter('all')} style={styles.chipHit}>
                <Chip label={`All ${scoped.length}`} tone={filter === 'all' ? 'active' : 'neutral'} />
              </Pressable>
              <Pressable onPress={() => setFilter('expense')} style={styles.chipHit}>
                <Chip label={`Expenses ${expenseCount}`} tone={filter === 'expense' ? 'active' : 'neutral'} />
              </Pressable>
              <Pressable onPress={() => setFilter('income')} style={styles.chipHit}>
                <Chip label={`Income ${incomeCount}`} tone={filter === 'income' ? 'active' : 'neutral'} />
              </Pressable>
            </View>

            {pairs.length > 0 ? (
              <View style={styles.pairSection} testID="transfer-pairs-section">
                <Text style={styles.sectionHeader} testID="transfer-pairs-header">
                  Looks like a transfer · {pairs.length}
                </Text>
                <Text style={styles.pairHint}>
                  Money out of one of your accounts and the same amount into another. A transfer
                  moves both balances and is never counted as income or expense.
                </Text>
                {pairs.map(pair => (
                  <TransferPairCard
                    key={`${pair.debit.id}|${pair.credit.id}`}
                    pair={pair}
                    accounts={accounts}
                    busy={pairBusy}
                    onConfirm={confirmPair}
                    onDismiss={dismissPair}
                  />
                ))}
              </View>
            ) : null}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader} testID="pending-section-header">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <PendingTransactionCard
            transaction={item}
            onApprove={t => approve(t.id)}
            onReview={setReviewing}
          />
        )}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {accountFilter
                ? 'Nothing pending for this account.'
                : 'Nothing pending — detected transactions will appear here.'}
            </Text>
          </View>
        }
      />

      <BottomSheet visible={reviewing !== null} onClose={() => setReviewing(null)}>
        {reviewing ? (
          <TransactionDetailContent
            transaction={reviewing}
            variant="sheet"
            onApprove={t => {
              approve(t.id);
              setReviewing(null);
            }}
            onReject={t => {
              reject(t.id);
              setReviewing(null);
            }}
            onEdit={t => {
              setReviewing(null);
              navigation.navigate('EditTransaction', { transactionId: t.id });
            }}
          />
        ) : null}
      </BottomSheet>
    </SafeAreaView>
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
    paddingLeft: spacing.screen,
    paddingRight: spacing.xs,
    paddingTop: spacing.sm,
  },
  refreshButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.screen,
    paddingTop: 0,
    paddingBottom: spacing.xl * 2,
  },
  separator: {
    height: spacing.md,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.onSurface,
    flex: 1,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.outline,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryTextWrap: {
    flex: 1,
  },
  summaryTitle: {
    ...typography.headlineSm,
    fontSize: 15,
    color: colors.onSurface,
  },
  summaryCaption: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  autoWrap: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  autoHint: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    marginBottom: spacing.xs,
  },
  chipHit: {
    minHeight: 48,
    justifyContent: 'center',
  },
  pairSection: {
    gap: spacing.sm,
  },
  pairHint: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  sectionHeader: {
    ...typography.labelLg,
    color: colors.onSurfaceVariant,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
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
});
