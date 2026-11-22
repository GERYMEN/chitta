import React, { useMemo } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { AmountText } from '../AmountText';
import { TransactionStatus, TransactionType } from '../../../domain/transactions/transaction.types';
import { redactText, useRedacted } from '../../privacy/redaction';

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
  /** R3b: small tag after the title, e.g. "Refund". */
  tag?: string | null;
}

const STATUS_LABEL: Record<TransactionStatus, string> = {
  approved: 'Approved',
  pending: 'Pending Review',
  rejected: 'Rejected',
  invalid: 'Could not process',
};

const statusTone = (c: ColorTokens): Record<TransactionStatus, string> => ({
  approved: c.approvedFg,
  pending: c.pendingFg,
  rejected: c.rejectedFg,
  invalid: c.failedFg,
});

export function TransactionRow({
  merchantName,
  subtitle,
  amountMinor,
  type,
  status,
  icon,
  onPress,
  testID,
  tag = null,
}: TransactionRowProps) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  // R4c: merchant / payee masked (amount via AmountText) in the feedback screenshot.
  useRedacted();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}>
      <View style={styles.avatar}>{icon}</View>
      <View style={styles.middle}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {redactText(merchantName)}
          </Text>
          {tag ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.trailing}>
        <AmountText amountMinor={amountMinor} type={type} variant="headlineSm" />
        <Text style={[styles.status, { color: statusTone(c)[status] }]}>
          {STATUS_LABEL[status]}
        </Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
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
    backgroundColor: c.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.headlineSm,
    fontSize: 16,
    color: c.onSurface,
    flexShrink: 1,
  },
  tag: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    borderRadius: radii.full,
    backgroundColor: c.approvedBg,
  },
  tagText: {
    ...typography.labelSm,
    color: c.primary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: c.outline,
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
