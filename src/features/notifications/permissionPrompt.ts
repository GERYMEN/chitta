import { Linking, ToastAndroid } from 'react-native';
import { showDialog } from '../../shared/ui';

/** Shown when the user turned a notification type on but Android did not allow notifications. */
export function showNotificationsNotAllowed(reason: 'denied' | 'blocked'): void {
  if (reason === 'denied') {
    ToastAndroid.show('Not turned on — notifications were not allowed', ToastAndroid.LONG);
    return;
  }
  showDialog({
    title: 'Notifications are blocked',
    message: 'To get reminders, open Settings and allow notifications for Tracker.',
    icon: 'bell-off-outline',
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      { label: 'Open Settings', variant: 'primary', onPress: () => Linking.openSettings() },
    ],
  });
}
