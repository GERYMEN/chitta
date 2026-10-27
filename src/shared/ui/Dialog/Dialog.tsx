import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../Button';
import { Icon } from '../../icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { shadows } from '../../../theme/shadows';
import { DialogAction, DialogConfig, isDestructiveDialog, useDialogStore } from './dialogStore';

export interface DialogProps {
  config: DialogConfig | null;
  onDismiss: () => void;
  onAction: (action: DialogAction) => void;
}

/**
 * Themed confirm/info dialog — replaces the stock Android AlertDialog.
 * Same visual language as Card/BottomSheet: white level-2 surface, large
 * radius, Plus Jakarta Sans, actions rendered with the shared Button.
 * Built on core RN Modal only (no animation/gesture native dependency).
 */
export function Dialog({ config, onDismiss, onAction }: DialogProps) {
  if (!config) return null;

  const destructive = isDestructiveDialog(config);
  const sideBySide = config.actions.length === 2;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}>
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={destructive ? undefined : onDismiss}
          accessibilityLabel="Dismiss dialog"
          testID="dialog-scrim"
        />
        <View style={[styles.surface, shadows.level2]} accessibilityRole="alert" testID="dialog">
          {config.icon ? (
            <View style={[styles.iconWrap, destructive ? styles.iconWrapDestructive : styles.iconWrapNeutral]}>
              <Icon
                name={config.icon}
                size={26}
                color={destructive ? colors.error : colors.primary}
              />
            </View>
          ) : null}

          <Text style={styles.title}>{config.title}</Text>
          {config.message ? <Text style={styles.message}>{config.message}</Text> : null}

          <View style={[styles.actions, sideBySide ? styles.actionsRow : styles.actionsColumn]}>
            {config.actions.map((action, index) => (
              <Button
                key={`${action.label}-${index}`}
                label={action.label}
                variant={action.variant ?? 'primary'}
                fullWidth={!sideBySide}
                style={sideBySide ? styles.rowButton : undefined}
                onPress={() => onAction(action)}
                testID={`dialog-action-${index}`}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Mount once at the app root; renders whatever `showDialog` last requested. */
export function DialogHost() {
  const config = useDialogStore(state => state.current);
  const dismiss = useDialogStore(state => state.dismiss);
  const press = useDialogStore(state => state.press);

  return <Dialog config={config} onDismiss={dismiss} onAction={press} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.obsidian,
    opacity: 0.4,
  },
  surface: {
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconWrapNeutral: {
    backgroundColor: colors.surfaceContainerLow,
  },
  iconWrapDestructive: {
    backgroundColor: colors.errorContainer,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  message: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionsColumn: {
    flexDirection: 'column',
  },
  rowButton: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
});
