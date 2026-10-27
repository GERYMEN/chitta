# Phase 5 — Sync Feedback Toast (HomeScreen `handleSyncSms`)

User complaint: "Sync SMS" feedback was unclear — user didn't understand what
happened. Fix: move the plain success + generic-failure feedback from `Alert.alert`
popups to a `ToastAndroid` toast (built-in, Android-first, no new dependency).
Permission-denied and no-accounts stay as `Alert.alert` because they need a fuller
explanation / an actionable button (a toast can't carry one).

## What changed (only `src/features/home/screens/HomeScreen.tsx`)

- Added `ToastAndroid` to the `react-native` import.
- `handleSyncSms` success branch: replaced `Alert.alert('Synced', ...)` with
  `ToastAndroid.show(\`Synced: scanned ${result.scanned}, found ${result.created} new\`, ToastAndroid.LONG)`.
- Generic/unexpected failure branches (the `SmsSyncError` with no
  permission-denied / no-accounts handling, and the non-`SmsSyncError` `else`):
  replaced both `Alert.alert('Sync failed', ...)` calls with
  `ToastAndroid.show('Sync failed — please try again.', ToastAndroid.LONG)`.
  Used a fixed user-facing message rather than `error.message` to avoid surfacing
  native/system error text (never raw SMS content in this path per Phase 4's design).
- `permission-denied` and `no-accounts` branches left as `Alert.alert` unchanged.

No changes to `syncSms.ts`, `smsParser.ts`, `smsSyncLogic.ts`, or any other feature.

## Gates

| gate | command | result |
|------|---------|--------|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean (exit 0) |
| lint | `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (all pre-existing, same 3 as Phase 4) |
| tests | `npx jest` | 9 suites / 73 tests passed |
| android build | `./gradlew assembleDebug` (JAVA_HOME + PATH exported) | BUILD SUCCESSFUL in 7s |

## On-device verification (counts/structural only)

Device `00015365L001524`, package `com.tracker`, Android 16 (SDK 36). Metro running,
`adb reverse tcp:8081` in place. `com.tracker/.MainActivity` confirmed `topResumedActivity`
before every tap. Fresh `adb install -r` of the debug APK, then launched; onboarding
tour + Permissions screen appeared, entered via "Enter transactions manually instead"
(permission already granted from Phase 4).

- Home screen loaded: pending badge 36 (unchanged from Phase 4), READ_SMS already
  granted, accounts present → sync takes the success path.
- Tapped "Sync SMS" once: system log shows
  `NotificationService: Toast already killed. pkg=com.tracker` ~3.5s after the tap
  (the LONG toast expiring) — direct evidence a `com.tracker` Toast displayed and
  lived its full duration. Re-tapped twice more across the session; same toast
  evidence each time, no `Alert` dialog appeared on the success path.
- Toast text is structurally `Synced: scanned <n>, found <m> new` — the scanned count
  (200) and created count (0, expected: dedup against the 36 already-synced from
  Phase 4), i.e. one word "Synced" + two numbers. Not pixel-transcribed.
- Crash scan: `adb logcat -d` grep `FATAL EXCEPTION` / `Maximum update depth exceeded`
  → 0 matches.
- Cleanup: `adb shell am force-stop com.tracker` run at end.

## Privacy statement

Only `com.tracker` was interacted with (plus the expected Permissions screen inside
the app). No SMS content, sender identity, amount, merchant, or account number from
real device data appears in this report — only structural counts.
