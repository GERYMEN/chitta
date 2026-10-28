import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { PendingTransactionCard } from '../components/PendingTransactionCard';
import { TransactionDetailContent } from '../../transactions/components/TransactionDetailContent';
import { BottomSheet, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { useShallow } from 'zustand/react/shallow';
import { useTransactionsStore, selectPending } from '../../transactions/state/transactionsStore';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { MainTabParamList, RootStackParamList } from '../../../app/navigation/routes';

type Filter = 'all' | 'expense' | 'income';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Pending'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function PendingScreen() {
  const navigation = useNavigation<Nav>();
  const pending = useTransactionsStore(useShallow(selectPending));
  const approve = useTransactionsStore(state => state.approve);
  const reject = useTransactionsStore(state => state.reject);

  const [filter, setFilter] = useState<Filter>('all');
  const [reviewing, setReviewing] = useState<Transaction | null>(null);

  const expenseCount = pending.filter(t => t.type === 'expense').length;
  const incomeCount = pending.filter(t => t.type === 'income').length;

  const filteredPending = useMemo(() => {
    if (filter === 'all') return pending;
    return pending.filter(t => t.type === filter);
  }, [pending, filter]);

  function openReview(transaction: Transaction) {
    setReviewing(transaction);
  }

  function closeReview() {
    setReviewing(null);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={filteredPending}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Pending Transactions</Text>
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

            <View style={styles.filterRow}>
              <Pressable onPress={() => setFilter('all')}>
                <Chip label={`All ${pending.length}`} tone={filter === 'all' ? 'active' : 'neutral'} />
              </Pressable>
              <Pressable onPress={() => setFilter('expense')}>
                <Chip label={`Expenses ${expenseCount}`} tone={filter === 'expense' ? 'active' : 'neutral'} />
              </Pressable>
              <Pressable onPress={() => setFilter('income')}>
                <Chip label={`Income ${incomeCount}`} tone={filter === 'income' ? 'active' : 'neutral'} />
              </Pressable>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <PendingTransactionCard
            transaction={item}
            onApprove={t => approve(t.id)}
            onReview={openReview}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nothing pending — detected transactions will appear here.</Text>
          </View>
        }
      />

      <BottomSheet visible={reviewing !== null} onClose={closeReview}>
        {reviewing ? (
          <TransactionDetailContent
            transaction={reviewing}
            variant="sheet"
            onApprove={t => {
              approve(t.id);
              closeReview();
            }}
            onReject={t => {
              reject(t.id);
              closeReview();
            }}
            onEdit={t => {
              closeReview();
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
  content: {
    padding: spacing.screen,
    gap: spacing.md,
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
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
