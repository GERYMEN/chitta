import React from 'react';
import { DimensionValue, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../../theme';

/**
 * R4 chart contract (user decision 2026-10-28: plain RN Views now, maybe a
 * chart library later). Screens import ONLY `ChartBars` — never hand-built
 * bar Views — so this renderer can be swapped without touching a screen.
 * No dependency: plain Views + theme tokens.
 */
export type ChartBarsOrientation = 'horizontal' | 'vertical';

export interface ChartBarsDatum {
  /** Stable id (React key, testID suffix, what onPressBar hands back). */
  key: string;
  label: string;
  value: number;
  /** Optional paired value (e.g. income next to spend), in `secondaryColor`. */
  secondaryValue?: number;
  color: string;
}

export interface ChartBarsProps {
  data: ReadonlyArray<ChartBarsDatum>;
  orientation: ChartBarsOrientation;
  /** Value text: next to each horizontal bar; the scale label of a vertical chart. */
  formatValue: (value: number) => string;
  /** When set, every bar is a button. */
  onPressBar?: (datum: ChartBarsDatum) => void;
  accessibilityLabelFor: (datum: ChartBarsDatum) => string;
  /** Optional caption under a horizontal bar (e.g. "3 items · 40% of spend"). */
  formatDetail?: (datum: ChartBarsDatum) => string | null;
  /** Colour of the paired bars. Default: theme primary. */
  secondaryColor?: string;
  testID?: string;
}

/** Height of the vertical plot area, dp. */
export const VERTICAL_PLOT_HEIGHT = 120;

/** Largest value (primary or secondary) in the data; bars are relative to it. */
export function chartMaxValue(data: ReadonlyArray<Pick<ChartBarsDatum, 'value' | 'secondaryValue'>>): number {
  let max = 0;
  for (const datum of data) {
    if (datum.value > max) max = datum.value;
    if (datum.secondaryValue !== undefined && datum.secondaryValue > max) max = datum.secondaryValue;
  }
  return max;
}

/** 0..1 share of the largest value. Values ≤ 0 (e.g. refunds > spend) draw no bar. */
export function barFraction(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(1, value / max);
}

/** Bar length as a % of the track; a positive value stays visible (≥ 2%). */
function widthOf(value: number, max: number): DimensionValue {
  const fraction = barFraction(value, max);
  const percent = fraction === 0 ? 0 : Math.max(2, Math.round(fraction * 1000) / 10);
  return `${percent}%`;
}

/** Bar height in dp; a positive value stays visible (≥ 2dp). */
export function barHeightOf(value: number, max: number): number {
  const fraction = barFraction(value, max);
  return fraction === 0 ? 0 : Math.max(2, Math.round(fraction * VERTICAL_PLOT_HEIGHT));
}

export function ChartBars(props: ChartBarsProps) {
  const max = chartMaxValue(props.data);
  return props.orientation === 'horizontal' ? (
    <View style={styles.horizontal} testID={props.testID}>
      {props.data.map(datum => (
        <HorizontalBar key={datum.key} datum={datum} max={max} {...props} />
      ))}
    </View>
  ) : (
    <VerticalBars {...props} max={max} />
  );
}

type BarProps = ChartBarsProps & { datum: ChartBarsDatum; max: number };

/** Pressable when `onPressBar` is set, else one accessible View — same testID either way. */
function BarShell({
  datum,
  onPressBar,
  accessibilityLabelFor,
  style,
  children,
}: Pick<BarProps, 'datum' | 'onPressBar' | 'accessibilityLabelFor'> & {
  style: ViewStyle;
  children: React.ReactNode;
}) {
  const label = accessibilityLabelFor(datum);
  const testID = `chart-bar-${datum.key}`;
  if (onPressBar) {
    return (
      <Pressable
        onPress={() => onPressBar(datum)}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        style={({ pressed }) => [style, pressed && styles.pressed]}>
        {children}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={label} testID={testID} style={style}>
      {children}
    </View>
  );
}

function HorizontalBar(props: BarProps) {
  const { datum, max, formatValue, formatDetail, secondaryColor = colors.primary } = props;
  const detail = formatDetail ? formatDetail(datum) : null;
  const fillStyle = { width: widthOf(datum.value, max), backgroundColor: datum.color };
  const secondaryFillStyle =
    datum.secondaryValue !== undefined
      ? { width: widthOf(datum.secondaryValue, max), backgroundColor: secondaryColor }
      : null;
  return (
    <BarShell {...props} style={styles.hRow}>
      <View style={styles.hHeader}>
        <Text style={styles.hLabel} numberOfLines={1}>
          {datum.label}
        </Text>
        <Text style={styles.hValue}>{formatValue(datum.value)}</Text>
      </View>
      <View style={styles.hTrack}>
        <View style={[styles.hFill, fillStyle]} />
      </View>
      {secondaryFillStyle ? (
        <View style={[styles.hTrack, styles.hTrackSecondary]}>
          <View style={[styles.hFill, secondaryFillStyle]} />
        </View>
      ) : null}
      {detail ? <Text style={styles.hDetail}>{detail}</Text> : null}
    </BarShell>
  );
}

function VerticalBars(props: ChartBarsProps & { max: number }) {
  const { data, max, formatValue, testID } = props;
  const paired = data.some(datum => datum.secondaryValue !== undefined);
  const crowded = data.length > 6;
  const barWidth = paired ? (crowded ? 7 : 12) : crowded ? 12 : 20;
  return (
    <View testID={testID}>
      <Text style={styles.vScale}>{formatValue(max)}</Text>
      <View style={styles.vPlot}>
        {data.map(datum => (
          <VerticalGroup key={datum.key} {...props} datum={datum} max={max} barWidth={barWidth} />
        ))}
      </View>
    </View>
  );
}

function VerticalGroup(props: BarProps & { barWidth: number }) {
  const { datum, max, barWidth, secondaryColor = colors.primary } = props;
  const primaryStyle = {
    height: barHeightOf(datum.value, max),
    width: barWidth,
    backgroundColor: datum.color,
  };
  const secondaryStyle =
    datum.secondaryValue !== undefined
      ? {
          height: barHeightOf(datum.secondaryValue, max),
          width: barWidth,
          backgroundColor: secondaryColor,
        }
      : null;
  return (
    <BarShell {...props} style={styles.vGroup}>
      <View style={styles.vBars}>
        <View style={[styles.vBar, primaryStyle]} />
        {secondaryStyle ? <View style={[styles.vBar, secondaryStyle]} /> : null}
      </View>
      <View style={styles.vLabelWrap}>
        <Text style={styles.vLabel} numberOfLines={1}>
          {datum.label}
        </Text>
      </View>
    </BarShell>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  horizontal: {
    gap: spacing.xs,
  },
  hRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  hHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hLabel: {
    ...typography.labelLg,
    color: colors.onSurface,
    flex: 1,
  },
  hValue: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  hTrack: {
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  hTrackSecondary: {
    height: 6,
  },
  hFill: {
    height: '100%',
    borderRadius: radii.full,
  },
  hDetail: {
    ...typography.labelMd,
    color: colors.outline,
  },
  vScale: {
    ...typography.labelSm,
    color: colors.outline,
    marginBottom: spacing.xs,
  },
  vPlot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  vGroup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: VERTICAL_PLOT_HEIGHT + 24,
  },
  vBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: VERTICAL_PLOT_HEIGHT,
  },
  vBar: {
    borderTopLeftRadius: radii.sm / 2,
    borderTopRightRadius: radii.sm / 2,
  },
  vLabelWrap: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
    paddingTop: spacing.xs,
  },
  vLabel: {
    ...typography.labelSm,
    color: colors.outline,
  },
});
