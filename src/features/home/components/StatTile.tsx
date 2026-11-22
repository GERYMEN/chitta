import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';

export interface StatTileProps {
  label: string;
  amountMinor: number;
  caption: string;
  tone: 'income' | 'expense';
}

export function StatTile({ label, amountMinor, caption, tone }: StatTileProps) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const isIncome = tone === 'income';

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.badge, { backgroundColor: isIncome ? c.approvedBg : c.failedBg }]}>
          <Icon
            name={isIncome ? 'arrow-down' : 'arrow-up'}
            size={14}
            color={isIncome ? c.approvedFg : c.failedFg}
          />
        </View>
      </View>
      <Text style={styles.amount}>{formatRupeesFromMinor(amountMinor)}</Text>
      <Text style={styles.caption}>{caption}</Text>
    </Card>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
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
    color: c.outline,
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
    color: c.onSurface,
  },
  caption: {
    ...typography.bodyMd,
    color: c.outline,
  },
});
