# Phase 7 (pure-math slice): `periodRange` — date math only

## Scope delivered

Pure `periodRange(period, now, timeZone?)` only. No SQL aggregates, no
Zustand store refactor, no UI (period chips/totals/partial-data notice), no
`sms_scan_from` guard — all deferred to later phases per the dispatch.

Files:
- `src/domain/periods/period.types.ts` — `Period` union (`'1M' | '3M' | '6M' | '9M' | '1Y'`) + `PeriodRange { from; to }`.
- `src/domain/periods/period.rules.ts` — `periodRange`.
- `src/domain/periods/__tests__/period.rules.test.ts` — 18 tests.

New domain folder matches the existing `src/domain/{accounts,transactions,categories,audit}/`
`*.types.ts` + `*.rules.ts` convention.

## Arithmetic used (exact)

- `1M/3M/6M/9M` (the "1st of some month" periods):
  `from = new Date(now.getFullYear(), now.getMonth() - (monthsCovered - 1), 1, 0, 0, 0, 0)`.
  `monthsCovered` = 1/3/6/9 respectively. So the month index is
  `current − (monthsCovered − 1)`, i.e. `1M → −0`, `3M → −2`, `6M → −5`, `9M → −8`.
  JS `Date` constructor normalizes negative month indices, so year-boundary
  wraps (e.g. Feb 2026 → `−2` → Dec 2025) fall out of the constructor with no
  manual year math.
- `1Y` (trailing 12 months):
  `from = new Date(now.getFullYear(), now.getMonth() - 12, min(now.getDate(), daysInTargetMonth), 0, 0, 0, 0)`,
  where `daysInTargetMonth = new Date(year, monthIndex+1, 0).getDate()` (last day of the target month).
- `to` is the exact `now` reference passed in — never re-derived.
- Pure year/month/day field arithmetic on local-time fields (`getFullYear`/
  `getMonth`/`getDate`). No epoch math, no day-counting, no `Date.now()`, no I/O.

## 1Y clamping behavior (chosen + why)

Day-of-month clamps down to the last valid day of the target month when
`now`'s day doesn't exist 12 months back. Because 12 months back always has
the SAME month name, its length differs only across leap years — so the only
real case is a leap-year Feb 29 mapping to a non-leap Feb 28 (e.g. `now` =
Feb 29 2028 → from = Feb 28 2027). No day-counting is done, so this is the
single `Math.min` guard, not a general clamping loop. This is the natural
"same day-of-month, rolling window" reading: preserve the day-of-month the
user expects, degrade gracefully when the calendar can't.

## timezone parameter decision

Accepted as optional `timeZone?: string` per the skill's signature, but it is
a documented no-op placeholder. The app has no timezone-selection feature,
`Date` in RN/JS is already local-device-timezone, and no timezone utility
exists anywhere in this codebase. Pulling in a date/timezone library for full
IANA support would be dead weight — deferred to a future phase if ever needed.
The parameter is kept (not silently dropped) and the no-op is stated in the
function's doc comment; `// eslint-disable-next-line no-void` + `void timeZone`
keeps the unused-parameter rule quiet.

## Test results

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint src --ext .ts,.tsx` — 0 errors (3 pre-existing warnings in
  `MainTabs.tsx`, `StatTile.tsx`, `PendingScreen.tsx` — none from this phase).
- `npx jest` — 14 suites, 178 tests passing (160 prior + 18 new).

Coverage per the skill's own instruction (month ends, leap years, year boundaries):
- 1M mid-month → Mar 1 00:00 local; 1M on the 1st → same day; 1M on the 31st
  → Mar 1; 1M on Jan 1 → Jan 1 (no Dec rollback).
- 3M/6M/9M crossing a year boundary (Feb 2026 → Dec/Sep/Jun 2025), proving no
  month-"−1" wrap bug.
- Leap-year test: implementation is pure year/month arithmetic (no
  day-counting), so the test just confirms 1st-of-month boundaries around leap
  Feb 2028 stay correct — no forced elaborate day-count test.
- 1Y ordinary → exactly 12 months back, same day-of-month, local midnight.
- 1Y clamp → Feb 29 2028 → Feb 28 2027 (documented clamp).
- 1Y explicitly NOT calendar-year: a `now` of Mar 15 2026 asserts from =
  Mar 15 2025 (not Jan 1 2026) — fails if someone later "fixes" to
  calendar-year semantics.
- Purity: two calls with different periods, same `now`, are independent; a
  mutation of one call's `from` does not affect another; each call returns a
  fresh `Date`.
- `timeZone` accepted and ignored.
- Exhaustiveness over all five period values.

## Ground facts honored

- STATE.md "Open questions — now answered": 1Y = trailing 12 months, NOT
  calendar year — implemented and locked in by a test (above).
- No device work this phase: no adb, no install, no Gradle. Pure TS + Jest.
