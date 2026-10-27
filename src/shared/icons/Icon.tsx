import React from 'react';
import { GestureResponderEvent, StyleProp, TextStyle } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

export interface IconProps {
  name: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  onPress?: (event: GestureResponderEvent) => void;
}

/**
 * Single icon entry point — feature code imports this, never the vector-icon
 * package directly, so the underlying icon set can change in one place.
 */
export function Icon({ name, size = 24, color, style, onPress }: IconProps) {
  return (
    <MaterialCommunityIcons name={name} size={size} color={color} style={style} onPress={onPress} />
  );
}
