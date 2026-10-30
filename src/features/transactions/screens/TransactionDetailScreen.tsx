import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TransactionDetailActions, TransactionDetailContent } from '../components/TransactionDetailContent';
import { Icon } from '../../../shared/icons';
import { showDialog } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../state/transactionsStore';
import { RootStackParamList } from '../../../app/navigation/routes';
import { CategoryPickerSheet } from '../../categories/components/CategoryPickerSheet';
import { promptRememberCategory } from '../../categories/rememberCategory';

type DetailRoute = RouteProp<RootStackParamList, 'TransactionDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function TransactionDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const transaction = useTransactionsStore(state =>
    state.transactions.find(t => t.id === route.params.transactionId),
  );
  const approve = useTransactionsStore(state => state.approve);
  const reject = useTransactionsStore(state => state.reject);
  const deleteTransaction = useTransactionsStore(state => state.deleteTransaction);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  async function handleCategoryChange(categoryId: string) {
    setCategoryPickerOpen(false);
    if (!transaction || categoryId === transaction.categoryId) return;
    const before = transaction;
    await useTransactionsStore.getState().updateTransaction(before.id, { categoryId });
    promptRememberCategory({
      transactionId: before.id,
      merchantName: before.merchantName,
      previousCategoryId: before.categoryId,
      newCategoryId: categoryId,
    });
  }

  function handleDelete(transactionId: string) {
    showDialog({
      title: 'Delete transaction?',
      message: 'This will permanently remove the record.',
      icon: 'trash-can-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: async () => {
            await deleteTransaction(transactionId);
            navigation.goBack();
          },
        },
      ],
    });
  }

  if (!transaction) {
    // Reached from Activity for a transaction that has since been deleted
    // (its audit history stays). Never crash — say so plainly.
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>Transaction</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.missing}>
          <Icon name="trash-can-outline" size={32} color={colors.outline} />
          <Text style={styles.missingTitle}>Transaction deleted</Text>
          <Text style={styles.missingText}>
            This record was removed. Its history stays in Activity.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Transaction</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <TransactionDetailContent
          transaction={transaction}
          variant="screen"
          hideActions
          onApprove={t => {
            approve(t.id);
            navigation.goBack();
          }}
          onReject={t => {
            reject(t.id);
            navigation.goBack();
          }}
          onEdit={t => navigation.navigate('EditTransaction', { transactionId: t.id })}
          onDelete={t => handleDelete(t.id)}
          onChangeCategory={() => setCategoryPickerOpen(true)}
        />
      </ScrollView>
      <View style={styles.footer}>
        <TransactionDetailActions
          transaction={transaction}
          onApprove={t => {
            approve(t.id);
            navigation.goBack();
          }}
          onReject={t => {
            reject(t.id);
            navigation.goBack();
          }}
          onEdit={t => navigation.navigate('EditTransaction', { transactionId: t.id })}
          onDelete={t => handleDelete(t.id)}
        />
      </View>
      <CategoryPickerSheet
        visible={categoryPickerOpen}
        onClose={() => setCategoryPickerOpen(false)}
        type={transaction.type}
        selectedId={transaction.categoryId}
        onSelect={handleCategoryChange}
      />
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
    paddingBottom: spacing.xl * 2,
  },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  headerSpacer: {
    width: 22,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: colors.surface,
  },
  missingTitle: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  missingText: {
    ...typography.bodyLg,
    color: colors.outline,
    textAlign: 'center',
  },
});
