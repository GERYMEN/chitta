import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, ToastAndroid, View } from 'react-native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { NotificationSettings } from '../../../domain/notifications/notifications.rules';
import {
  NOTIF_BILLS_KEY,
  NOTIF_RECURRING_KEY,
  NOTIF_WEEKLY_KEY,
  NotificationTypeKey,
  readNotificationSettings,
} from '../notificationConfig';
import { setNotificationType, setWeeklyDay, setWeeklyHour } from '../notificationSettings';
import { showNotificationsNotAllowed } from '../permissionPrompt';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = [8, 9, 12, 18, 20];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;

const ROWS: Array<{ key: NotificationTypeKey; field: 'bills' | 'recurring' | 'weekly'; title: string; caption: string; icon: string; id: string }> = [
  { key: NOTIF_BILLS_KEY, field: 'bills', title: 'Bill reminders', caption: 'When a bill is due or overdue', icon: 'file-document-alert-outline', id: 'bills' },
  { key: NOTIF_RECURRING_KEY, field: 'recurring', title: 'Recurring payment reminders', caption: 'For the payments you pick with "Remind me?"', icon: 'calendar-clock', id: 'recurring' },
  { key: NOTIF_WEEKLY_KEY, field: 'weekly', title: 'Weekly summary', caption: 'Spent this week and what is pending', icon: 'chart-box-outline', id: 'weekly' },
];

const DEFAULTS: NotificationSettings = { bills: false, recurring: false, weekly: false, weeklyDay: 0, weeklyHour: 9 };

/**
 * R8b: the three opt-in notification toggles (all OFF by default) plus the
 * weekly day / hour. Turning the first one on asks for notification permission.
 * Amounts are left out of every notification while Private mode is on.
 */
export function NotificationSettingsRows({ visible }: { visible: boolean }) {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULTS);

  const reload = useCallback(() => {
    readNotificationSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (visible) reload();
  }, [visible, reload]);

  async function guarded(action: () => Promise<void>) {
    try {
      await action();
    } catch {
      ToastAndroid.show('Could not save settings — please try again.', ToastAndroid.LONG);
    }
    reload();
  }

  function onToggle(key: NotificationTypeKey, on: boolean) {
    return guarded(async () => {
      const result = await setNotificationType(key, on);
      if (!result.ok) showNotificationsNotAllowed(result.reason);
    });
  }

  return (
    <>
      {ROWS.map(row => {
        const on = settings[row.field];
        return (
          <View key={row.key}>
            <View style={styles.row} testID={`settings-notif-${row.id}-row`}>
              <View style={styles.icon}>
                <Icon name={row.icon} size={20} color={colors.onSurfaceVariant} />
              </View>
              <View style={styles.text}>
                <Text style={styles.title}>{row.title}</Text>
                <Text style={styles.caption}>{row.caption}</Text>
              </View>
              <Switch
                value={on}
                onValueChange={next => onToggle(row.key, next)}
                accessibilityLabel={`${row.title}. ${on ? 'On' : 'Off. Turn on'}`}
                testID={`settings-notif-${row.id}-switch`}
              />
            </View>
            {row.field === 'weekly' && on ? (
              <View style={styles.chips} testID="settings-notif-weekly-when">
                <Text style={styles.caption}>Day</Text>
                {DAYS.map((label, day) => (
                  <Chip
                    key={label}
                    label={label}
                    selected={day === settings.weeklyDay}
                    testID={`settings-notif-weekly-day-${day}`}
                    onPress={() => guarded(() => setWeeklyDay(day))}
                  />
                ))}
                <Text style={styles.caption}>Time</Text>
                {HOURS.map(h => (
                  <Chip
                    key={h}
                    label={hourLabel(h)}
                    selected={h === settings.weeklyHour}
                    testID={`settings-notif-weekly-hour-${h}`}
                    onPress={() => guarded(() => setWeeklyHour(h))}
                  />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
      style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radii.default,
    backgroundColor: colors.surfaceContainerLow,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  title: { ...typography.labelLg, color: colors.onSurface },
  caption: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.labelLg, color: colors.onSurface },
  chipTextOn: { color: colors.onPrimary },
});
