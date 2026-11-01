import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, HeaderBackButton, HeaderSpacer, showSnackbar } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { checkNewBackupPassword } from '../../../domain/backup/backupPassword';
import { BackupError, BACKUP_ERROR_MESSAGES } from '../../../domain/backup/backup.payload';
import { PasswordField } from '../components/PasswordField';
import { backupScreenStyles as styles } from '../components/backupScreenStyles';
import { saveBackup } from '../backupService';
import { useBackupStore } from '../backupStore';
import { BACKUP_SAVED_MESSAGE, FORGOT_PASSWORD_WARNING, lastBackupLabel } from '../backupLabels';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * R4e Settings → "Back up data": password + confirm (min 8, show/hide),
 * the forgot-password warning, then [Save backup file] → the system "save
 * as" picker → "Backup saved". The password lives only in this screen's
 * state and is cleared after a save.
 */
export function BackupScreen() {
  const navigation = useNavigation<Nav>();
  const lastBackupAt = useBackupStore(state => state.lastBackupAt);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    useBackupStore.getState().load();
  }, []);

  const check = checkNewBackupPassword(password, confirm);
  const passwordError = password.length > 0 ? check.passwordError : null;
  const confirmError = confirm.length > 0 ? check.confirmError : null;

  async function handleSave() {
    if (!check.valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await saveBackup(password);
      if (outcome.saved) {
        setPassword('');
        setConfirm('');
        showSnackbar({ message: BACKUP_SAVED_MESSAGE });
        navigation.goBack();
      }
    } catch (e) {
      setError(e instanceof BackupError ? e.message : BACKUP_ERROR_MESSAGES.io);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle} accessibilityRole="header">
          Back up data
        </Text>
        <HeaderSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Saves an encrypted copy of all your Tracker data — accounts, transactions, categories,
          rules, settings and activity — to a file you choose (Downloads, Drive or anywhere else).
          Use it to move Tracker to a new phone or a new install.
        </Text>
        <Text style={styles.meta} testID="backup-last-date">
          {lastBackupLabel(lastBackupAt)}
        </Text>
        <PasswordField
          label="Backup password"
          value={password}
          onChangeText={setPassword}
          visible={visible}
          onToggleVisible={() => setVisible(v => !v)}
          error={passwordError}
          testID="backup-password"
        />
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          visible={visible}
          onToggleVisible={() => setVisible(v => !v)}
          error={confirmError}
          testID="backup-password-confirm"
          onSubmitEditing={handleSave}
        />
        <View style={styles.warning} accessible accessibilityLabel={FORGOT_PASSWORD_WARNING}>
          <Icon name="alert-outline" size={20} color={colors.onTertiaryContainer} />
          <Text style={styles.warningText}>{FORGOT_PASSWORD_WARNING}</Text>
        </View>
        {error ? (
          <View style={styles.errorBox} testID="backup-error" accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <Button
          label="Save backup file"
          onPress={handleSave}
          disabled={!check.valid}
          loading={saving}
          testID="backup-save"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
