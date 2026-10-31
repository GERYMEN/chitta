import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '../../icons';
import { colors } from '../../../theme';

/** Touch target of the header back button (and its spacer), dp. */
export const HEADER_BUTTON_SIZE = 48;

export interface HeaderBackButtonProps {
  onPress: () => void;
  testID?: string;
}

/**
 * Fixes B2: the one back button every screen header uses — a 48×48dp
 * target (the 22dp arrow alone was missed on device) announced as "Back".
 * Built from the 48dp New Accounts Found header button.
 */
export function HeaderBackButton({ onPress, testID = 'header-back' }: HeaderBackButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back"
      testID={testID}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Icon name="arrow-left" size={22} color={colors.onSurface} />
    </Pressable>
  );
}

/** Empty 48dp slot on the other side, so a centred header title stays centred. */
export function HeaderSpacer() {
  return <View style={styles.button} />;
}

const styles = StyleSheet.create({
  button: {
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
