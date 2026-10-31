import React from 'react';
import { StyleSheet, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  barFraction,
  barHeightOf,
  ChartBars,
  ChartBarsDatum,
  ChartBarsProps,
  chartMaxValue,
  VERTICAL_PLOT_HEIGHT,
} from '../ChartBars';

const DATA: ChartBarsDatum[] = [
  { key: 'cat-a', label: 'QA Category A', value: 20000, color: '#111111' },
  { key: 'cat-b', label: 'QA Category B', value: 5000, color: '#222222' },
  { key: 'cat-c', label: 'QA Category C', value: -3000, color: '#333333' },
];

async function render(props: Partial<ChartBarsProps> = {}) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <ChartBars
        data={DATA}
        orientation="horizontal"
        formatValue={value => `v${value}`}
        accessibilityLabelFor={datum => `a11y ${datum.label}`}
        {...props}
      />,
    );
  });
  return r;
}

/**
 * The bar elements (Pressable or View) by testID — outermost composite only
 * (a Pressable shows up as more than one composite node in the tree).
 */
const bars = (r: ReactTestRenderer.ReactTestRenderer) => {
  const seen = new Set<string>();
  return r.root
    .findAll(
      n => typeof n.type !== 'string' && typeof n.props.testID === 'string' && n.props.testID.startsWith('chart-bar-'),
    )
    .filter(n => (seen.has(n.props.testID) ? false : (seen.add(n.props.testID), true)));
};
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));

describe('ChartBars (R4 chart contract)', () => {
  it('renders one bar per datum, each with its a11y label', async () => {
    const r = await render();
    const found = bars(r);
    expect(found.map(b => b.props.testID)).toEqual(['chart-bar-cat-a', 'chart-bar-cat-b', 'chart-bar-cat-c']);
    expect(found.map(b => b.props.accessibilityLabel)).toEqual([
      'a11y QA Category A',
      'a11y QA Category B',
      'a11y QA Category C',
    ]);
    expect(texts(r)).toEqual(expect.arrayContaining(['QA Category A', 'v20000', 'v-3000']));
  });

  it('onPressBar makes every bar a button that hands back its datum', async () => {
    const onPressBar = jest.fn();
    const r = await render({ onPressBar });
    const pressables = bars(r);
    expect(pressables).toHaveLength(3);
    expect(pressables.every(p => p.props.accessibilityRole === 'button')).toBe(true);
    await ReactTestRenderer.act(async () => {
      pressables[1].props.onPress();
    });
    expect(onPressBar).toHaveBeenCalledWith(DATA[1]);
  });

  it('without onPressBar the bars are accessible, non-pressable Views', async () => {
    const r = await render();
    expect(bars(r).every(b => b.props.onPress === undefined && b.props.accessible === true)).toBe(true);
  });

  it('horizontal fills are relative to the largest value; ≤ 0 draws no bar', async () => {
    const r = await render();
    const widths = r.root
      .findAll(n => typeof n.type === 'string' && StyleSheet.flatten(n.props.style)?.backgroundColor?.startsWith?.('#'))
      .map(n => StyleSheet.flatten(n.props.style))
      .filter(style => style.width !== undefined)
      .map(style => [style.backgroundColor, style.width]);
    expect(widths).toEqual([
      ['#111111', '100%'],
      ['#222222', '25%'],
      ['#333333', '0%'],
    ]);
  });

  it('optional detail caption under a horizontal bar', async () => {
    const r = await render({ formatDetail: datum => (datum.key === 'cat-a' ? '3 items · 80% of spend' : null) });
    expect(texts(r)).toContain('3 items · 80% of spend');
  });

  it('vertical paired bars: one group per datum, scale label, secondary bars in secondaryColor', async () => {
    const onPressBar = jest.fn();
    const monthly: ChartBarsDatum[] = [
      { key: '2026-08', label: 'Aug', value: 1000, secondaryValue: 4000, color: '#101010' },
      { key: '2026-09', label: 'Sep', value: 2000, secondaryValue: 0, color: '#101010' },
      { key: '2026-10', label: 'Oct*', value: 3000, secondaryValue: 1000, color: '#101010' },
    ];
    const r = await render({
      data: monthly,
      orientation: 'vertical',
      secondaryColor: '#00AA00',
      onPressBar,
      accessibilityLabelFor: datum => `month ${datum.key}`,
    });
    const found = bars(r);
    expect(found).toHaveLength(3);
    expect(found.map(b => b.props.accessibilityLabel)).toEqual(['month 2026-08', 'month 2026-09', 'month 2026-10']);
    expect(texts(r)).toEqual(expect.arrayContaining(['v4000', 'Aug', 'Sep', 'Oct*']));
    const heights = r.root
      .findAll(n => typeof n.type === 'string' && StyleSheet.flatten(n.props.style)?.height !== undefined)
      .map(n => StyleSheet.flatten(n.props.style))
      .filter(style => style.backgroundColor === '#00AA00')
      .map(style => style.height);
    expect(heights).toEqual([VERTICAL_PLOT_HEIGHT, 0, VERTICAL_PLOT_HEIGHT / 4]);
    await ReactTestRenderer.act(async () => {
      found[2].props.onPress();
    });
    expect(onPressBar).toHaveBeenCalledWith(monthly[2]);
  });

  it('math helpers', () => {
    expect(chartMaxValue(DATA)).toBe(20000);
    expect(chartMaxValue([{ value: 1, secondaryValue: 9 }])).toBe(9);
    expect(chartMaxValue([])).toBe(0);
    expect(barFraction(5, 0)).toBe(0);
    expect(barFraction(-5, 10)).toBe(0);
    expect(barFraction(5, 10)).toBe(0.5);
    expect(barHeightOf(1, 1000)).toBe(2); // tiny positive values stay visible
    expect(barHeightOf(0, 1000)).toBe(0);
  });
});
