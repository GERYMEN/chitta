import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { BottomSheet, confirmDialog, showDialog } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { ProfileForm } from './ProfileForm';
import { ProfileFormValues } from './profileForm.schema';
import { SyncStartEditor } from '../../sms-sync/components/SyncStartEditor';
import { estimateWindowCount } from '../../sms-sync/syncSms';
import {
  classifyStartChange,
  gapConfirmMessage,
  gapConfirmTitle,
  laterStartMessage,
  SmsSyncStartMode,
  SyncWindow,
  syncStartLabel,
} from '../../../domain/settings/smsSyncStart.rules';

export interface ProfileSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Opens the Activity feed (R1). Activity lives here, not in a 5th tab. */
  onOpenActivity: () => void;
  /** Opens category management (R2). */
  onOpenCategories: () => void;
  /**
   * R4b: start moved earlier and confirmed — scan only the gap, then call
   * `onCompleted` (saves the new start) if the scan finished.
   */
  onScanGap: (window: SyncWindow, onCompleted: () => Promise<void>) => void;
}

/**
 * Home → tap greeting → edit name, approval mode and threshold. The sheet
 * unmounts its children when closed, so the form re-reads the store's
 * current values on every open.
 */
export function ProfileSettingsSheet({
  visible,
  onClose,
  onOpenActivity,
  onOpenCategories,
  onScanGap,
}: ProfileSettingsSheetProps) {
  const { userName, approvalMode, autoApproveThreshold } = useTransactionsStore(
    useShallow(state => ({
      userName: state.userName,
      approvalMode: state.approvalMode,
      autoApproveThreshold: state.autoApproveThreshold,
    })),
  );
  const [saving, setSaving] = useState(false);
  const smsSyncStartMode = useTransactionsStore(state => state.smsSyncStartMode);
  const smsSyncStartAt = useTransactionsStore(state => state.smsSyncStartAt);
  const [editingStart, setEditingStart] = useState(false);
  const [savingStart, setSavingStart] = useState(false);

  /**
   * R4b: earlier → confirm "Scan SMS from <new> to <old>? About N SMS." and
   * scan only that gap (the start is saved after the scan finishes);
   * later → save, nothing is deleted; same date → save the mode only.
   */
  async function handleSaveStart(mode: SmsSyncStartMode, startAt: string | null) {
    const store = useTransactionsStore.getState();
    const oldStartAt = store.smsSyncStartAt;
    const change = classifyStartChange(oldStartAt, startAt);
    setSavingStart(true);
    try {
      if (change.kind === 'earlier') {
        const estimate = await estimateWindowCount(change.gap).catch(() => null);
        setEditingStart(false);
        onClose();
        const ok = await confirmDialog({
          title: gapConfirmTitle(startAt, oldStartAt),
          message: gapConfirmMessage(estimate),
          icon: 'calendar-start',
          confirmLabel: 'Scan',
        });
        if (ok) {
          onScanGap(change.gap, () =>
            useTransactionsStore.getState().setSmsSyncStart(mode, startAt),
          );
        }
        return;
      }
      await store.setSmsSyncStart(mode, startAt);
      setEditingStart(false);
      if (change.kind === 'later') {
        showDialog({
          title: 'SMS sync start changed',
          message: laterStartMessage(startAt),
          icon: 'calendar-start',
        });
      } else {
        ToastAndroid.show('Settings saved', ToastAndroid.SHORT);
      }
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    } finally {
      setSavingStart(false);
    }
  }

  async function handleSubmit(values: ProfileFormValues) {
    setSaving(true);
    try {
      await useTransactionsStore.getState().updateProfile(values);
      ToastAndroid.show('Settings saved', ToastAndroid.SHORT);
      onClose();
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Pressable
        onPress={onOpenActivity}
        accessibilityRole="button"
        accessibilityLabel="Activity"
        testID="settings-activity-row"
        style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
        <View style={styles.activityIcon}>
          <Icon name="history" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>Activity</Text>
          <Text style={styles.activityCaption}>Every approval, edit and deletion</Text>
        </View>
        <Icon name="chevron-right" size={22} color={colors.outline} />
      </Pressable>
      <Pressable
        onPress={onOpenCategories}
        accessibilityRole="button"
        accessibilityLabel="Categories"
        testID="settings-categories-row"
        style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
        <View style={styles.activityIcon}>
          <Icon name="shape-outline" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>Categories</Text>
          <Text style={styles.activityCaption}>Custom categories and merchant rules</Text>
        </View>
        <Icon name="chevron-right" size={22} color={colors.outline} />
      </Pressable>
      <Pressable
        onPress={() => setEditingStart(open => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: editingStart }}
        accessibilityLabel={`SMS sync starts: ${syncStartLabel(smsSyncStartAt)}. Change`}
        testID="settings-sync-start-row"
        style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
        <View style={styles.activityIcon}>
          <Icon name="calendar-start" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>
            SMS sync starts: {syncStartLabel(smsSyncStartAt)}
          </Text>
          <Text style={styles.activityCaption}>Where Sync SMS begins reading</Text>
        </View>
        <Icon name={editingStart ? 'chevron-up' : 'chevron-down'} size={22} color={colors.outline} />
      </Pressable>
      {editingStart ? (
        <SyncStartEditor
          currentMode={smsSyncStartMode}
          currentStartAt={smsSyncStartAt}
          saving={savingStart}
          onSave={handleSaveStart}
        />
      ) : null}
      <Text style={styles.title}>Profile & approvals</Text>
      <Text style={styles.subtitle}>
        Choose how detected SMS transactions are approved. Changes apply to future syncs only.
      </Text>
      <ProfileForm
        initialValues={{ userName, approvalMode, autoApproveThreshold }}
        onSubmit={handleSubmit}
        submitLabel="Save"
        submitting={saving}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radii.default,
    backgroundColor: colors.surfaceContainerLow,
  },
  pressed: {
    opacity: 0.7,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityText: {
    flex: 1,
  },
  activityTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  activityCaption: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
});
