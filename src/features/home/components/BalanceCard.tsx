import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';

export interface BalanceCardProps {
  totalBalanceMinor: number;
  onAddRecord: () => void;
  onSyncSms: () => void;
}

export function BalanceCard({ totalBalanceMinor, onAddRecord, onSyncSms }: BalanceCardProps) {
  return (
    <Card tone="obsidian" style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.label}>TOTAL BALANCE</Text>
        <Chip
          label="Verified & Approved"
          tone="active"
          icon={<Icon name="check-decagram" size={14} color={colors.primaryContainer} />}
        />
      </View>

      <Text style={styles.amount}>{formatRupeesFromMinor(totalBalanceMinor, { showPaise: true })}</Text>

      <View style={styles.actions}>
        <Button label="Add Record" variant="brand" onPress={onAddRecord} fullWidth={false} style={styles.actionButton} />
        <Button label="Sync SMS" variant="ghost" onPress={onSyncSms} fullWidth={false} style={styles.actionButton} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.labelMd,
    color: colors.inverseOnSurface,
    letterSpacing: 0.5,
  },
  amount: {
    ...typography.displayHeroMobile,
    color: colors.onObsidian,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    height: 48,
  },
});
