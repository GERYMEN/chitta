import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, ToastAndroid, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { NotificationSettingsRows } from '../../notifications/components/NotificationSettingsRows';
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
import { useBackupStore } from '../../backup/backupStore';
import { lastBackupLabel } from '../../backup/backupLabels';
import { useSmsReaderStore, visibleUnparsed } from '../../sms-sync/smsReaderStore';
import { effectiveAutoRead } from '../../sms-sync/autoRead/autoReadRules';
import { rulesAboutLabel } from '../../sms-sync/rules/rulesLoader';
import { useRedacted } from '../../../shared/privacy/redaction';
import {
  APP_LOCK_TIMEOUTS,
  AppLockTimeout,
  disableAppLock,
  enableAppLock,
  getAppLockConfig,
  readSecuritySettings,
  setAppLockTimeout,
  setHideAmounts,
  setSecureScreen,
} from '../../security/securitySettings';
import { exportApprovedTransactionsCsv } from '../../security/exportService';
import { MeaningRulesSection } from '../../meaning/components/MeaningRulesSection';

export interface ProfileSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Opens the Activity feed (R1). Activity lives here, not in a 5th tab. */
  onOpenActivity: () => void;
  /** Opens category management (R2). */
  onOpenCategories: () => void;
  /** R5b: open Bills & dues. */
  onOpenBills?: () => void;
  /** R5c: open Budgets. */
  onOpenBudgets?: () => void;
  /** R10: open People & IOUs. */
  onOpenPeople?: () => void;
  /**
   * R4b: start moved earlier and confirmed — scan only the gap, then call
   * `onCompleted` (saves the new start) if the scan finished.
   */
  onScanGap: (window: SyncWindow, onCompleted: () => Promise<void>) => void;
  /** R4c: "Replay tour" — shows the first-run coach marks again. */
  onReplayTour?: () => void;
  /** R4e: "Back up data" (password-encrypted file). */
  onOpenBackup?: () => void;
  /** R4e: "Restore from backup" (replaces everything). */
  onOpenRestore?: () => void;
  /** R5: "Re-read messages with the new reader". */
  onRescan?: () => void;
  /** R5: "Messages not understood". */
  onOpenNotUnderstood?: () => void;
  /** R5j: "Hidden accounts" (ignored new accounts, with Un-ignore). */
  onOpenIgnoredAccounts?: () => void;
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
  onOpenBills,
  onOpenBudgets,
  onOpenPeople,
  onScanGap,
  onReplayTour,
  onOpenBackup,
  onOpenRestore,
  onRescan,
  onOpenNotUnderstood,
  onOpenIgnoredAccounts,
}: ProfileSettingsSheetProps) {
  // R5: auto-read toggle + not-understood count (counts only).
  const autoReadSetting = useSmsReaderStore(state => state.autoReadSetting);
  const receiveGranted = useSmsReaderStore(state => state.receiveGranted);
  const autoReadOn = effectiveAutoRead(autoReadSetting, receiveGranted);
  const unparsedRows = useSmsReaderStore(state => state.unparsed);
  const allTransactions = useTransactionsStore(state => state.transactions);
  const notUnderstoodCount = visibleUnparsed(unparsedRows, allTransactions).length;
  const [togglingAutoRead, setTogglingAutoRead] = useState(false);
  // R9a: Private mode (key hide_amounts; live truth = the redaction flag), secure screen, CSV export.
  const hideAmounts = useRedacted();
  const [secureScreen, setSecureScreenState] = useState(false);
  const [exporting, setExporting] = useState(false);
  // R9b: app lock (live truth = the loaded app-lock config).
  const [appLockOn, setAppLockOn] = useState(false);
  const [appLockTimeout, setAppLockTimeoutState] = useState<AppLockTimeout>('immediate');

  async function handleHideAmounts(on: boolean) {
    try {
      await setHideAmounts(on);
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    }
  }

  async function handleAppLock(on: boolean) {
    try {
      if (!on) {
        await disableAppLock();
        setAppLockOn(false);
        return;
      }
      const result = await enableAppLock();
      if (result.ok) {
        setAppLockOn(true);
      } else {
        showDialog({
          title: 'Set up a screen lock first',
          message:
            result.reason === 'unavailable'
              ? 'App lock is not available right now. Try again in a moment.'
              : 'App lock uses your fingerprint, face or screen lock. Set one up in your phone Settings, then turn App lock on.',
          icon: 'lock-alert-outline',
          actions: [{ label: 'OK', variant: 'primary' }],
        });
      }
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    }
  }

  async function handleAppLockTimeout(timeout: AppLockTimeout) {
    try {
      await setAppLockTimeout(timeout);
      setAppLockTimeoutState(timeout);
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    }
  }

  async function handleSecureScreen(on: boolean) {
    try {
      await setSecureScreen(on);
      setSecureScreenState(on);
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    }
  }

  async function handleExportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const outcome = await exportApprovedTransactionsCsv();
      if (outcome.saved) {
        ToastAndroid.show(`Exported ${outcome.rows} transactions`, ToastAndroid.SHORT);
      }
    } catch {
      ToastAndroid.show('Could not export — please try again.', ToastAndroid.LONG);
    } finally {
      setExporting(false);
    }
  }

  async function handleAutoRead(on: boolean) {
    setTogglingAutoRead(true);
    try {
      const result = await useSmsReaderStore.getState().setAutoRead(on);
      if (result === 'blocked') {
        showDialog({
          title: 'SMS permission blocked',
          message:
            'To read new SMS automatically, open Settings and allow SMS permission for Tracker.',
          icon: 'shield-alert-outline',
          actions: [
            { label: 'Cancel', variant: 'ghost' },
            { label: 'Open Settings', variant: 'primary', onPress: () => Linking.openSettings() },
          ],
        });
      } else if (result === 'denied') {
        ToastAndroid.show('Not turned on — SMS permission was not allowed', ToastAndroid.LONG);
      }
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    } finally {
      setTogglingAutoRead(false);
    }
  }
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
  const lastBackupAt = useBackupStore(state => state.lastBackupAt);

  useEffect(() => {
    if (visible) {
      useBackupStore.getState().load();
      readSecuritySettings()
        .then(s => setSecureScreenState(s.secureScreen))
        .catch(() => undefined);
      setAppLockOn(getAppLockConfig().enabled);
      setAppLockTimeoutState(getAppLockConfig().timeout);
      // R5: the grant may have changed in system settings.
      useSmsReaderStore.getState().load().catch(() => undefined);
    }
  }, [visible]);

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
      {onOpenBills ? (
        <Pressable
          onPress={onOpenBills}
          accessibilityRole="button"
          accessibilityLabel="Bills and dues"
          testID="settings-bills-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="file-document-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Bills & dues</Text>
            <Text style={styles.activityCaption}>Card statements, bills and reminders</Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      {onOpenBudgets ? (
        <Pressable
          onPress={onOpenBudgets}
          accessibilityRole="button"
          accessibilityLabel="Budgets"
          testID="settings-budgets-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="gauge" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Budgets</Text>
            <Text style={styles.activityCaption}>Monthly spending caps, overall and by category</Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      {onOpenPeople ? (
        <Pressable
          onPress={onOpenPeople}
          accessibilityRole="button"
          accessibilityLabel="People and IOUs"
          testID="settings-people-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="account-cash-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>People & IOUs</Text>
            <Text style={styles.activityCaption}>Who owes you, and who you owe</Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      {onReplayTour ? (
        <Pressable
          onPress={onReplayTour}
          accessibilityRole="button"
          accessibilityLabel="Replay tour"
          testID="settings-replay-tour-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="map-marker-path" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Replay tour</Text>
            <Text style={styles.activityCaption}>Show the quick app tour again</Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      {onOpenBackup ? (
        <Pressable
          onPress={onOpenBackup}
          accessibilityRole="button"
          accessibilityLabel={`Back up data. ${lastBackupLabel(lastBackupAt)}`}
          testID="settings-backup-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="shield-lock-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Back up data</Text>
            <Text style={styles.activityCaption} testID="settings-last-backup">
              {lastBackupLabel(lastBackupAt)}
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      {onOpenRestore ? (
        <Pressable
          onPress={onOpenRestore}
          accessibilityRole="button"
          accessibilityLabel="Restore from backup"
          testID="settings-restore-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="database-import-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Restore from backup</Text>
            <Text style={styles.activityCaption}>Replace all data with a backup file</Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      <View style={styles.activityRow} testID="settings-hide-amounts-row">
        <View style={styles.activityIcon}>
          <Icon name="eye-off-outline" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>Private mode</Text>
          <Text style={styles.activityCaption}>Hides amounts, names, notes and card numbers</Text>
        </View>
        <Switch
          value={hideAmounts}
          onValueChange={handleHideAmounts}
          accessibilityLabel={`Private mode. ${hideAmounts ? 'On' : 'Off. Turn on'}`}
          testID="settings-hide-amounts-switch"
        />
      </View>
      <View style={styles.activityRow} testID="settings-app-lock-row">
        <View style={styles.activityIcon}>
          <Icon name="lock-outline" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>App lock</Text>
          <Text style={styles.activityCaption}>Ask for fingerprint, face or screen lock to open</Text>
        </View>
        <Switch
          value={appLockOn}
          onValueChange={handleAppLock}
          accessibilityLabel={`App lock. ${appLockOn ? 'On' : 'Off. Turn on'}`}
          testID="settings-app-lock-switch"
        />
      </View>
      {appLockOn ? (
        <View style={styles.lockTimeoutRow} testID="settings-app-lock-timeout-row">
          <Text style={styles.activityCaption}>Lock again</Text>
          {APP_LOCK_TIMEOUTS.map(option => {
            const selected = option === appLockTimeout;
            const label =
              option === 'immediate' ? 'Right away' : option === '1' ? 'After 1 min' : 'After 5 min';
            return (
              <Pressable
                key={option}
                onPress={() => handleAppLockTimeout(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Lock ${label.toLowerCase()}`}
                testID={`settings-app-lock-timeout-${option}`}
                style={[styles.lockTimeoutChip, selected && styles.lockTimeoutChipOn]}>
                <Text style={[styles.lockTimeoutText, selected && styles.lockTimeoutTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* R8b: opt-in notifications (all off by default). */}
      <NotificationSettingsRows visible={visible} />
      <View style={styles.activityRow} testID="settings-secure-screen-row">
        <View style={styles.activityIcon}>
          <Icon name="shield-lock-outline" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>Hide in recents and block screenshots</Text>
          <Text style={styles.activityCaption}>Takes effect right away</Text>
        </View>
        <Switch
          value={secureScreen}
          onValueChange={handleSecureScreen}
          accessibilityLabel={`Hide in recents and block screenshots. ${secureScreen ? 'On' : 'Off. Turn on'}`}
          testID="settings-secure-screen-switch"
        />
      </View>
      <Pressable
        onPress={handleExportCsv}
        disabled={exporting}
        accessibilityRole="button"
        accessibilityLabel="Export transactions (CSV)"
        testID="settings-export-csv-row"
        style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
        <View style={styles.activityIcon}>
          <Icon name="file-document-outline" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>Export transactions (CSV)</Text>
          <Text style={styles.activityCaption}>Approved transactions, saved where you choose</Text>
        </View>
        <Icon name="chevron-right" size={22} color={colors.outline} />
      </Pressable>
      <View style={styles.activityRow} testID="settings-auto-read-row">
        <View style={styles.activityIcon}>
          <Icon name="message-badge-outline" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>Read new SMS automatically</Text>
          <Text style={styles.activityCaption}>
            {autoReadOn
              ? 'New bank SMS go to Pending on their own'
              : receiveGranted
              ? 'Off — use Sync SMS'
              : 'Off — Turn on to allow reading new SMS'}
          </Text>
        </View>
        <Switch
          value={autoReadOn}
          disabled={togglingAutoRead}
          onValueChange={handleAutoRead}
          accessibilityLabel={`Read new SMS automatically. ${autoReadOn ? 'On' : 'Off. Turn on'}`}
          testID="settings-auto-read-switch"
        />
      </View>
      {onRescan ? (
        <Pressable
          onPress={onRescan}
          accessibilityRole="button"
          accessibilityLabel="Re-read messages with the new reader"
          testID="settings-rescan-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="message-text-clock-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Re-read messages with the new reader</Text>
            <Text style={styles.activityCaption}>
              From {syncStartLabel(smsSyncStartAt)} · existing items stay as they are
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      {/* R5e: stored meaning rules ("Do this automatically next time"). */}
      <MeaningRulesSection />
      {onOpenNotUnderstood ? (
        <Pressable
          onPress={onOpenNotUnderstood}
          accessibilityRole="button"
          accessibilityLabel={`Messages not understood: ${notUnderstoodCount}`}
          testID="settings-not-understood-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="message-question-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Messages not understood</Text>
            <Text style={styles.activityCaption}>
              {notUnderstoodCount === 0 ? 'None right now' : `${notUnderstoodCount} to review`}
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
      {onOpenIgnoredAccounts ? (
        <Pressable
          onPress={onOpenIgnoredAccounts}
          accessibilityRole="button"
          accessibilityLabel="Hidden accounts"
          testID="settings-hidden-accounts-row"
          style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]}>
          <View style={styles.activityIcon}>
            <Icon name="eye-off-outline" size={20} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.activityText}>
            <Text style={styles.activityTitle}>Hidden accounts</Text>
            <Text style={styles.activityCaption}>Accounts you chose to ignore · Un-ignore</Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.outline} />
        </Pressable>
      ) : null}
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
      {/* R5g T5 / item 24: the SMS rules document in use (version + bank count). */}
      <View style={styles.activityRow} testID="settings-about">
        <View style={styles.activityIcon}>
          <Icon name="information-outline" size={20} color={colors.onSurfaceVariant} />
        </View>
        <View style={styles.activityText}>
          <Text style={styles.activityTitle}>About</Text>
          <Text style={styles.activityCaption} testID="settings-about-rules">
            {rulesAboutLabel()}
          </Text>
        </View>
      </View>
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
  lockTimeoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  lockTimeoutChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  lockTimeoutChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  lockTimeoutText: { ...typography.labelLg, color: colors.onSurface },
  lockTimeoutTextOn: { color: colors.onPrimary },
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
