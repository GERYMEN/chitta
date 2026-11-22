import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { useRedacted } from '../../../shared/privacy/redaction';
import { relativeDueLabel } from '../../../domain/recurring/recurring.rules';
import { approxAmountLabel } from '../upcomingLabels';
import { useUpcoming } from '../useUpcoming';

const MAX_ROWS = 3;

/**
 * R8a (D-e): Home "Upcoming" card. Hidden unless at least one recurring series
 * is due in the window. Lists the next 1-3; tapping opens the full list.
 * Amounts are estimates ("~") and go through the redaction-aware formatter.
 */
export function UpcomingCard({ onPress }: { onPress: () => void }) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  useRedacted();
  const { now, upcoming } = useUpcoming();
  if (upcoming.length === 0) return null;
  const shown = upcoming.slice(0, MAX_ROWS);

  const a11y = `Upcoming: ${upcoming.length} expected payment${upcoming.length === 1 ? '' : 's'}. ${shown
    .map(s => `${s.displayName} about ${approxAmountLabel(s.typicalAmountMinor).slice(1)}, due ${relativeDueLabel(s.nextDueAt, now)}`)
    .join('. ')}`;

  return (
    <Pressable
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID="home-upcoming-card">
      <View style={styles.headerRow}>
        <Icon name="calendar-clock" size={20} color={c.primary} />
        <Text style={styles.title}>Upcoming</Text>
        <Icon name="chevron-right" size={22} color={c.outline} />
      </View>
      {shown.map(s => (
        <View key={s.merchantKey} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>
            {s.displayName}
          </Text>
          <Text style={styles.detail}>
            {approxAmountLabel(s.typicalAmountMinor)}, due {relativeDueLabel(s.nextDueAt, now)}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  card: {
    backgroundColor: c.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 48,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.labelLg, color: c.onSurface, flex: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.bodyLg, color: c.onSurface, flex: 1 },
  detail: { ...typography.bodyMd, color: c.onSurfaceVariant },
});
