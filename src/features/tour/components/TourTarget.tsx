import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useTourTarget } from '../tourTargets';
import type { TourTargetKey } from '../tourModel';

/** Wrap a control so the first-run tour can spotlight it. Layout-neutral. */
export function TourTarget({
  targetKey,
  style,
  children,
}: {
  targetKey: TourTargetKey;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const ref = useTourTarget(targetKey);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}
