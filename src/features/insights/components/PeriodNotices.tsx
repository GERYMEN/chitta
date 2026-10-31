import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { transactionStateColors } from '../../../theme/colors';
import { PeriodRange } from '../../../domain/periods/period.types';
import { startsBeforeRecords } from '../../../domain/insights/insights.rules';
import { partialDataNotice, pendingNotIncludedLabel } from '../insightLabels';

export interface PeriodNoticesProps {
  range: PeriodRange;
  /** Earliest approved row (earliestApprovedAt); null = nothing approved yet. */
  earliestApprovedAt: string | null;
  /** Pending rows dated in the period (pendingInRangeCount). */
  pendingCount: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * R4: shown under the period selector — "Records start <d MMM yyyy> —
 * earlier months may be incomplete." when the period starts before the
 * first approved record, and "N pending not included" (count only).
 * Renders nothing when neither applies.
 */
export function PeriodNotices({ range, earliestApprovedAt, pendingCount, style }: PeriodNoticesProps) {
  const partial = earliestApprovedAt !== null && startsBeforeRecords(range, earliestApprovedAt);
  if (!partial && pendingCount <= 0) return null;
  return (
    <View style={[styles.wrap, style]}>
      {partial && earliestApprovedAt !== null ? (
        <View style={styles.row}>
          <Icon name="information-outline" size={16} color={colors.outline} />
          <Text style={styles.text} testID="period-partial-notice">
            {partialDataNotice(earliestApprovedAt)}
          </Text>
        </View>
      ) : null}
      {pendingCount > 0 ? (
        <View style={styles.row}>
          <Icon name="clock-outline" size={16} color={transactionStateColors.pending.fg} />
          <Text style={styles.text} testID="period-pending-hint">
            {pendingNotIncludedLabel(pendingCount)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  text: {
    ...typography.labelMd,
    color: colors.outline,
    flex: 1,
  },
});
