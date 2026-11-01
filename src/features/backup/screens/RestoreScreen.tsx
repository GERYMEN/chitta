import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  confirmDialog,
  HeaderBackButton,
  HeaderSpacer,
  showSnackbar,
} from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { resetToHome } from '../../../app/navigation/navigationRef';
import { canTryRestorePassword } from '../../../domain/backup/backupPassword';
import { BackupError, BACKUP_ERROR_MESSAGES } from '../../../domain/backup/backup.payload';
import type { PickedBackup } from '../../../native/android/backup/backupNative';
import { useSyncRunStore } from '../../sms-sync/syncRunner';
import { PasswordField } from '../components/PasswordField';
import { backupScreenStyles as styles } from '../components/backupScreenStyles';
import { abandonRestore, openBackup, pickBackup, restoreBackup } from '../backupService';
import {
  BACKUP_RESTORED_MESSAGE,
  RESTORE_REPLACES_WARNING,
  restoreConfirmMessage,
} from '../backupLabels';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function messageOf(error: unknown): string {
  return error instanceof BackupError ? error.message : BACKUP_ERROR_MESSAGES.io;
}

/**
 * R4e "Restore from backup" (Settings, or the onboarding link): pick the
 * file → password → confirm "Replace all data…?" → restore (one DB
 * transaction) → every store reloads → Home + "Backup restored".
 * The password lives only in this screen's state.
 */
export function RestoreScreen() {
  const navigation = useNavigation<Nav>();
  const syncRunning = useSyncRunStore(state => state.running);
  const [picked, setPicked] = useState<PickedBackup | null>(null);
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  useEffect(
    () => () => {
      // Leaving without restoring: drop the remembered file grant.
      if (!restored.current) abandonRestore().catch(() => undefined);
    },
    [],
  );

  async function handlePick() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const file = await pickBackup();
      setPassword('');
      setPicked(file);
    } catch (e) {
      if (!(e instanceof BackupError && e.code === 'cancelled')) setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    if (!picked || !canTryRestorePassword(password) || busy) return;
    setError(null);
    setBusy(true);
    try {
      const opened = await openBackup(picked, password);
      const ok = await confirmDialog({
        title: 'Restore this backup?',
        message: restoreConfirmMessage(opened.summary),
        icon: 'database-import-outline',
        confirmLabel: 'Replace all data',
        destructive: true,
      });
      if (!ok) return;
      await restoreBackup(opened);
      restored.current = true;
      setPassword('');
      showSnackbar({ message: BACKUP_RESTORED_MESSAGE });
      resetToHome();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle} accessibilityRole="header">
          Restore from backup
        </Text>
        <HeaderSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Open a Tracker backup file (.trkbak) and enter the password it was saved with.
        </Text>
        <View style={styles.warning} accessible accessibilityLabel={RESTORE_REPLACES_WARNING}>
          <Icon name="alert-outline" size={20} color={colors.onTertiaryContainer} />
          <Text style={styles.warningText}>{RESTORE_REPLACES_WARNING}</Text>
        </View>
        {syncRunning ? (
          <Text style={styles.meta} testID="restore-sync-running">
            {BACKUP_ERROR_MESSAGES.busy}
          </Text>
        ) : null}

        {picked ? (
          <>
            <View style={styles.fileRow} testID="restore-file">
              <Icon name="file-lock-outline" size={22} color={colors.onSurfaceVariant} />
              <Text style={styles.fileName} numberOfLines={1}>
                {picked.name || 'Backup file'}
              </Text>
            </View>
            <PasswordField
              label="Backup password"
              value={password}
              onChangeText={setPassword}
              visible={visible}
              onToggleVisible={() => setVisible(v => !v)}
              testID="restore-password"
              onSubmitEditing={handleOpen}
              autoFocus
            />
          </>
        ) : null}

        {error ? (
          <View style={styles.errorBox} testID="restore-error" accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {picked ? (
          <>
            <Button
              label="Restore"
              onPress={handleOpen}
              disabled={!canTryRestorePassword(password) || syncRunning}
              loading={busy}
              testID="restore-open"
            />
            <Button
              label="Choose a different file"
              variant="ghost"
              onPress={handlePick}
              disabled={busy || syncRunning}
              testID="restore-pick-again"
            />
          </>
        ) : (
          <Button
            label="Choose backup file"
            onPress={handlePick}
            disabled={syncRunning}
            loading={busy}
            testID="restore-pick"
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
