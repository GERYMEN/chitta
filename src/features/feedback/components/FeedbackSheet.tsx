import React from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { FEEDBACK_NOTE_MAX } from '../feedback.constants';
import {
  canSendFeedback,
  clampNote,
  FEEDBACK_CATEGORIES,
  FeedbackCategory,
  NOTE_PLACEHOLDER,
  noteCounter,
  SCREENSHOT_CAPTION,
} from '../feedbackMessage';

export interface FeedbackSheetProps {
  visible: boolean;
  onClose: () => void;
  /** "v1.0 (1)" from the native module. */
  versionLabel: string;
  category: FeedbackCategory | null;
  onCategoryChange: (category: FeedbackCategory) => void;
  note: string;
  onNoteChange: (note: string) => void;
  /** file:// uri of the redacted screenshot, or null (removed / capture failed). */
  screenshotUri: string | null;
  onRetake: () => void;
  onRemove: () => void;
  onAdd: () => void;
  onSend: () => void;
  sending?: boolean;
}

/**
 * R4c "Share Feedback" sheet (reuses BottomSheet): category pills, note with
 * a live N/500 counter, the redacted screenshot (Retake / Remove / Add) and
 * one "Send on WhatsApp" button. No backend submit.
 */
export function FeedbackSheet({
  visible,
  onClose,
  versionLabel,
  category,
  onCategoryChange,
  note,
  onNoteChange,
  screenshotUri,
  onRetake,
  onRemove,
  onAdd,
  onSend,
  sending = false,
}: FeedbackSheetProps) {
  const sendEnabled = canSendFeedback({ category, note }) && !sending;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Share Feedback
        </Text>
        <View style={styles.versionBadge} testID="feedback-version">
          <Text style={styles.versionText}>{versionLabel}</Text>
        </View>
        <View style={styles.headerSpacer} />
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={4}
          testID="feedback-close"
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <Icon name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={styles.pills} accessibilityRole="radiogroup">
        {FEEDBACK_CATEGORIES.map(option => {
          const selected = option.id === category;
          return (
            <Pressable
              key={option.id}
              onPress={() => onCategoryChange(option.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.label}
              testID={`feedback-category-${option.id}`}
              style={({ pressed }) => [
                styles.pill,
                selected ? styles.pillSelected : styles.pillIdle,
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                {option.pill}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={note}
        onChangeText={text => onNoteChange(clampNote(text))}
        placeholder={NOTE_PLACEHOLDER}
        placeholderTextColor={colors.outline}
        multiline
        maxLength={FEEDBACK_NOTE_MAX}
        textAlignVertical="top"
        style={styles.note}
        accessibilityLabel="Feedback note"
        testID="feedback-note"
      />
      <Text style={styles.counter} testID="feedback-counter">
        {noteCounter(note)}
      </Text>

      {screenshotUri ? (
        <View style={styles.shotRow} testID="feedback-screenshot">
          <Image
            source={{ uri: screenshotUri }}
            style={styles.thumb}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            accessible
            accessibilityLabel="Screenshot preview, amounts hidden"
          />
          <View style={styles.shotMeta}>
            <Text style={styles.shotCaption}>{SCREENSHOT_CAPTION}</Text>
            <View style={styles.shotActions}>
              <SmallAction label="Retake" onPress={onRetake} testID="feedback-retake" />
              <SmallAction label="Remove" onPress={onRemove} testID="feedback-remove" />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.shotRow} testID="feedback-no-screenshot">
          <Text style={styles.noShot}>No screenshot attached</Text>
          <SmallAction label="Add" onPress={onAdd} testID="feedback-add" />
        </View>
      )}

      <Pressable
        onPress={onSend}
        disabled={!sendEnabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !sendEnabled }}
        accessibilityLabel="Send on WhatsApp"
        testID="feedback-send"
        style={({ pressed }) => [
          styles.send,
          pressed && sendEnabled && styles.pressed,
          !sendEnabled && styles.disabled,
        ]}>
        <Icon name="whatsapp" size={22} color={colors.onWhatsapp} />
        <Text style={styles.sendText}>Send on WhatsApp</Text>
      </Pressable>
    </BottomSheet>
  );
}

function SmallAction({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}>
      <Text style={styles.smallActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  versionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
  },
  versionText: {
    ...typography.labelMd,
    color: colors.onSurfaceVariant,
  },
  headerSpacer: {
    flex: 1,
  },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.full,
  },
  pills: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  pill: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillIdle: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  pillSelected: {
    backgroundColor: colors.obsidian,
  },
  pillText: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  pillTextSelected: {
    color: colors.onObsidian,
  },
  note: {
    ...typography.bodyLg,
    minHeight: 112,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
    padding: spacing.md,
    color: colors.onSurface,
  },
  counter: {
    ...typography.labelMd,
    color: colors.outline,
    alignSelf: 'flex-end',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  shotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  thumb: {
    width: 64,
    height: 112,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  shotMeta: {
    flex: 1,
    gap: spacing.xs,
  },
  shotCaption: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  shotActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  noShot: {
    ...typography.bodyMd,
    color: colors.outline,
    flex: 1,
  },
  smallAction: {
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionText: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  send: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    borderRadius: radii.full,
    backgroundColor: colors.whatsapp,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    ...typography.labelLg,
    fontSize: 16,
    color: colors.onWhatsapp,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});
