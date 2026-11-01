import { CategorySpend } from './insights.types';
import { OTHER_BREAKDOWN_KEY } from './insights.rules';

/**
 * R4e "Where it went" donut — pure slice math (no React, no SVG).
 *
 * - Only categories with spend > 0 get a slice (a category whose refunds
 *   exceed its spend in the period has nothing to draw).
 * - Largest first (ties by category id); the folded "Other" slice is last.
 * - A category under MIN_SLICE_SHARE (3%) of the positive total, or beyond
 *   the first MAX_CATEGORY_SLICES (6), is folded into "Other". When exactly
 *   one category would be folded it is shown as itself (an "Other" of one
 *   hides a name for no gain) — so at most 7 slices come back.
 * - Whole percents use the largest-remainder method: they always add up to
 *   exactly 100 when there is anything to draw.
 * - Angles are degrees, clockwise from 12 o'clock; slices tile [0, 360]
 *   exactly (the last one ends at 360). One slice = the full ring.
 */
export const MIN_SLICE_SHARE = 0.03;
export const MAX_CATEGORY_SLICES = 6;

export interface PieSlice {
  /** Category id, or OTHER_BREAKDOWN_KEY. */
  key: string;
  /** null only for "Other". */
  categoryId: string | null;
  spendMinor: number;
  count: number;
  /** How many categories the slice stands for (1, or N for "Other"). */
  categoryCount: number;
  /** spendMinor / totalMinor (0..1). */
  share: number;
  /** Whole percent; all slices add up to 100. */
  percent: number;
  startAngle: number;
  endAngle: number;
}

export interface PieModel {
  /** Sum of the positive category spends (what the ring represents). */
  totalMinor: number;
  slices: PieSlice[];
}

/** Largest-remainder rounding of non-negative values to whole percents summing to 100. */
export function roundPercents(values: ReadonlyArray<number>): number[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map(v => (Math.max(0, v) / total) * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    floors[i] += 1;
    remaining -= 1;
  }
  return floors;
}

export function buildPieModel(
  rows: ReadonlyArray<Pick<CategorySpend, 'categoryId' | 'spendMinor' | 'count'>>,
  options: { minShare?: number; maxSlices?: number } = {},
): PieModel {
  const minShare = options.minShare ?? MIN_SLICE_SHARE;
  const maxSlices = options.maxSlices ?? MAX_CATEGORY_SLICES;
  const positive = rows
    .filter(r => r.spendMinor > 0)
    .sort(
      (a, b) =>
        b.spendMinor - a.spendMinor ||
        (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0),
    );
  const totalMinor = positive.reduce((sum, r) => sum + r.spendMinor, 0);
  if (totalMinor <= 0) return { totalMinor: 0, slices: [] };

  const shown: typeof positive = [];
  const folded: typeof positive = [];
  for (const row of positive) {
    if (shown.length < maxSlices && row.spendMinor / totalMinor >= minShare) shown.push(row);
    else folded.push(row);
  }

  type Draft = Omit<PieSlice, 'percent' | 'startAngle' | 'endAngle' | 'share'>;
  const drafts: Draft[] = shown.map(r => ({
    key: r.categoryId,
    categoryId: r.categoryId,
    spendMinor: r.spendMinor,
    count: r.count,
    categoryCount: 1,
  }));
  if (folded.length === 1) {
    const r = folded[0];
    drafts.push({ key: r.categoryId, categoryId: r.categoryId, spendMinor: r.spendMinor, count: r.count, categoryCount: 1 });
  } else if (folded.length > 1) {
    drafts.push({
      key: OTHER_BREAKDOWN_KEY,
      categoryId: null,
      spendMinor: folded.reduce((sum, r) => sum + r.spendMinor, 0),
      count: folded.reduce((sum, r) => sum + r.count, 0),
      categoryCount: folded.length,
    });
  }

  const percents = roundPercents(drafts.map(d => d.spendMinor));
  let cumulative = 0;
  const slices = drafts.map((draft, i) => {
    const startAngle = (cumulative / totalMinor) * 360;
    cumulative += draft.spendMinor;
    const endAngle = i === drafts.length - 1 ? 360 : (cumulative / totalMinor) * 360;
    return {
      ...draft,
      share: draft.spendMinor / totalMinor,
      percent: percents[i],
      startAngle,
      endAngle,
    };
  });
  return { totalMinor, slices };
}
