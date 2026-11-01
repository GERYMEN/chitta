import { StyleSheet } from 'react-native';
import { colors, radii, spacing, typography } from '../../../theme';
import { transactionStateColors } from '../../../theme/colors';

/** Shared layout of the R4e Backup and Restore screens. */
export const backupScreenStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  intro: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  meta: {
    ...typography.labelMd,
    color: colors.outline,
  },
  warning: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radii.default,
    backgroundColor: transactionStateColors.pending.bg,
  },
  warningText: {
    flex: 1,
    ...typography.bodyMd,
    color: colors.onTertiaryContainer,
  },
  errorBox: {
    padding: spacing.md,
    borderRadius: radii.default,
    backgroundColor: colors.errorContainer,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.onErrorContainer,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.default,
    backgroundColor: colors.surfaceContainerLow,
  },
  fileName: {
    flex: 1,
    ...typography.labelLg,
    color: colors.onSurface,
  },
});
