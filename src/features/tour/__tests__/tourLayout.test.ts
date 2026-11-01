import { holeFrame, placeTooltip, scrollDeltaToReveal, spotlightRect, toLocal } from '../tourLayout';

const SCREEN = { width: 400, height: 800 };
const INSETS = { top: 24, bottom: 16 };

describe('tour overlay layout (R4c)', () => {
  it('spotlight = target + padding, clipped to the screen', () => {
    expect(spotlightRect({ x: 100, y: 200, width: 50, height: 40 }, SCREEN, 8)).toEqual({
      x: 92,
      y: 192,
      width: 66,
      height: 56,
    });
    expect(spotlightRect({ x: -20, y: 790, width: 60, height: 40 }, SCREEN, 8)).toEqual({
      x: 0,
      y: 782,
      width: 48,
      height: 18,
    });
  });

  it('window → overlay coordinates', () => {
    expect(toLocal({ x: 10, y: 50, width: 5, height: 6 }, { x: 0, y: 24 })).toEqual({
      x: 10,
      y: 26,
      width: 5,
      height: 6,
    });
  });

  it('hole frame: border covers the whole screen, inner radius kept', () => {
    const spot = { x: 100, y: 300, width: 120, height: 48 };
    const frame = holeFrame(spot, SCREEN, 16);
    expect(frame.left + frame.borderWidth).toBe(spot.x);
    expect(frame.top + frame.borderWidth).toBe(spot.y);
    expect(frame.width - 2 * frame.borderWidth).toBe(spot.width);
    expect(frame.height - 2 * frame.borderWidth).toBe(spot.height);
    expect(frame.borderRadius - frame.borderWidth).toBe(16);
    // Every screen corner is inside the frame's OUTER rounded rectangle, so
    // the dim border covers the whole screen.
    const inside = (px: number, py: number) => {
      const r = frame.borderRadius;
      const right = frame.left + frame.width;
      const bottom = frame.top + frame.height;
      if (px < frame.left || px > right || py < frame.top || py > bottom) return false;
      const cx = Math.min(Math.max(px, frame.left + r), right - r);
      const cy = Math.min(Math.max(py, frame.top + r), bottom - r);
      return Math.hypot(px - cx, py - cy) <= r;
    };
    for (const [px, py] of [[0, 0], [SCREEN.width, 0], [0, SCREEN.height], [SCREEN.width, SCREEN.height]]) {
      expect(inside(px, py)).toBe(true);
    }
    // A small target never gets a radius larger than half its side.
    expect(holeFrame({ x: 0, y: 0, width: 20, height: 10 }, SCREEN, 16).borderRadius - frame.borderWidth).toBe(5);
  });

  it('tooltip goes below when it fits', () => {
    const placed = placeTooltip({ spot: { x: 16, y: 100, width: 200, height: 48 }, tooltipHeight: 180, screen: SCREEN, insets: INSETS });
    expect(placed.placement).toBe('below');
    expect(placed.top).toBe(100 + 48 + 12);
    expect(placed.left).toBe(16);
    expect(placed.width).toBe(368);
  });

  it('above when there is no room below (e.g. the tab bar)', () => {
    const placed = placeTooltip({ spot: { x: 150, y: 730, width: 60, height: 50 }, tooltipHeight: 180, screen: SCREEN, insets: INSETS });
    expect(placed.placement).toBe('above');
    expect(placed.top).toBe(730 - 12 - 180);
  });

  it('always inside the safe screen area, even when neither side fits', () => {
    const tall = placeTooltip({ spot: { x: 0, y: 300, width: 400, height: 200 }, tooltipHeight: 400, screen: SCREEN, insets: INSETS });
    expect(tall.top).toBeGreaterThanOrEqual(INSETS.top);
    expect(tall.top + 400).toBeLessThanOrEqual(SCREEN.height - INSETS.bottom);
    const nearTop = placeTooltip({ spot: { x: 0, y: 0, width: 50, height: 10 }, tooltipHeight: 900, screen: SCREEN, insets: INSETS });
    expect(nearTop.top).toBeGreaterThanOrEqual(INSETS.top);
  });

  it('scroll delta to reveal a target', () => {
    const band = { top: 32, bottom: 700 };
    expect(scrollDeltaToReveal({ x: 0, y: 100, width: 10, height: 50 }, band)).toBe(0);
    expect(scrollDeltaToReveal({ x: 0, y: 900, width: 10, height: 50 }, band)).toBe(868);
    expect(scrollDeltaToReveal({ x: 0, y: -100, width: 10, height: 50 }, band)).toBe(-132);
  });
});
