import React, { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { ProfileForm } from '../../profile/components/ProfileForm';
import { ProfileFormValues } from '../../profile/components/profileForm.schema';
import {
  DEFAULT_APPROVAL_MODE,
  DEFAULT_AUTO_APPROVE_THRESHOLD,
} from '../../../domain/settings/approval.rules';
import { RootStackParamList } from '../../../app/navigation/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Onboarding step between the tour and Permissions: the user's name and how
 * SMS transactions are approved (Manual by default; Auto with a 70–100%
 * confidence threshold is opt-in).
 */
export function ProfileSetupScreen() {
  const navigation = useNavigation<Nav>();
  const [saving, setSaving] = useState(false);

  async function handleSubmit(values: ProfileFormValues) {
    setSaving(true);
    try {
      await useTransactionsStore.getState().updateProfile(values);
      navigation.replace('Permissions');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior="height">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.brand}>Tracker</Text>
          </View>
          <View style={styles.stepRow}>
            <Text style={styles.stepLabel}>STEP 7 OF 8 · PROFILE</Text>
          </View>
          <Text style={styles.headline}>Let's set you up.</Text>
          <Text style={styles.subtext}>
            Tell us your name and choose how detected SMS transactions are approved. You can
            change this later from Home.
          </Text>
          <ProfileForm
            initialValues={{
              userName: '',
              approvalMode: DEFAULT_APPROVAL_MODE,
              autoApproveThreshold: DEFAULT_AUTO_APPROVE_THRESHOLD,
            }}
            onSubmit={handleSubmit}
            submitLabel="Continue"
            submitting={saving}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  header: {
    paddingVertical: spacing.sm,
  },
  brand: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  stepRow: {
    marginTop: spacing.sm,
  },
  stepLabel: {
    ...typography.labelMd,
    color: colors.primary,
  },
  headline: {
    ...typography.headlineLgMobile,
    color: colors.onSurface,
  },
  subtext: {
    ...typography.bodyLg,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.sm,
  },
});
