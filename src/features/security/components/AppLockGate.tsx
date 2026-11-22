import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../../theme';
import { Button } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { clock } from '../../../shared/utils/clock';
import { authenticate, canUseAppLock } from '../../../native/android/security/biometricNative';
import { getAppLockConfig } from '../securitySettings';
import { shouldLock } from '../appLock';

type Phase = 'pending' | 'locked' | 'open';

/**
 * A phone with no screen lock / biometric cannot unlock, so the gate stays open
 * there instead of trapping the owner (e.g. a backup restored onto a new phone).
 * A transient 'unavailable' still locks: Unlock can be retried.
 */
async function canEnforce(): Promise<boolean> {
  const availability = await canUseAppLock();
  return availability === 'available' || availability === 'unavailable';
}

interface AppLockGateProps {
  /** True once the DB is open and the app-lock setting has been loaded. */
  ready: boolean;
  children: React.ReactNode;
}

/**
 * R9b: UI gate only. While locked an opaque overlay covers the app and the
 * content below is hidden from touch and accessibility. Cold launch (when
 * enabled) and a return from background past the timeout lock; Unlock runs the
 * system prompt (biometric or device PIN) and can be retried after a cancel.
 * Content stays mounted, so navigation state survives a lock.
 */
export function AppLockGate({ ready, children }: AppLockGateProps) {
  const [phase, setPhase] = useState<Phase>('pending');
  const phaseRef = useRef<Phase>('pending');
  const backgroundedAt = useRef<number | null>(null);
  const inFlight = useRef(false);

  const move = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const unlock = useCallback(async () => {
    if (inFlight.current || phaseRef.current !== 'locked') return;
    inFlight.current = true;
    try {
      const ok = await authenticate('Unlock Tracker', 'Use your fingerprint, face or screen lock');
      if (ok) {
        backgroundedAt.current = null;
        move('open');
      }
    } finally {
      inFlight.current = false;
    }
  }, [move]);

  const lockIfRequired = useCallback(
    async (coldLaunch: boolean) => {
      const { enabled, timeout } = getAppLockConfig();
      const lock = shouldLock(enabled, timeout, backgroundedAt.current, clock.now().getTime(), coldLaunch);
      if (lock && (await canEnforce())) {
        backgroundedAt.current = null;
        move('locked');
      } else if (coldLaunch) {
        move('open');
      }
    },
    [move],
  );

  // Cold launch decision, once the setting is loaded.
  useEffect(() => {
    if (ready) lockIfRequired(true).catch(() => move('open'));
  }, [ready, lockIfRequired, move]);

  // Background timestamp + re-evaluation on foreground.
  useEffect(() => {
    if (!ready) return undefined;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        if (phaseRef.current === 'open') backgroundedAt.current = clock.now().getTime();
      } else if (next === 'active') {
        if (phaseRef.current === 'open' && backgroundedAt.current !== null) {
          lockIfRequired(false).catch(() => undefined);
        } else if (phaseRef.current === 'locked') {
          unlock().catch(() => undefined);
        }
      }
    });
    return () => subscription.remove();
  }, [ready, lockIfRequired, unlock]);

  // Prompt as soon as the lock appears.
  useEffect(() => {
    if (phase === 'locked') unlock().catch(() => undefined);
  }, [phase, unlock]);

  const covered = phase !== 'open';
  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={covered}>
        {children}
      </View>
      {covered ? (
        <View style={styles.overlay} testID="app-lock-overlay">
          {phase === 'locked' ? (
            <>
              <Icon name="lock-outline" size={48} color={colors.onSurfaceVariant} />
              <Text style={styles.title}>Tracker is locked</Text>
              <Button label="Unlock" onPress={() => unlock().catch(() => undefined)} testID="app-lock-unlock" />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  title: { ...typography.headlineSm, color: colors.onSurface },
});
