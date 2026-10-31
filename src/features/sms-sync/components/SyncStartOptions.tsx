import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import {
  SMS_SYNC_START_OPTIONS,
  SmsSyncStartMode,
} from '../../../domain/settings/smsSyncStart.rules';

export interface SyncStartOptionsProps {
  value: SmsSyncStartMode | null;
  onChange: (mode: SmsSyncStartMode) => void;
  /**
   * Settings only: show "Pick a date" ('custom'). `customLabel` is the picked
   * date ("d MMM yyyy"); pressing the row calls `onPickCustom`.
   */
  showCustom?: boolean;
  customLabel?: string | null;
  onPickCustom?: () => void;
}

interface RowProps {
  label: string;
  helper: string;
  selected: boolean;
  recommended?: boolean;
  onPress: () => void;
  testID: string;
}

function OptionRow({ label, helper, selected, recommended, onPress, testID }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={`${label}${recommended ? ', recommended' : ''}. ${helper}`}
      testID={testID}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}>
      <Icon
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={22}
        color={selected ? colors.primary : colors.outline}
      />
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={styles.label}>{label}</Text>
          {recommended ? <Chip label="Recommended" tone="active" style={styles.badge} /> : null}
        </View>
        <Text style={styles.helper}>{helper}</Text>
      </View>
    </Pressable>
  );
}

/**
 * R4b: "Where should SMS sync start?" radio list — onboarding and the
 * Settings sheet. Rows are ≥ 56dp tall with radio accessibility state.
 */
export function SyncStartOptions({
  value,
  onChange,
  showCustom = false,
  customLabel = null,
  onPickCustom,
}: SyncStartOptionsProps) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {SMS_SYNC_START_OPTIONS.map(option => (
        <OptionRow
          key={option.mode}
          label={option.label}
          helper={option.helper}
          recommended={option.recommended}
          selected={value === option.mode}
          onPress={() => onChange(option.mode)}
          testID={`sync-start-${option.mode}`}
        />
      ))}
      {showCustom ? (
        <OptionRow
          label="Pick a date"
          helper={customLabel ? `From ${customLabel}` : 'Choose any day up to today.'}
          selected={value === 'custom'}
          onPress={() => onPickCustom?.()}
          testID="sync-start-custom"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.default,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLowest,
  },
  pressed: {
    opacity: 0.7,
  },
  text: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  label: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  badge: {
    height: 24,
  },
  helper: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
});
