import { clamp, nudge, positionToValue, roundToStep, valueToFraction } from '../sliderMath';

describe('sliderMath', () => {
  describe('clamp', () => {
    it('keeps values inside the range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-1, 0, 10)).toBe(0);
      expect(clamp(11, 0, 10)).toBe(10);
    });

    it('maps NaN to min', () => {
      expect(clamp(Number.NaN, 70, 100)).toBe(70);
    });
  });

  describe('roundToStep', () => {
    it('rounds to the nearest step from min', () => {
      expect(roundToStep(92.4, 70, 100, 1)).toBe(92);
      expect(roundToStep(92.5, 70, 100, 1)).toBe(93);
      expect(roundToStep(77, 70, 100, 5)).toBe(75);
      expect(roundToStep(78, 70, 100, 5)).toBe(80);
    });

    it('clamps after rounding', () => {
      expect(roundToStep(120, 70, 100, 1)).toBe(100);
      expect(roundToStep(10, 70, 100, 1)).toBe(70);
    });

    it('handles fractional steps without float noise', () => {
      expect(roundToStep(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
    });

    it('treats a non-positive step as 1', () => {
      expect(roundToStep(3.6, 0, 10, 0)).toBe(4);
    });
  });

  describe('positionToValue', () => {
    it('maps track ends to min and max', () => {
      expect(positionToValue(0, 300, 70, 100, 1)).toBe(70);
      expect(positionToValue(300, 300, 70, 100, 1)).toBe(100);
    });

    it('maps the middle with step rounding', () => {
      expect(positionToValue(150, 300, 70, 100, 1)).toBe(85);
      expect(positionToValue(250, 300, 70, 100, 1)).toBe(95);
    });

    it('clamps positions beyond the track', () => {
      expect(positionToValue(-50, 300, 70, 100, 1)).toBe(70);
      expect(positionToValue(900, 300, 70, 100, 1)).toBe(100);
    });

    it('returns min for a zero-width track or empty range', () => {
      expect(positionToValue(100, 0, 70, 100, 1)).toBe(70);
      expect(positionToValue(100, 300, 5, 5, 1)).toBe(5);
    });

    it('acts as a two-position switch on 0..1 step 1', () => {
      expect(positionToValue(140, 300, 0, 1, 1)).toBe(0);
      expect(positionToValue(160, 300, 0, 1, 1)).toBe(1);
    });
  });

  describe('valueToFraction', () => {
    it('maps values to 0..1 and clamps', () => {
      expect(valueToFraction(85, 70, 100)).toBe(0.5);
      expect(valueToFraction(50, 70, 100)).toBe(0);
      expect(valueToFraction(150, 70, 100)).toBe(1);
      expect(valueToFraction(1, 1, 1)).toBe(0);
    });
  });

  describe('nudge', () => {
    it('steps up/down and stops at the bounds', () => {
      expect(nudge(90, 1, 70, 100, 1)).toBe(91);
      expect(nudge(90, -1, 70, 100, 1)).toBe(89);
      expect(nudge(100, 1, 70, 100, 1)).toBe(100);
      expect(nudge(70, -1, 70, 100, 1)).toBe(70);
    });
  });
});
