import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { scanProgressLabel } from '../../../domain/settings/smsSyncStart.rules';

/** R4b: a running SMS scan (counts only). */
export interface SyncProgressView {
  scanned: number;
  total: number;
  cancelling: boolean;
}

export interface BalanceCardProps {
  totalBalanceMinor: number;
  onAddRecord: () => void;
  onSyncSms: () => void;
  /** R4b: while set, the action row shows the scan progress + Cancel. */
  syncProgress?: SyncProgressView | null;
  onCancelSync?: () => void;
}

export function BalanceCard({
  totalBalanceMinor,
  onAddRecord,
  onSyncSms,
  syncProgress = null,
  onCancelSync,
}: BalanceCardProps) {
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

      {/* R4b: progress replaces the buttons in the same 48dp row — no layout jump. */}
      {syncProgress ? (
        <View style={styles.actions} testID="sync-progress">
          <View style={styles.progressTextWrap} accessibilityLiveRegion="polite">
            <Text style={styles.progressText} numberOfLines={1}>
              {scanProgressLabel(syncProgress.scanned, syncProgress.total, syncProgress.cancelling)}
            </Text>
          </View>
          <Button
            label="Cancel"
            variant="ghost"
            onPress={onCancelSync}
            disabled={syncProgress.cancelling}
            fullWidth={false}
            style={styles.cancelButton}
            testID="sync-cancel"
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Add Record" variant="brand" onPress={onAddRecord} fullWidth={false} style={styles.actionButton} />
          <Button label="Sync SMS" variant="ghost" onPress={onSyncSms} fullWidth={false} style={styles.actionButton} />
        </View>
      )}
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
  progressTextWrap: {
    flex: 2,
    height: 48,
    justifyContent: 'center',
  },
  progressText: {
    ...typography.labelLg,
    color: colors.onObsidian,
  },
  cancelButton: {
    flex: 1,
    height: 48,
  },
});
