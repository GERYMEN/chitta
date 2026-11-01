import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParamList } from './routes';

/**
 * Root navigation ref, for actions that outlive the screen that started them
 * (e.g. the R2b "View" snackbar action after Add account pops its screen).
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Open the Pending tab filtered to one account. No-op before the container is ready. */
export function openPendingForAccount(accountId: string): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Tabs', {
    screen: 'Pending',
    params: { accountId, focusKey: Date.now() },
  });
}

/** R4e: after a restore — a fresh stack with Home on top (no way "back" into old data). */
export function resetToHome(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.reset({ index: 0, routes: [{ name: 'Tabs', params: { screen: 'Home' } }] });
}
