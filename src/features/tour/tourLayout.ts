/**
 * R4c pure overlay geometry: spotlight rect, the rounded "hole" frame and the
 * tooltip placement (above / below, kept inside the safe screen area).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  bottom: number;
}

export const SPOTLIGHT_PAD = 8;
export const SPOTLIGHT_RADIUS = 16;
export const TOOLTIP_GAP = 12;
export const TOOLTIP_MARGIN = 16;

/** Window rect → overlay-local rect (the overlay may not start at window 0,0). */
export function toLocal(rect: Rect, origin: { x: number; y: number }): Rect {
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
}

/** The target grown by `pad` on every side, clipped to the screen. */
export function spotlightRect(target: Rect, screen: Size, pad: number = SPOTLIGHT_PAD): Rect {
  const left = Math.max(0, target.x - pad);
  const top = Math.max(0, target.y - pad);
  const right = Math.min(screen.width, target.x + target.width + pad);
  const bottom = Math.min(screen.height, target.y + target.height + pad);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * One View whose huge border is the dim layer and whose inside is the
 * rounded hole: the border is thick enough to cover the whole screen from
 * any hole position, and the outer radius keeps the inner radius = `radius`.
 */
export function holeFrame(
  spot: Rect,
  screen: Size,
  radius: number = SPOTLIGHT_RADIUS,
): { left: number; top: number; width: number; height: number; borderWidth: number; borderRadius: number } {
  const border = Math.ceil(Math.hypot(screen.width, screen.height)) + radius;
  const innerRadius = Math.min(radius, spot.width / 2, spot.height / 2);
  return {
    left: spot.x - border,
    top: spot.y - border,
    width: spot.width + border * 2,
    height: spot.height + border * 2,
    borderWidth: border,
    borderRadius: innerRadius + border,
  };
}

export interface TooltipPlacement {
  placement: 'above' | 'below';
  top: number;
  left: number;
  width: number;
}

/**
 * Below the spotlight when it fits, else above, else the side with more room;
 * always clamped inside [top inset + margin/2, screen − bottom inset − height − margin/2].
 */
export function placeTooltip(input: {
  spot: Rect;
  tooltipHeight: number;
  screen: Size;
  insets: Insets;
  gap?: number;
  margin?: number;
}): TooltipPlacement {
  const gap = input.gap ?? TOOLTIP_GAP;
  const margin = input.margin ?? TOOLTIP_MARGIN;
  const { spot, tooltipHeight, screen, insets } = input;
  const minTop = insets.top + margin / 2;
  const maxTop = Math.max(minTop, screen.height - insets.bottom - tooltipHeight - margin / 2);
  const spaceBelow = screen.height - insets.bottom - (spot.y + spot.height) - gap;
  const spaceAbove = spot.y - insets.top - gap;

  let placement: 'above' | 'below';
  if (spaceBelow >= tooltipHeight) placement = 'below';
  else if (spaceAbove >= tooltipHeight) placement = 'above';
  else placement = spaceBelow >= spaceAbove ? 'below' : 'above';

  const rawTop =
    placement === 'below' ? spot.y + spot.height + gap : spot.y - gap - tooltipHeight;
  const top = Math.min(maxTop, Math.max(minTop, rawTop));
  const width = Math.max(0, screen.width - margin * 2);
  return { placement, top, left: margin, width };
}

/**
 * How far to scroll (positive = content moves up) so `target` sits inside
 * the visible band; 0 when it already does. Otherwise the target's top is
 * aligned with the band's top, leaving room below it for the tooltip.
 */
export function scrollDeltaToReveal(target: Rect, band: { top: number; bottom: number }): number {
  const targetBottom = target.y + target.height;
  if (target.y >= band.top && targetBottom <= band.bottom) return 0;
  return target.y - band.top;
}
