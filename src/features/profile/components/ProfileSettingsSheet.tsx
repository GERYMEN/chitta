import React, { useState } from 'react';
import { StyleSheet, Text, ToastAndroid } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { BottomSheet } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { ProfileForm } from './ProfileForm';
import { ProfileFormValues } from './profileForm.schema';

export interface ProfileSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Home → tap greeting → edit name, approval mode and threshold. The sheet
 * unmounts its children when closed, so the form re-reads the store's
 * current values on every open.
 */
export function ProfileSettingsSheet({ visible, onClose }: ProfileSettingsSheetProps) {
  const { userName, approvalMode, autoApproveThreshold } = useTransactionsStore(
    useShallow(state => ({
      userName: state.userName,
      approvalMode: state.approvalMode,
      autoApproveThreshold: state.autoApproveThreshold,
    })),
  );
  const [saving, setSaving] = useState(false);

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
