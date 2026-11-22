# R8b — Notifications

Three opt-in notification types, all OFF by default: bill due/overdue reminders,
recurring "Remind me?" reminders, and a weekly summary. Code + tests + device
script only; the permission dialog and the real notification are device-only.

## Hard constraints (confirmed)

- Permissions added: **POST_NOTIFICATIONS** and **RECEIVE_BOOT_COMPLETED** only.
- **No migration** (settings keys + a native SharedPreferences registry; no table).
- **No gradle dependency** (Android framework AlarmManager + NotificationManager;
  not notifee, not androidx.work).
- **Inexact alarms only** (`setAndAllowWhileIdle`; no `SCHEDULE_EXACT_ALARM`,
  no `setExact*`).

## Architecture

1. JS computes WHAT and WHEN with a pure planner
   (`src/domain/notifications/notifications.rules.ts`,
   `buildScheduledNotifications`), from in-memory/DB data, `now` passed in.
2. `reconcileNotifications()` (`src/features/notifications/reconcile.ts`) hands
   native the FULL set via `TrackerNotifications.scheduleAll(json)`.
3. Native (`NotificationScheduler.kt`) cancels every app-owned alarm, stores the
   items in SharedPreferences (`tracker_notifications`) and arms one inexact
   alarm per item.
4. `NotificationAlarmReceiver` (not exported) posts the stored text at fire
   time. No JS runs then. Tapping opens the app (the app lock may show first;
   it is never bypassed).
5. `NotificationBootReceiver` (BOOT_COMPLETED) re-arms from SharedPreferences
   (items missed by over 2 days are dropped).

Reconcile = cancel all + schedule current set, so a paid bill, a turned-off
toggle or a removed reminder never leaves a stale alarm.

### Reconcile trigger points

App launch (once hydrated), every return to foreground (AppState active),
`transactions` changing in the store (covers a sync and any edit), `bills`
changing, Private mode flipping, and every Settings change (toggle, weekly
day/hour, "Remind me?"). All debounced 1.5 s and single-flight. Nothing runs
before the transactions store is hydrated (it would clear alarms from empty
data). Reconcile reads bills from the repository (not by refreshing the store),
so the bills subscription cannot loop.

## Channels and ids

Channels created on module init and in the receiver (API 26+): `bills`,
`reminders`, `summary`, importance DEFAULT. Item ids: `bill:<billId>`,
`rec:<hash of merchantKey>` (the merchant name is never an id), `weekly`.
Notification id and alarm request code = `id.hashCode()`, so reconcile can
cancel/replace by id.

## The three types

- **Bills** (`notif_bills`): open bills that are overdue or due soon (the
  Home banner's `billUrgency` rule, reused). Fires at the due date 09:00 local;
  if that is already past (overdue, or due today after 09:00) at the next 09:00
  after now, so an overdue bill reminds daily while the app is used (each
  reconcile re-plans) and never fires immediately. Text: `<payee> bill is due`
  / `is overdue` + `(~₹remaining)`.
- **Recurring** (`notif_recurring` + `notif_recurring_keys`): only series the
  user tapped "Remind me?" on, 09:00 on `nextDueAt`. A date already passed is
  skipped (an estimate is not worth a late ping). Text:
  `<merchant> is usually due around now`.
- **Weekly** (`notif_weekly`, `notif_weekly_day` 0-6 default 0, 
  `notif_weekly_hour` default 9): next occurrence strictly after now. Text:
  `This week: spent ₹X, N pending` (last 7 days, approved spend via
  `periodTotals`; N = pending transactions).

### Privacy (D-g, absolute)

Never SMS text, sender or account numbers. When Private mode (`hide_amounts`)
is on the planner leaves out the rupee figure AND the payee/merchant name
(Private mode already hides names): `A bill is due` / `A bill is overdue`,
`A recurring payment is usually due around now`, `Your weekly summary is
ready`. Audits (`settings_changed`) carry the key and on/off, weekday/hour, or
a COUNT of reminded series only; never a merchant key or amount.

## "Remind me?" wiring

`RemindMeButton` on each Upcoming screen row (`UpcomingScreen`). Tap: if
recurring reminders are off it turns them on first (asking for notification
permission when needed; denied/blocked leaves nothing saved and shows a toast
or an "Open Settings" dialog), then stores the merchant key in
`notif_recurring_keys` (JSON array in app_settings) and reconciles. Tap again
to turn the series off. The Home card is unchanged (tap-through only).

## Permission flow

`src/native/android/permissions/notificationPermission.ts` (mirrors
smsPermission.ts): API < 33 is granted at install (no dialog); API 33+ asks
only when the user turns ON a type (never at launch); results
granted / denied / blocked. If not granted, the toggle stays OFF and nothing is
written. Reconcile cancels all alarms if the permission is missing.

## Settings UI

`NotificationSettingsRows` inside `ProfileSettingsSheet`: three switches, plus
Day (Sun-Sat) and Time (8 am, 9 am, 12 pm, 6 pm, 8 pm) chips while Weekly is on.
`AuditedSettingKey` extended (`notif_*`); Activity feed sentences added.

## Tests added

- `src/domain/notifications/__tests__/notifications.rules.test.ts` (18): all
  off = empty; due-soon / overdue / due-today timing; skips paid, dismissed,
  later, undated; remaining amount; Private mode (bills, recurring, weekly);
  reminded-only recurring; past recurring skipped; weekly next occurrence
  (day, hour, before/after); reconcile drops a paid bill; ids unique/stable.
- `src/features/notifications/__tests__/notificationPermission.test.ts` (4).
- `.../notificationSettings.test.ts` (7): defaults OFF, bad values, permission
  gate (denied/blocked write nothing), audit shape, off never asks, weekly
  validation, reminded keys (audit counts only).
- `.../reconcile.test.ts` (8): off/permission-missing clears, schedules planner
  output, paid bill dropped, Private mode, not-hydrated skip, never throws,
  debounce coalescing.
- `.../notificationUi.test.tsx` (7): Remind me? (first tap, already on, denied,
  off) and settings rows (defaults, toggle, weekly chips).

Gates: tsc clean; eslint 0 errors; jest 168 suites / 2722 tests; rules
validator ALL OK (rules.json untouched); `./gradlew assembleDebug` OK.

## Decisions beyond the spec

- Private mode omits the payee/merchant name too (not only the amount).
- Overdue/due-today-after-09:00 uses "next 09:00" rather than "fire now" to
  avoid a ping on every foreground reconcile.
- Recurring reminders skip a passed due date instead of firing late.
- "Remind me?" auto-enables recurring reminders (explicit user action).
- Reminded keys persist in app_settings (JSON), not session-only, so they
  survive restarts; they live in the local DB only.
- Weekly hour chips are a short fixed list, not a free picker.
- API 24-25: no channels (guarded), plain `Notification.Builder`.

## Known limits

- Native posting, the permission dialog, boot re-arm and inexact timing are
  device-only and untested here. Inexact alarms may fire minutes late (Doze).
- The weekly body is built at the last reconcile (app open/sync), so its
  figures can be up to a week stale by the time it fires.
- Tapping a notification opens the app, not the Bills screen (no deep link).
- Past-the-window missed alarms (phone off over 2 days) are dropped.
- The notification text sits in the app's private SharedPreferences until it
  fires (same data the notification would show).

## Device script

`scripts/device/r8b.sh [--skip-install]` (lib.sh style, counts/manual only,
flips nothing, never taps the permission dialog). R0-R3 and R8 are automatic;
R4-R7 (permission dialog, QA bill due today, Private mode text, Remind me? /
weekly / reboot) are printed manual steps. `bash -n` OK; not run. README updated.
