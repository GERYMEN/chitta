/**
 * Pure value math for the hand-rolled Slider. Kept free of React/RN so it
 * can be unit-tested directly.
 */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Snap `value` to the nearest `min + k * step`, then clamp into [min, max]. */
export function roundToStep(value: number, min: number, max: number, step: number): number {
  const safeStep = step > 0 ? step : 1;
  const steps = Math.round((value - min) / safeStep);
  const snapped = min + steps * safeStep;
  // Strip floating-point noise for fractional steps (e.g. 0.1).
  const precision = decimalPlaces(safeStep);
  return clamp(Number(snapped.toFixed(precision)), min, max);
}

/** Pixel offset along the track (0..trackWidth) → stepped, clamped value. */
export function positionToValue(
  position: number,
  trackWidth: number,
  min: number,
  max: number,
  step: number,
): number {
  if (trackWidth <= 0 || max <= min) return min;
  const fraction = clamp(position / trackWidth, 0, 1);
  return roundToStep(min + fraction * (max - min), min, max, step);
}

/** Value → fraction (0..1) of the track, clamped. */
export function valueToFraction(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/** One accessibility increment/decrement, stepped and clamped. */
export function nudge(
  value: number,
  direction: 1 | -1,
  min: number,
  max: number,
  step: number,
): number {
  return roundToStep(value + direction * step, min, max, step);
}

function decimalPlaces(n: number): number {
  const text = String(n);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}
