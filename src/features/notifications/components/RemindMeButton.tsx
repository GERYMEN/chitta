import React from 'react';
import { Pressable, StyleSheet, Text, ToastAndroid } from 'react-native';
import { colors, spacing, typography } from '../../../theme';
import { showNotificationsNotAllowed } from '../permissionPrompt';
import { useRemindersStore } from '../state/remindersStore';

/**
 * R8b (D-d): "Remind me?" on an Upcoming series. Tapping turns a reminder for
 * that series on (it also switches recurring reminders on and asks for the
 * notification permission the first time); tapping again turns it off.
 */
export function RemindMeButton({ merchantKey, displayName }: { merchantKey: string; displayName: string }) {
  const keys = useRemindersStore(state => state.keys);
  const toggle = useRemindersStore(state => state.toggle);
  const reminded = keys.includes(merchantKey);

  async function onPress() {
    try {
      const result = await toggle(merchantKey, !reminded);
      if (!result.ok) showNotificationsNotAllowed(result.reason);
    } catch {
      ToastAndroid.show('Could not save — please try again.', ToastAndroid.LONG);
    }
  }

  return (
    <Pressable
      onPress={onPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityState={{ selected: reminded }}
      accessibilityLabel={reminded ? `Reminder on: ${displayName}. Tap to turn off` : `Remind me: ${displayName}`}
      testID={`remind-me-${merchantKey}`}>
      <Text style={styles.label}>{reminded ? 'Reminder on' : 'Remind me?'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: spacing.sm },
  label: { ...typography.labelLg, color: colors.primary },
});
