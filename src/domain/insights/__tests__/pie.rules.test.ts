import { buildPieModel, MAX_CATEGORY_SLICES, MIN_SLICE_SHARE, roundPercents } from '../pie.rules';
import { OTHER_BREAKDOWN_KEY } from '../insights.rules';

const row = (categoryId: string, spendMinor: number, count = 1) => ({ categoryId, spendMinor, count });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('R4e pie slice math', () => {
  it('constants: under 3% folds, at most 6 category slices', () => {
    expect(MIN_SLICE_SHARE).toBe(0.03);
    expect(MAX_CATEGORY_SLICES).toBe(6);
  });

  it('zero total → no slices (empty state)', () => {
    expect(buildPieModel([])).toEqual({ totalMinor: 0, slices: [] });
    expect(buildPieModel([row('cat-a', 0), row('cat-b', -500)])).toEqual({ totalMinor: 0, slices: [] });
  });

  it('a single category is the full ring at 100%', () => {
    const model = buildPieModel([row('cat-a', 12345, 3)]);
    expect(model.totalMinor).toBe(12345);
    expect(model.slices).toEqual([
      expect.objectContaining({ key: 'cat-a', percent: 100, share: 1, startAngle: 0, endAngle: 360, count: 3 }),
    ]);
  });

  it('largest first (ties by id); negative/zero categories get no slice', () => {
    const model = buildPieModel([row('cat-b', 100), row('cat-c', 300), row('cat-a', 100), row('cat-neg', -50)]);
    expect(model.slices.map(s => s.key)).toEqual(['cat-c', 'cat-a', 'cat-b']);
    expect(model.totalMinor).toBe(500);
  });

  it('percents always add up to exactly 100 (largest remainder)', () => {
    const thirds = buildPieModel([row('cat-a', 1), row('cat-b', 1), row('cat-c', 1)]);
    expect(thirds.slices.map(s => s.percent)).toEqual([34, 33, 33]);
    const odd = buildPieModel([row('a', 3333), row('b', 3333), row('c', 1667), row('d', 1667)]);
    expect(sum(odd.slices.map(s => s.percent))).toBe(100);
    for (let seed = 1; seed < 40; seed++) {
      const rows = Array.from({ length: 1 + (seed % 9) }, (_, i) => row(`c${i}`, ((seed * 7919 + i * 104729) % 9973) + 1));
      expect(sum(buildPieModel(rows).slices.map(s => s.percent))).toBe(100);
    }
  });

  it('categories under 3% fold into "Other" (last), with summed spend/count', () => {
    const model = buildPieModel([
      row('cat-big', 9000, 5),
      row('cat-mid', 900, 2),
      row('cat-tiny1', 50, 1),
      row('cat-tiny2', 50, 4),
    ]);
    expect(model.slices.map(s => s.key)).toEqual(['cat-big', 'cat-mid', OTHER_BREAKDOWN_KEY]);
    const other = model.slices[2];
    expect(other).toMatchObject({ categoryId: null, spendMinor: 100, count: 5, categoryCount: 2 });
    expect(sum(model.slices.map(s => s.spendMinor))).toBe(model.totalMinor);
  });

  it('at most 6 category slices + Other', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`cat-${i}`, 1000 - i));
    const model = buildPieModel(rows);
    expect(model.slices).toHaveLength(7);
    expect(model.slices.slice(0, 6).map(s => s.key)).toEqual(['cat-0', 'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5']);
    expect(model.slices[6]).toMatchObject({ key: OTHER_BREAKDOWN_KEY, categoryCount: 4 });
  });

  it('exactly one category to fold is shown as itself (no "Other" of one)', () => {
    const model = buildPieModel([row('cat-big', 9900), row('cat-tiny', 100)]);
    expect(model.slices.map(s => s.key)).toEqual(['cat-big', 'cat-tiny']);
    expect(model.slices[1].percent).toBe(1);
  });

  it('angles tile the ring: 0 → 360, each slice starts where the last ended, sweep ∝ spend', () => {
    const model = buildPieModel([row('a', 500), row('b', 300), row('c', 200)]);
    expect(model.slices[0].startAngle).toBe(0);
    expect(model.slices.at(-1)!.endAngle).toBe(360);
    for (let i = 1; i < model.slices.length; i++) {
      expect(model.slices[i].startAngle).toBeCloseTo(model.slices[i - 1].endAngle, 9);
    }
    expect(model.slices[0].endAngle).toBeCloseTo(180, 9);
    expect(model.slices[1].endAngle - model.slices[1].startAngle).toBeCloseTo(108, 9);
  });

  it('roundPercents: all-zero stays zero', () => {
    expect(roundPercents([0, 0])).toEqual([0, 0]);
    expect(roundPercents([1, 1, 1, 1, 1, 1, 1])).toEqual([15, 15, 14, 14, 14, 14, 14]);
  });
});
