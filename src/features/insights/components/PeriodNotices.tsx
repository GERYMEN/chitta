import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Icon } from '../../../shared/icons';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
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
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const partial = earliestApprovedAt !== null && startsBeforeRecords(range, earliestApprovedAt);
  if (!partial && pendingCount <= 0) return null;
  return (
    <View style={[styles.wrap, style]}>
      {partial && earliestApprovedAt !== null ? (
        <View style={styles.row}>
          <Icon name="information-outline" size={16} color={c.outline} />
          <Text style={styles.text} testID="period-partial-notice">
            {partialDataNotice(earliestApprovedAt)}
          </Text>
        </View>
      ) : null}
      {pendingCount > 0 ? (
        <View style={styles.row}>
          <Icon name="clock-outline" size={16} color={c.pendingFg} />
          <Text style={styles.text} testID="period-pending-hint">
            {pendingNotIncludedLabel(pendingCount)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
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
    color: c.outline,
    flex: 1,
  },
});
