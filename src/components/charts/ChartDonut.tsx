import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { arcPath, DONUT_GAP_DEG, paddedArc } from './donutGeometry';

export interface ChartDonutSlice {
  key: string;
  /** Degrees, clockwise from 12 o'clock. */
  startAngle: number;
  endAngle: number;
  color: string;
}

export interface ChartDonutProps {
  slices: ReadonlyArray<ChartDonutSlice>;
  /** Outer diameter, dp. */
  size?: number;
  /** Ring thickness, dp. */
  thickness?: number;
  gapDeg?: number;
  /** Set → every slice is tappable. */
  onPressSlice?: (key: string) => void;
  /** Summary for screen readers (the ring itself is one element). */
  accessibilityLabel: string;
  /** Drawn in the hole (e.g. the total). */
  center?: React.ReactNode;
  testID?: string;
}

/**
 * R4e: a donut ring drawn with react-native-svg — one stroked arc per
 * slice with a small gap between slices; a single slice is a full circle.
 * Pure geometry lives in donutGeometry.ts; slice angles come from the
 * caller (domain/insights/pie.rules.ts).
 */
export function ChartDonut({
  slices,
  size = 176,
  thickness = 26,
  gapDeg = DONUT_GAP_DEG,
  onPressSlice,
  accessibilityLabel,
  center,
  testID,
}: ChartDonutProps) {
  const c = size / 2;
  const r = (size - thickness) / 2;
  const single = slices.length === 1;
  const gap = slices.length > 1 ? gapDeg : 0;

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <G>
          {single ? (
            <Circle
              key={slices[0].key}
              testID={`chart-donut-slice-${slices[0].key}`}
              cx={c}
              cy={c}
              r={r}
              stroke={slices[0].color}
              strokeWidth={thickness}
              fill="none"
              onPress={onPressSlice ? () => onPressSlice(slices[0].key) : undefined}
            />
          ) : (
            slices.map(slice => {
              const arc = paddedArc(slice.startAngle, slice.endAngle, gap);
              return (
                <Path
                  key={slice.key}
                  testID={`chart-donut-slice-${slice.key}`}
                  d={arcPath(c, c, r, arc.start, arc.end)}
                  stroke={slice.color}
                  strokeWidth={thickness}
                  strokeLinecap="butt"
                  fill="none"
                  onPress={onPressSlice ? () => onPressSlice(slice.key) : undefined}
                />
              );
            })
          )}
        </G>
      </Svg>
      {center ? (
        <View style={styles.center} pointerEvents="none">
          {center}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
});
