import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button } from '../../../shared/ui';
import { spacing } from '../../../theme';
import { SyncStartOptions } from './SyncStartOptions';
import {
  formatStartDate,
  SmsSyncStartMode,
  startForChoice,
  startForCustomDate,
} from '../../../domain/settings/smsSyncStart.rules';

export interface SyncStartEditorProps {
  currentMode: SmsSyncStartMode | null;
  currentStartAt: string | null;
  saving?: boolean;
  onSave: (mode: SmsSyncStartMode, startAt: string | null) => void;
}

/** The start a selection means right now ('custom' = the picked day). */
export function selectionStart(
  mode: SmsSyncStartMode,
  customStartAt: string | null,
  now: Date = new Date(),
): string | null {
  if (mode === 'custom') return customStartAt;
  return startForChoice(mode, now);
}

/**
 * R4b Settings: the 4 onboarding choices + "Pick a date" (the existing
 * @react-native-community/datetimepicker, already used by the forms).
 */
export function SyncStartEditor({
  currentMode,
  currentStartAt,
  saving = false,
  onSave,
}: SyncStartEditorProps) {
  const [mode, setMode] = useState<SmsSyncStartMode | null>(currentMode);
  const [customStartAt, setCustomStartAt] = useState<string | null>(
    currentMode === 'custom' ? currentStartAt : null,
  );
  const [picking, setPicking] = useState(false);

  function handlePicked(event: DateTimePickerEvent, date?: Date) {
    setPicking(false);
    if (event.type !== 'set' || !date) return;
    setCustomStartAt(startForCustomDate(date));
    setMode('custom');
  }

  const canSave = mode != null && (mode !== 'custom' || customStartAt != null);

  return (
    <View style={styles.wrap}>
      <SyncStartOptions
        value={mode}
        onChange={setMode}
        showCustom
        customLabel={customStartAt ? formatStartDate(customStartAt) : null}
        onPickCustom={() => setPicking(true)}
      />
      <Button
        label="Save start"
        variant="primary"
        disabled={!canSave || saving}
        loading={saving}
        onPress={() => {
          if (mode == null) return;
          onSave(mode, selectionStart(mode, customStartAt));
        }}
        testID="sync-start-save"
      />
      {picking ? (
        <DateTimePicker
          value={customStartAt ? new Date(customStartAt) : new Date()}
          mode="date"
          maximumDate={new Date()}
          onChange={handlePicked}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
});
