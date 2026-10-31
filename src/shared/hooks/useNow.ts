import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { clock } from '../utils/clock';

/**
 * R4 (fixes B1): a screen's injected "now" — the device clock, re-read when
 * the screen gains focus, when the app comes back to the foreground (a tab
 * can stay focused overnight), and when `refreshKey` changes (pass the
 * store's transactions so a row approved on screen is never newer than
 * "now"). One value feeds both the period range and the date headers, so
 * they can never disagree.
 */
export function useNow(refreshKey?: unknown): Date {
  const [now, setNow] = useState(() => clock.now());
  const refresh = useCallback(() => {
    setNow(clock.now());
  }, []);

  useFocusEffect(refresh);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const seenKey = useRef(false);
  useEffect(() => {
    // The first run is the mount itself (already fresh); refresh on changes.
    if (!seenKey.current) {
      seenKey.current = true;
      return;
    }
    refresh();
  }, [refreshKey, refresh]);

  return now;
}
