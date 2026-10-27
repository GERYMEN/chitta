import { Period, PeriodRange } from './period.types';

/**
 * Calendar semantics (skill D9):
 * - 1M = 1st of the current calendar month (local midnight) → now.
 * - 3M/6M/9M = 1st of the month 2/5/8 months back (i.e. current month plus
 *   the previous 2/5/8 full months), local midnight → now.
 * - 1Y = trailing 12 months, NOT calendar year: `now` minus exactly 12
 *   calendar months, same day-of-month, local midnight. When `now`'s
 *   day-of-month does not exist 12 months back (only possible when `now` is
 *   a leap-year Feb 29, since month length is otherwise stable year to
 *   year), the day clamps down to the last valid day of the target month.
 *
 * All boundaries are computed with pure year/month/day arithmetic on the
 * local-time fields of `now` (`getFullYear`/`getMonth`/`getDate`) — no
 * day-counting, no epoch math, so leap years and month-length differences
 * are handled by the JS `Date` constructor's month normalization. `to` is
 * the exact `now` passed in, never re-derived. No I/O, no `Date.now()`.
 *
 * `timeZone` is accepted for forward compatibility only (the skill names it)
 * and is currently a documented no-op: this app has no timezone-selection
 * feature, `Date` in RN/JS is already local-device-timezone, and no
 * timezone utility exists elsewhere in the codebase to lean on. Implementing
 * full IANA support would require a date library nothing else uses yet.
 */
const MONTHS_PER_PERIOD: Record<Exclude<Period, '1Y'>, number> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  '9M': 9,
};

const MONTHS_IN_YEAR = 12;

export function periodRange(period: Period, now: Date, timeZone?: string): PeriodRange {
  // `timeZone` is a documented no-op placeholder (see doc comment above);
  // the `void` keeps it from tripping the unused-parameter rule.
  // eslint-disable-next-line no-void
  void timeZone;

  if (period === '1Y') {
    const year = now.getFullYear();
    const monthIndex = now.getMonth() - MONTHS_IN_YEAR;
    const daysInTargetMonth = new Date(year, monthIndex + 1, 0).getDate();
    const day = Math.min(now.getDate(), daysInTargetMonth);
    const from = new Date(year, monthIndex, day, 0, 0, 0, 0);
    return { from, to: now };
  }

  const months = MONTHS_PER_PERIOD[period];
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 0, 0, 0, 0);
  return { from, to: now };
}
