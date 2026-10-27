import React from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../../theme';
import { transactionStateColors } from '../../../theme/colors';
import { AmountText } from '../AmountText';
import { TransactionStatus, TransactionType } from '../../../domain/transactions/transaction.types';

export interface TransactionRowProps {
  merchantName: string;
  /** e.g. "Food & Dining · Today, 1:15 PM" or "Bank · 9:15 AM · High confidence". */
  subtitle: string;
  amountMinor: number;
  type: TransactionType;
  status: TransactionStatus;
  /** Leading 48px avatar/icon badge. */
  icon: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  testID?: string;
}

const STATUS_LABEL: Record<TransactionStatus, string> = {
  approved: 'Approved',
  pending: 'Pending Review',
  rejected: 'Rejected',
  invalid: 'Could not process',
};

const STATUS_TONE = {
  approved: transactionStateColors.approved.fg,
  pending: transactionStateColors.pending.fg,
  rejected: transactionStateColors.rejected.fg,
  invalid: transactionStateColors.failed.fg,
} satisfies Record<TransactionStatus, string>;

export function TransactionRow({
  merchantName,
  subtitle,
  amountMinor,
  type,
  status,
  icon,
  onPress,
  testID,
}: TransactionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}>
      <View style={styles.avatar}>{icon}</View>
      <View style={styles.middle}>
        <Text style={styles.title} numberOfLines={1}>
          {merchantName}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.trailing}>
        <AmountText amountMinor={amountMinor} type={type} variant="headlineSm" />
        <Text style={[styles.status, { color: STATUS_TONE[status] }]}>
          {STATUS_LABEL[status]}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  title: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.outline,
    marginTop: 2,
  },
  trailing: {
    alignItems: 'flex-end',
  },
  status: {
    ...typography.labelMd,
    marginTop: 2,
    textTransform: 'uppercase',
  },
});
