import React from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Slider } from '../../../shared/ui';
import { colors, radii, spacing, typography } from '../../../theme';
import {
  AUTO_APPROVE_THRESHOLD_MAX,
  AUTO_APPROVE_THRESHOLD_MIN,
  SMS_PARSER_MAX_CONFIDENCE,
  USER_NAME_MAX_LENGTH,
  shouldShowThresholdNote,
} from '../../../domain/settings/approval.rules';
import { profileFormSchema, ProfileFormValues } from './profileForm.schema';

export interface ProfileFormProps {
  initialValues: ProfileFormValues;
  onSubmit: (values: ProfileFormValues) => void;
  submitLabel: string;
  submitting?: boolean;
}

/**
 * Name + Auto-approve on/off switch (on = 'auto', off = 'manual') +
 * auto-approve threshold (always rendered, dimmed/disabled when off). Shared by
 * the onboarding ProfileSetup step and the Home settings sheet. Not a
 * ScrollView itself — the caller provides the scroll container.
 */
export function ProfileForm({
  initialValues,
  onSubmit,
  submitLabel,
  submitting = false,
}: ProfileFormProps) {
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: initialValues,
  });

  const approvalMode = watch('approvalMode');
  const autoOn = approvalMode === 'auto';
  const threshold = watch('autoApproveThreshold');
  const showThresholdNote = shouldShowThresholdNote(approvalMode, threshold);

  return (
    <View style={styles.form}>
      <Text style={styles.fieldLabel}>Your name</Text>
      <Controller
        control={control}
        name="userName"
        render={({ field }) => (
          <TextInput
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="e.g. Alex"
            placeholderTextColor={colors.outline}
            maxLength={USER_NAME_MAX_LENGTH + 10}
            autoCapitalize="words"
            accessibilityLabel="Your name"
            testID="profile-name-input"
          />
        )}
      />
      {errors.userName?.message ? (
        <Text style={styles.errorText}>{errors.userName.message}</Text>
      ) : null}

      <Controller
        control={control}
        name="approvalMode"
        render={({ field }) => (
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Auto-approve</Text>
            <Switch
              testID="approval-mode-switch"
              value={field.value === 'auto'}
              onValueChange={on => field.onChange(on ? 'auto' : 'manual')}
              trackColor={{
                true: colors.primary,
                false: colors.surfaceContainerHigh,
              }}
              thumbColor={colors.surfaceContainerLowest}
              accessibilityLabel="Auto-approve"
              accessibilityRole="switch"
            />
          </View>
        )}
      />
      <Text style={styles.helpText}>
        On: SMS transactions at or above your confidence threshold are approved
        automatically. Off: you approve every transaction yourself.
      </Text>

      {/* Always rendered so toggling never changes the sheet height. When
          off, the header/range are dimmed here and the Slider dims + locks
          itself via `disabled`. */}
      <View testID="threshold-block" style={styles.thresholdBlock}>
        <View style={[styles.thresholdHeader, !autoOn && styles.dimmed]}>
          <Text style={styles.fieldLabelInline}>Minimum confidence</Text>
          <Text style={styles.thresholdValue}>{threshold}%</Text>
        </View>
        <Controller
          control={control}
          name="autoApproveThreshold"
          render={({ field }) => (
            <Slider
              testID="threshold-slider"
              value={field.value}
              min={AUTO_APPROVE_THRESHOLD_MIN}
              max={AUTO_APPROVE_THRESHOLD_MAX}
              step={1}
              onChange={field.onChange}
              disabled={!autoOn}
              accessibilityLabel="Minimum confidence for auto-approve"
              formatValue={v => `${v} percent`}
            />
          )}
        />
        <View style={[styles.rangeRow, !autoOn && styles.dimmed]}>
          <Text style={styles.rangeText}>{AUTO_APPROVE_THRESHOLD_MIN}%</Text>
          <Text style={styles.rangeText}>{AUTO_APPROVE_THRESHOLD_MAX}%</Text>
        </View>
        {/* Fixed-height slot for the copy that changes with the switch and the
            threshold, so toggling or dragging never resizes the sheet. Sized
            for the longest variant: 2-line ON helper + 2-line threshold note. */}
        <View testID="threshold-copy-block" style={styles.thresholdCopy}>
          <Text style={styles.helpText}>
            {autoOn
              ? `SMS transactions with confidence ≥ ${threshold}% are approved automatically. Lower ones wait in Pending.`
              : 'Turn on Auto-approve to use the threshold'}
          </Text>
          {showThresholdNote ? (
            <Text testID="threshold-note" style={styles.noteText}>
              {`SMS matches currently score up to ${SMS_PARSER_MAX_CONFIDENCE}%, so thresholds above ${SMS_PARSER_MAX_CONFIDENCE}% won't auto-approve anything yet.`}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.submit}>
        <Button
          label={submitLabel}
          variant="brand"
          loading={submitting}
          onPress={() => handleSubmit(onSubmit)()}
          testID="profile-submit"
        />
      </View>
    </View>
  );
}

/** typography.bodyMd.lineHeight (typed optional on TextStyle). */
const BODY_MD_LINE_HEIGHT = typography.bodyMd.lineHeight ?? 20;

const styles = StyleSheet.create({
  form: {
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  fieldLabelInline: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.error,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    marginTop: spacing.sm,
  },
  switchLabel: {
    ...typography.labelLg,
    color: colors.onSurface,
    flex: 1,
  },
  thresholdBlock: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  dimmed: {
    opacity: 0.5,
  },
  thresholdHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thresholdValue: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  rangeText: {
    ...typography.labelMd,
    color: colors.outline,
  },
  helpText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  thresholdCopy: {
    gap: spacing.xs,
    // 2 lines of helper + 2 lines of note (bodyMd) + the gap between them.
    minHeight: BODY_MD_LINE_HEIGHT * 4 + spacing.xs,
  },
  noteText: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  submit: {
    marginTop: spacing.md,
  },
});
