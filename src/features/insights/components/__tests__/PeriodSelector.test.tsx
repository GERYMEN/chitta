import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PeriodSelector } from '../PeriodSelector';
import { Period } from '../../../../domain/periods/period.types';

/** Chip buttons by testID — outermost composite only. */
const chipsOf = (r: ReactTestRenderer.ReactTestRenderer) => {
  const seen = new Set<string>();
  return r.root
    .findAll(
      n => typeof n.type !== 'string' && typeof n.props.testID === 'string' && n.props.testID.startsWith('period-chip-'),
    )
    .filter(n => (seen.has(n.props.testID) ? false : (seen.add(n.props.testID), true)));
};

async function render(value: Period, onChange = jest.fn()) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<PeriodSelector value={value} onChange={onChange} />);
  });
  return r;
}

describe('PeriodSelector', () => {
  it('five chips in order, each a ≥48dp button with a period label', async () => {
    const r = await render('1M');
    const chips = chipsOf(r);
    expect(chips.map(c => c.props.testID)).toEqual([
      'period-chip-1M',
      'period-chip-3M',
      'period-chip-6M',
      'period-chip-9M',
      'period-chip-1Y',
    ]);
    expect(chips.map(c => c.props.accessibilityLabel)).toEqual([
      '1M, This month',
      '3M, Last 3 months',
      '6M, Last 6 months',
      '9M, Last 9 months',
      '1Y, Last 12 months',
    ]);
    for (const chip of chips) {
      expect(chip.props.accessibilityRole).toBe('button');
      const style = StyleSheet.flatten(chip.props.style({ pressed: false }));
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
      expect(style.minWidth).toBeGreaterThanOrEqual(48);
    }
  });

  it('announces the selected chip and reports taps', async () => {
    const onChange = jest.fn();
    const r = await render('6M', onChange);
    const chips = chipsOf(r);
    expect(chips.map(c => c.props.accessibilityState.selected)).toEqual([false, false, true, false, false]);
    await ReactTestRenderer.act(async () => {
      chips[4].props.onPress();
    });
    expect(onChange).toHaveBeenCalledWith('1Y');
  });
});
