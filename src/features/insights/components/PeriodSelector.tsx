import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Chip } from '../../../shared/ui';
import { spacing } from '../../../theme';
import { Period } from '../../../domain/periods/period.types';
import { PERIODS } from '../../../domain/periods/period.rules';
import { periodChipA11yLabel } from '../insightLabels';

export interface PeriodSelectorProps {
  value: Period;
  onChange: (period: Period) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * R4: the one period selector (Home, Transactions, Insights). Chips
 * 1M 3M 6M 9M 1Y; each touch target is at least 48×48dp around the 36dp
 * pill, and the selected chip announces "selected" (same pattern as the
 * Transactions filter chips). Stateless: the value lives in the store.
 */
export function PeriodSelector({ value, onChange, style }: PeriodSelectorProps) {
  return (
    <View style={[styles.row, style]} testID="period-selector">
      {PERIODS.map(period => {
        const selected = period === value;
        return (
          <Pressable
            key={period}
            onPress={() => onChange(period)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={periodChipA11yLabel(period)}
            testID={`period-chip-${period}`}
            style={({ pressed }) => [styles.target, pressed && styles.pressed]}>
            <Chip label={period} tone={selected ? 'active' : 'neutral'} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  target: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
