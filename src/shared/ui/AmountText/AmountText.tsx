import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { colors, typography } from '../../../theme';
import { formatRupeesFromMinor } from '../../utils/currency';
import { TransactionType } from '../../../domain/transactions/transaction.types';

export interface AmountTextProps {
  amountMinor: number;
  type: TransactionType;
  /** Show the sign (+/-) per DESIGN.md "Negative and Positive Flow". Default: true. */
  signed?: boolean;
  showPaise?: boolean;
  variant?: keyof typeof typography;
  style?: StyleProp<TextStyle>;
}

/**
 * Renders a signed Rupee amount: incoming credits in bold primary green,
 * outgoing payments in neutral on-surface ink (DESIGN.md Typography rules).
 */
export function AmountText({
  amountMinor,
  type,
  signed = true,
  showPaise = false,
  variant = 'headlineSm',
  style,
}: AmountTextProps) {
  const magnitude = Math.abs(amountMinor);
  const signedMinor = type === 'income' ? magnitude : -magnitude;

  // R3a: a transfer is neither money in nor out — no +/−, neutral ink.
  const text =
    signed && type !== 'transfer'
      ? formatRupeesFromMinor(signedMinor, { showPaise, showPositiveSign: true })
      : formatRupeesFromMinor(magnitude, { showPaise });
  const color =
    type === 'income' ? colors.primary : type === 'transfer' ? colors.secondary : colors.onSurface;

  return (
    <Text
      style={[
        typography[variant],
        { color },
        styles.tabular,
        style,
      ]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
