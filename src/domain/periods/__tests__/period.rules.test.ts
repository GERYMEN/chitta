import { periodRange } from '../period.rules';
import { Period } from '../period.types';

function localDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, second, ms);
}

function expectLocal(from: Date, year: number, month: number, day: number): void {
  expect(from.getFullYear()).toBe(year);
  expect(from.getMonth()).toBe(month - 1);
  expect(from.getDate()).toBe(day);
  expect(from.getHours()).toBe(0);
  expect(from.getMinutes()).toBe(0);
  expect(from.getSeconds()).toBe(0);
  expect(from.getMilliseconds()).toBe(0);
}

describe('periodRange', () => {
  describe('1M', () => {
    it('starts at the 1st of the current month, local midnight, through now', () => {
      const now = localDate(2026, 3, 15, 14, 30, 0);
      const range = periodRange('1M', now);
      expectLocal(range.from, 2026, 3, 1);
      expect(range.to).toBe(now);
    });

    it('on the first day of a month uses that same day (not the previous month)', () => {
      const now = localDate(2026, 3, 1, 9, 0, 0);
      const range = periodRange('1M', now);
      expectLocal(range.from, 2026, 3, 1);
    });

    it('on the last day of a month still starts at the 1st of that month', () => {
      const now = localDate(2026, 3, 31, 23, 59, 59);
      const range = periodRange('1M', now);
      expectLocal(range.from, 2026, 3, 1);
    });

    it('on January 1 does not roll back into December', () => {
      const now = localDate(2026, 1, 1, 12, 0, 0);
      const range = periodRange('1M', now);
      expectLocal(range.from, 2026, 1, 1);
    });
  });

  describe('3M/6M/9M', () => {
    it('3M from mid-month starts on the 1st two months back', () => {
      const now = localDate(2026, 3, 15, 10, 0, 0);
      expectLocal(periodRange('3M', now).from, 2026, 1, 1);
    });

    it('6M starts on the 1st five months back', () => {
      const now = localDate(2026, 3, 15, 10, 0, 0);
      expectLocal(periodRange('6M', now).from, 2025, 10, 1);
    });

    it('9M starts on the 1st eight months back', () => {
      const now = localDate(2026, 3, 15, 10, 0, 0);
      expectLocal(periodRange('9M', now).from, 2025, 7, 1);
    });

    it('3M/6M/9M cross a year boundary without a month-wrap bug', () => {
      const now = localDate(2026, 2, 10, 8, 0, 0);
      expectLocal(periodRange('3M', now).from, 2025, 12, 1);
      expectLocal(periodRange('6M', now).from, 2025, 9, 1);
      expectLocal(periodRange('9M', now).from, 2025, 6, 1);
    });

    it('are pure year/month arithmetic — a leap-February window needs no day-counting', () => {
      // 2028 is a leap year; a 3M window from Feb includes Feb 2028 and the
      // 1st-of-month boundary is unaffected by Feb having 29 days.
      const now = localDate(2028, 2, 29, 12, 0, 0);
      expectLocal(periodRange('1M', now).from, 2028, 2, 1);
      expectLocal(periodRange('3M', now).from, 2027, 12, 1);
      expectLocal(periodRange('6M', now).from, 2027, 9, 1);
      expectLocal(periodRange('9M', now).from, 2027, 6, 1);
    });
  });

  describe('1Y (trailing 12 months)', () => {
    it('is exactly 12 calendar months back, same day-of-month, local midnight', () => {
      const now = localDate(2026, 3, 15, 16, 0, 0);
      const range = periodRange('1Y', now);
      expectLocal(range.from, 2025, 3, 15);
      expect(range.to).toBe(now);
    });

    it('is NOT calendar-year semantics (would start Jan 1 of the current year)', () => {
      const now = localDate(2026, 3, 15, 16, 0, 0);
      const range = periodRange('1Y', now);
      expect(range.from.getFullYear()).toBe(2025);
      expect(range.from.getMonth()).toBe(2); // March
      expect(range.from.getDate()).toBe(15);
      expect(range.from.getTime()).not.toBe(localDate(2026, 1, 1).getTime());
    });

    it('keeps a day-of-month that exists 12 months back', () => {
      const now = localDate(2026, 8, 31, 10, 0, 0);
      expectLocal(periodRange('1Y', now).from, 2025, 8, 31);
    });

    it('clamps Feb 29 (leap year) down to Feb 28 of the non-leap target year', () => {
      const now = localDate(2028, 2, 29, 10, 0, 0);
      expectLocal(periodRange('1Y', now).from, 2027, 2, 28);
    });

    it('crosses a year boundary for a January date', () => {
      const now = localDate(2026, 1, 20, 9, 0, 0);
      expectLocal(periodRange('1Y', now).from, 2025, 1, 20);
    });
  });

  describe('purity', () => {
    it('changing the requested period never mutates another call', () => {
      const now = localDate(2026, 3, 15, 10, 0, 0);
      const oneMonth = periodRange('1M', now);
      const threeMonth = periodRange('3M', now);
      const oneMonthAgain = periodRange('1M', now);

      expect(oneMonthAgain.from.getTime()).toBe(oneMonth.from.getTime());
      expect(oneMonth.from.getTime()).not.toBe(threeMonth.from.getTime());

      oneMonth.from.setFullYear(1999);
      expect(threeMonth.from.getFullYear()).toBe(2026);
      expect(oneMonthAgain.from.getFullYear()).toBe(2026);
    });

    it('returns a fresh Date for `from` on every call', () => {
      const now = localDate(2026, 3, 15, 10, 0, 0);
      const a = periodRange('1M', now).from;
      const b = periodRange('1M', now).from;
      expect(a).not.toBe(b);
      expect(a.getTime()).toBe(b.getTime());
    });
  });

  describe('timeZone parameter', () => {
    it('is accepted and ignored (forward-compat no-op)', () => {
      const now = localDate(2026, 3, 15, 10, 0, 0);
      const range = periodRange('1M', now, 'America/New_York');
      expectLocal(range.from, 2026, 3, 1);
      expect(range.to).toBe(now);
    });
  });

  describe('exhaustiveness', () => {
    it('covers every period value without throwing', () => {
      const now = localDate(2026, 3, 15, 10, 0, 0);
      const periods: Period[] = ['1M', '3M', '6M', '9M', '1Y'];
      for (const period of periods) {
        const range = periodRange(period, now);
        expect(range.to).toBe(now);
        expect(range.from.getTime()).toBeLessThanOrEqual(now.getTime());
      }
    });
  });
});
