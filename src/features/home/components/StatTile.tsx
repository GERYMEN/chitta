import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';

export interface StatTileProps {
  label: string;
  amountMinor: number;
  caption: string;
  tone: 'income' | 'expense';
}

export function StatTile({ label, amountMinor, caption, tone }: StatTileProps) {
  const isIncome = tone === 'income';

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.badge, { backgroundColor: isIncome ? '#E6F9EC' : '#FEE2E2' }]}>
          <Icon
            name={isIncome ? 'arrow-down' : 'arrow-up'}
            size={14}
            color={isIncome ? '#00A827' : '#DC2626'}
          />
        </View>
      </View>
      <Text style={styles.amount}>{formatRupeesFromMinor(amountMinor)}</Text>
      <Text style={styles.caption}>{caption}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.labelMd,
    color: colors.outline,
    letterSpacing: 0.5,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  caption: {
    ...typography.bodyMd,
    color: colors.outline,
  },
});
