import React, { useState } from 'react';
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
import { canFastApprove } from '../../../domain/transactions/transaction.rules';
import { syncSms, SmsSyncError } from '../../sms-sync/syncSms';
import { formatSyncToast } from '../../sms-sync/syncToast';
import { greetingFor } from '../../profile/utils/greeting';
import { ProfileSettingsSheet } from '../../profile/components/ProfileSettingsSheet';
import { MainTabParamList, RootStackParamList } from '../../../app/navigation/routes';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const transactions = useTransactionsStore(state => state.transactions);
  const accounts = useTransactionsStore(useShallow(selectActiveAccounts));
  const approve = useTransactionsStore(state => state.approve);
  const pending = useTransactionsStore(useShallow(selectPending));
  const approved = useTransactionsStore(useShallow(selectApproved));
  const userName = useTransactionsStore(state => state.userName);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const greeting = greetingFor(new Date(), userName);
  const avatarInitial = userName.trim().charAt(0).toUpperCase();

  const totalBalanceMinor = accounts
    .filter(account => account.type !== 'credit_card')
    .reduce((sum, account) => sum + calculateBalance(account, transactions, account.id), 0);

  const monthIncome = approved
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amountMinor, 0);
  const monthExpense = approved
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amountMinor, 0);

  const fastApprovablePending = pending.filter(t => canFastApprove(t.confidenceScore)).slice(0, 2);
  const recent = approved.slice(0, 4);

  async function handleSyncSms() {
    try {
      const result = await syncSms();
      ToastAndroid.show(formatSyncToast(result), ToastAndroid.LONG);
      if (result.suggestions.length > 0) {
        navigation.navigate('SmsSuggestions', { suggestions: result.suggestions });
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
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
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
            <Text style={styles.dateLine}>October 2026</Text>
          </View>
          <Icon name="pencil-outline" size={20} color={colors.outline} />
        </Pressable>

      <BalanceCard
        totalBalanceMinor={totalBalanceMinor}
        onAddRecord={() => navigation.navigate('AddRecord')}
        onSyncSms={handleSyncSms}
      />

      <View style={styles.statsRow}>
        <StatTile label="INCOME" amountMinor={monthIncome} caption="This month" tone="income" />
        <StatTile label="EXPENSES" amountMinor={monthExpense} caption="This month" tone="expense" />
      </View>

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

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <Text style={styles.seeAll} onPress={() => navigation.navigate('Transactions')}>
            View All
          </Text>
        </View>

        {recent.map(transaction => {
          const visual = getCategoryVisual(transaction.categoryId);
          return (
            <TransactionRow
              key={transaction.id}
              merchantName={transaction.merchantName}
              subtitle={formatTransactionTimestamp(transaction.occurredAt)}
              amountMinor={transaction.amountMinor}
              type={transaction.type}
              status={transaction.status}
              icon={<Icon name={visual.icon} size={22} color={visual.iconColor} />}
              onPress={() =>
                navigation.navigate('TransactionDetail', { transactionId: transaction.id })
              }
            />
          );
        })}
        </View>
      </ScrollView>
      <ProfileSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
