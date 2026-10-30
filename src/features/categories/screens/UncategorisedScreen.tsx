import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { uncategorisedItems } from '../../../domain/categories/category.rules';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { CategoryPickerSheet } from '../components/CategoryPickerSheet';
import { promptRememberCategory } from '../rememberCategory';

/**
 * R2 T4 quick-assign: every pending/approved item still in Uncategorised.
 * Each row is merchant + date + a category chip; picking a category goes
 * through the same "Always use…?" flow as Edit/Detail. Amounts are not shown.
 */
export function UncategorisedScreen() {
  const navigation = useNavigation();
  const items = useTransactionsStore(useShallow(state => uncategorisedItems(state.transactions)));
  const [editing, setEditing] = useState<Transaction | null>(null);

  async function assign(transaction: Transaction, categoryId: string) {
    setEditing(null);
    if (categoryId === transaction.categoryId) return;
    await useTransactionsStore.getState().updateTransaction(transaction.id, { categoryId });
    promptRememberCategory({
      transactionId: transaction.id,
      merchantName: transaction.merchantName,
      previousCategoryId: transaction.categoryId,
      newCategoryId: categoryId,
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Uncategorised</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          items.length > 0 ? (
            <Text style={styles.intro}>
              Pick a category for each item. You can choose to remember it for the merchant.
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View style={styles.row} testID="quick-assign-row">
            <View style={styles.rowText}>
              <Text style={styles.merchant} numberOfLines={1}>
                {item.merchantName}
              </Text>
              <Text style={styles.date}>
                {formatTransactionTimestamp(item.occurredAt)}
                {item.status === 'pending' ? ' · Pending' : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => setEditing(item)}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="button"
              accessibilityLabel={`Choose category for ${item.merchantName}`}>
              <Chip
                label="Uncategorised"
                tone="pending"
                icon={<Icon name="chevron-down" size={14} color={colors.onSurfaceVariant} />}
              />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="check-circle-outline" size={32} color={colors.primary} />
            <Text style={styles.emptyTitle}>All categorised</Text>
            <Text style={styles.emptyBody}>New SMS items without a merchant rule will show up here.</Text>
          </View>
        }
      />

      <CategoryPickerSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        type={editing?.type ?? 'expense'}
        selectedId={null}
        includeUncategorised={false}
        onSelect={categoryId => {
          if (editing) assign(editing, categoryId);
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  headerSpacer: {
    width: 22,
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl * 2,
    flexGrow: 1,
  },
  intro: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  merchant: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  date: {
    ...typography.labelMd,
    color: colors.outline,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  emptyBody: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
  },
});
