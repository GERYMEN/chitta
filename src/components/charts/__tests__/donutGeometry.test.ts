import { arcPath, paddedArc, polar } from '../donutGeometry';

describe('R4e donut geometry', () => {
  it('0° is 12 o’clock, angles go clockwise', () => {
    const top = polar(50, 50, 40, 0);
    expect(top.x).toBeCloseTo(50);
    expect(top.y).toBeCloseTo(10);
    const right = polar(50, 50, 40, 90);
    expect(right.x).toBeCloseTo(90);
    expect(right.y).toBeCloseTo(50);
  });

  it('arc path uses the large-arc flag above 180° and sweeps clockwise', () => {
    expect(arcPath(50, 50, 40, 0, 90)).toBe('M 50 10 A 40 40 0 0 1 90 50');
    expect(arcPath(50, 50, 40, 0, 270)).toMatch(/A 40 40 0 1 1 10 50$/);
  });

  it('the gap takes half off each end, never more than a quarter of the slice', () => {
    expect(paddedArc(0, 90, 2)).toEqual({ start: 1, end: 89 });
    expect(paddedArc(10, 12, 2)).toEqual({ start: 10.5, end: 11.5 });
    expect(paddedArc(0, 360, 0)).toEqual({ start: 0, end: 360 });
  });
});
