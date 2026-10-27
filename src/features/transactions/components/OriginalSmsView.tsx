import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../../theme';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { readSmsById } from '../../../native/android/sms/smsReader';
import {
  checkSmsPermission,
  requestSmsPermission,
} from '../../../native/android/permissions/smsPermission';
import { SmsReference } from '../../sms-sync/smsReference';

/**
 * On-demand "source of truth" view: reads the exact SMS that produced a
 * transaction live from the device inbox by its id. The fetched text lives
 * ONLY in this component's state — it is never written to the store, the
 * database, logs, or the console, and it is dropped on hide/unmount.
 */
type ViewState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'shown'; address: string; body: string; receivedAtIso: string }
  | { kind: 'permissionDenied' }
  | { kind: 'notFound' }
  | { kind: 'error' };

export interface OriginalSmsViewProps {
  reference: SmsReference;
}

export function OriginalSmsView({ reference }: OriginalSmsViewProps) {
  const [state, setState] = useState<ViewState>({ kind: 'hidden' });
  // Incremented on every fetch/hide/unmount so a late native response can
  // never repopulate state after the user hid the box or left the screen.
  const requestToken = useRef(0);

  useEffect(() => {
    return () => {
      requestToken.current += 1;
    };
  }, []);

  // A different transaction means a different source — drop anything shown.
  useEffect(() => {
    requestToken.current += 1;
    setState({ kind: 'hidden' });
  }, [reference.smsId, reference.dateMs]);

  const load = useCallback(async () => {
    const token = ++requestToken.current;
    setState({ kind: 'loading' });
    try {
      const granted = await checkSmsPermission();
      if (token !== requestToken.current) return;
      if (!granted) {
        setState({ kind: 'permissionDenied' });
        return;
      }
      const message = await readSmsById(reference.smsId);
      if (token !== requestToken.current) return;
      // SMS ids can be reused after deletion: only show the message if it is
      // the exact one (same received timestamp) the transaction came from.
      if (!message || message.date !== reference.dateMs) {
        setState({ kind: 'notFound' });
        return;
      }
      setState({
        kind: 'shown',
        address: message.address,
        body: message.body,
        receivedAtIso: new Date(message.date).toISOString(),
      });
    } catch (error) {
      if (token !== requestToken.current) return;
      const code = (error as { code?: string } | null)?.code;
      setState({ kind: code === 'E_SMS_PERMISSION_DENIED' ? 'permissionDenied' : 'error' });
    }
  }, [reference.smsId, reference.dateMs]);

  const hide = useCallback(() => {
    requestToken.current += 1;
    setState({ kind: 'hidden' });
  }, []);

  const requestAccess = useCallback(async () => {
    // One explicit, user-initiated request per tap — never auto-repeated.
    const result = await requestSmsPermission();
    if (result === 'granted') {
      load();
    }
  }, [load]);

  if (state.kind === 'hidden') {
    return (
      <Text style={styles.linkText} onPress={load} accessibilityRole="button">
        View original SMS
      </Text>
    );
  }

  return (
    <View style={styles.wrapper}>
      <Text style={styles.linkText} onPress={hide} accessibilityRole="button">
        Hide original SMS
      </Text>
      {state.kind === 'loading' ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.statusText}>Reading from your inbox…</Text>
        </View>
      ) : null}
      {state.kind === 'shown' ? (
        <View style={styles.sourceBox}>
          <Text style={styles.sourceLabel}>
            ORIGINAL SMS · read live from your inbox, not stored
          </Text>
          <Text style={styles.metaText}>
            From {state.address} · {formatTransactionTimestamp(state.receivedAtIso)}
          </Text>
          <Text style={styles.bodyText} selectable>
            {state.body}
          </Text>
        </View>
      ) : null}
      {state.kind === 'permissionDenied' ? (
        <View style={styles.sourceBox}>
          <Text style={styles.statusText}>Allow SMS access to view the original message</Text>
          <Text style={styles.linkText} onPress={requestAccess} accessibilityRole="button">
            Allow SMS access
          </Text>
        </View>
      ) : null}
      {state.kind === 'notFound' ? (
        <View style={styles.sourceBox}>
          <Text style={styles.statusText}>Original message no longer in inbox</Text>
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <View style={styles.sourceBox}>
          <Text style={styles.statusText}>Couldn&apos;t read the message</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  linkText: {
    ...typography.labelLg,
    color: colors.primary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  sourceBox: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sourceLabel: {
    ...typography.labelSm,
    color: colors.outline,
    letterSpacing: 0.5,
  },
  metaText: {
    ...typography.labelSm,
    color: colors.outline,
  },
  bodyText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
});
