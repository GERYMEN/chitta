# R8a — Recurring detection + Upcoming card

Pure derived feature over approved transactions (like R4 insights). No
migration, no audit, no permission, no dependency, no network.

## Built
- T0 `src/domain/recurring/` (`recurring.types.ts`, `recurring.rules.ts`):
  `detectRecurring(transactions, now)`, `upcomingWithin(series, now, windowDays)`,
  `daysUntilDue`, `relativeDueLabel`. No clock read inside.
- T1 `src/features/upcoming/`: `UpcomingCard` (Home, between nothing-else and
  BudgetCard), `UpcomingScreen`, `useUpcoming` (useNow, refreshes on focus /
  foreground / transactions change), session-only `dismissedRecurringStore`,
  labels. Route `Upcoming` added to `routes.ts` + `RootNavigator.tsx`.
- T2 `scripts/device/r8a.sh` + README section (bash -n only; not run).

## Detector rules
- Input: approved rows with `spendContributionMinor > 0` (excludes transfers,
  income, linked refunds, hidden duplicates, pending/rejected). Grouped by
  `normalizeMerchant(merchantName)`.
- Recurring = >= 3 occurrences, every consecutive gap (local calendar days)
  inside one cadence class, and every amount within +/-10% of the median.
- Cadence classes: weekly gaps 6..8; monthly 28..31; yearly 360..370.
- typicalAmountMinor = median (an estimate; shown as "~Rs X").
- nextDueAt = last + one cadence step: weekly +7 days, monthly +1 calendar
  month (day clamped to month end), yearly +12 months.
- Upcoming window: nextDue from now-3 days to now+14 days (local calendar days),
  sorted by nextDue. Card lists the first 3; screen lists all detected series.

## Why no migration / audit
Nothing is persisted and no money changes. "Not recurring" is session-only
(in-memory store). No AuditEventType added.

## Tests added
- `src/domain/recurring/__tests__/recurring.rules.test.ts` (10): monthly,
  weekly, yearly, <3 rejected, amount tolerance both sides, irregular gaps,
  transfer/pending/rejected/income/duplicate exclusion, merchant key grouping,
  window incl. overdue + sort order, relative labels.
- `src/features/upcoming/__tests__/dismissedRecurringStore.test.ts` (2).

## Decisions beyond D-a..D-h
- Monthly/yearly nextDue uses calendar-month stepping rather than a median gap
  in days (same intent as "snapped to cadence", avoids drift).
- Tolerances: weekly 6..8, yearly 360..370 (spec gave only the monthly range).
- "Today" and day gaps use local calendar days, not 24h blocks.
- Detection uses the whole history of a merchant: one stray off-cadence
  payment disqualifies the group (conservative, favours no false positives).

## Known limits
- Needs >= 3 occurrences, so a fresh install shows nothing for months.
- Same-day double payments (gap 0) make a group non-recurring.
- Estimates only; no reminders (R8b).
- Card order: placed directly before BudgetCard.

## Device script
`scripts/device/r8a.sh [--skip-install]` — read-only: card absent/one, Upcoming
screen opens when shown, crash check. Detector covered by unit tests (dated
history cannot be created reliably over adb).
