/**
 * R4e: pure SVG geometry for ChartDonut. Angles are degrees, clockwise from
 * 12 o'clock (the pie.rules convention).
 */

/** Default gap between slices, degrees (only when there are 2+ slices). */
export const DONUT_GAP_DEG = 2;

export interface Point {
  x: number;
  y: number;
}

export function polar(cx: number, cy: number, r: number, angleDeg: number): Point {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * The visible arc of a slice after the gap: half the gap is taken off each
 * end, but never more than a quarter of the slice, so even a sliver keeps
 * at least half its sweep.
 */
export function paddedArc(
  startAngle: number,
  endAngle: number,
  gapDeg: number,
): { start: number; end: number } {
  const sweep = Math.max(0, endAngle - startAngle);
  const half = Math.min(gapDeg / 2, sweep / 4);
  return { start: startAngle + half, end: endAngle - half };
}

/**
 * A stroked arc path (centre line of the ring) from start to end, clockwise.
 * Sweeps of 360 or more cannot be one SVG arc — callers draw a Circle.
 */
export function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  const from = polar(cx, cy, r, startAngle);
  const to = polar(cx, cy, r, endAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${fmt(from.x)} ${fmt(from.y)} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} 1 ${fmt(to.x)} ${fmt(to.y)}`;
}
