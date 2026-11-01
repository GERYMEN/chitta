import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { Circle, Path } from 'react-native-svg';
import { CategoryDonut, donutItems } from '../CategoryDonut';
import { WhereItWentCard } from '../WhereItWentCard';
import { REDACTED_AMOUNT, setRedacted } from '../../../../shared/privacy/redaction';
import { chartOtherColor, chartSeriesColors } from '../../../../theme';
import { Category } from '../../../../domain/categories/category.types';
import { OTHER_BREAKDOWN_KEY } from '../../../../domain/insights/insights.rules';

const category = (id: string, name: string): Category => ({
  id,
  name,
  parentId: null,
  type: 'expense',
  icon: 'shape-outline',
  isSystem: false,
  archivedAt: null,
  color: null,
});
const CATEGORIES = [category('cat-a', 'QA Food'), category('cat-b', 'QA Shopping')];
const spend = (categoryId: string, spendMinor: number, count = 1) => ({ categoryId, spendMinor, count, share: 0 });

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render(el: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(el);
  });
  mounted.push(r);
  return r;
}
afterEach(async () => {
  setRedacted(false);
  await ReactTestRenderer.act(async () => mounted.splice(0).forEach(r => r.unmount()));
});

const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
const legendRows = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(
    n =>
      typeof n.type !== 'string' &&
      n.props.accessibilityRole === 'button' &&
      String(n.props.testID ?? '').startsWith('where-it-went-legend-'),
  ).filter((n, i, all) => all.findIndex(m => m.props.testID === n.props.testID) === i);

describe('R4e CategoryDonut', () => {
  const ROWS = [spend('cat-a', 30000, 2), spend('cat-b', 20000, 1)];

  it('legend: dot + name + % + amount; a11y "<category>, <percent>, <amount>"; centre total', async () => {
    const r = await render(<CategoryDonut rows={ROWS} categories={CATEGORIES} onPressSlice={jest.fn()} />);
    expect(legendRows(r).map(n => n.props.accessibilityLabel)).toEqual([
      'QA Food, 60%, ₹300',
      'QA Shopping, 40%, ₹200',
    ]);
    expect(texts(r)).toEqual(expect.arrayContaining(['₹500', 'spent', 'QA Food', '60%', '₹300']));
    expect(r.root.findAllByType(Path)).toHaveLength(2);
  });

  it('colours by rank from the palette; "Other" uses the muted token', () => {
    const rows = [spend('cat-a', 9000), spend('cat-b', 900), spend('cat-x', 50), spend('cat-y', 50)];
    const { items } = donutItems(rows, CATEGORIES);
    expect(items.map(i => i.color)).toEqual([chartSeriesColors[0], chartSeriesColors[1], chartOtherColor]);
    expect(new Set(chartSeriesColors).size).toBe(chartSeriesColors.length);
    expect(items[2]).toMatchObject({ name: 'Other', a11yName: 'Other, 2 categories' });
  });

  it('a single category is one full circle', async () => {
    const r = await render(<CategoryDonut rows={[spend('cat-a', 100)]} categories={CATEGORIES} onPressSlice={jest.fn()} />);
    expect(r.root.findAllByType(Circle)).toHaveLength(1);
    expect(r.root.findAllByType(Path)).toHaveLength(0);
    expect(legendRows(r)[0].props.accessibilityLabel).toBe('QA Food, 100%, ₹1');
  });

  it('tapping a legend row or a slice reports the category; "Other" reports null', async () => {
    const onPress = jest.fn();
    const rows = [spend('cat-a', 9000), spend('cat-b', 900), spend('cat-x', 50), spend('cat-y', 50)];
    const r = await render(<CategoryDonut rows={rows} categories={CATEGORIES} onPressSlice={onPress} />);
    await ReactTestRenderer.act(async () => {
      legendRows(r)[1].props.onPress();
      r.root.findAll(n => n.props.testID === 'chart-donut-slice-cat-a' && n.type === Path)[0].props.onPress();
      r.root.findAll(n => n.props.testID === `where-it-went-legend-${OTHER_BREAKDOWN_KEY}` && typeof n.type !== 'string')[0].props.onPress();
    });
    expect(onPress.mock.calls).toEqual([['cat-b'], ['cat-a'], [null]]);
  });

  it('REDACTED masks the centre total and every legend amount, then restores them', async () => {
    const r = await render(<CategoryDonut rows={ROWS} categories={CATEGORIES} onPressSlice={jest.fn()} />);
    await ReactTestRenderer.act(async () => setRedacted(true));
    const masked = texts(r);
    expect(masked.filter(t => t === REDACTED_AMOUNT)).toHaveLength(3);
    expect(masked.some(t => /₹\d/.test(t))).toBe(false);
    expect(legendRows(r)[0].props.accessibilityLabel).toBe(`QA Food, 60%, ${REDACTED_AMOUNT}`);
    await ReactTestRenderer.act(async () => setRedacted(false));
    expect(texts(r)).toContain('₹500');
  });

  it('card: empty state when nothing positive was spent; Other opens See all', async () => {
    const onSeeAll = jest.fn();
    const onPressCategory = jest.fn();
    const empty = await render(
      <WhereItWentCard rows={[spend('cat-a', -100)]} categories={CATEGORIES} period="1M" onPressCategory={onPressCategory} onSeeAll={onSeeAll} />,
    );
    expect(texts(empty)).toContain('No spending this month.');
    const rows = [spend('cat-a', 9000), spend('cat-b', 900), spend('cat-x', 50), spend('cat-y', 50)];
    const r = await render(
      <WhereItWentCard rows={rows} categories={CATEGORIES} period="1M" onPressCategory={onPressCategory} onSeeAll={onSeeAll} />,
    );
    await ReactTestRenderer.act(async () => {
      r.root.findAll(n => n.props.testID === `where-it-went-legend-${OTHER_BREAKDOWN_KEY}` && typeof n.type !== 'string')[0].props.onPress();
      r.root.findAll(n => n.props.testID === 'where-it-went-legend-cat-a' && typeof n.type !== 'string')[0].props.onPress();
    });
    expect(onSeeAll).toHaveBeenCalledTimes(1);
    expect(onPressCategory).toHaveBeenCalledWith('cat-a');
  });
});
