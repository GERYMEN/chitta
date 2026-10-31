import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import {
  DUPLICATE_PICKER_DAYS,
  duplicatePickerOptions,
} from '../../../domain/duplicates/duplicate.rules';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { duplicateRowLine, duplicateRowStatus } from '../duplicateLabels';

/**
 * R3b manual "Mark as duplicate of…": rows with the same account + type +
 * amount within DUPLICATE_PICKER_DAYS. The picked row is KEPT; this one is hidden.
 */
export function DuplicatePickerSheet({
  visible,
  onClose,
  transaction,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  transaction: Transaction;
  onSelect: (keptId: string) => void;
}) {
  const transactions = useTransactionsStore(state => state.transactions);
  const options = useMemo(
    () => (visible ? duplicatePickerOptions(transaction, transactions) : []),
    [visible, transaction, transactions],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Duplicate of which item?</Text>
      <Text style={styles.body}>
        The one you pick is kept. This one is hidden — not in lists, totals or balances.
      </Text>
      {options.length === 0 ? (
        <Text style={styles.body} testID="duplicate-options-empty">
          No item with the same account and amount within {DUPLICATE_PICKER_DAYS} days.
        </Text>
      ) : (
        <View>
          {options.map(option => (
            <Pressable
              key={option.id}
              onPress={() => onSelect(option.id)}
              accessibilityRole="button"
              accessibilityLabel={`Duplicate of ${duplicateRowLine(option)}`}
              testID="duplicate-option"
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Icon name="content-duplicate" size={20} color={colors.secondary} />
              <View style={styles.optionText}>
                <Text style={styles.optionTitle} numberOfLines={1}>
                  {duplicateRowLine(option)}
                </Text>
                <Text style={styles.optionMeta}>{duplicateRowStatus(option)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  body: {
    ...typography.bodyMd,
    color: colors.outline,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.6,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  optionMeta: {
    ...typography.labelMd,
    color: colors.outline,
  },
});
