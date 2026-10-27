# Phase 4 — SMS Sync (continuation run 04b: review + gates + verification)

This file is the continuation of the interrupted Phase 4. The original run built
all the code (native module, manifest, parser, wiring) but crashed mid-verification
before running the static gates or writing a report. This run's job was: (1) review
the existing code, (2) run the never-confirmed gates, (3) do a count-only on-device
verification, (4) write this report.

## What was already built (verified present, not re-done)

- `android/app/src/main/java/com/tracker/SmsReaderModule.kt` — `ReactContextBaseJavaModule`,
  `getName()` → `"SmsReader"`, `@ReactMethod readInbox(limit, promise)` with a
  `READ_SMS` permission check, `ContentResolver` query of `content://sms/inbox`
  (`_id`, `address`, `body`, `date`, `date DESC`), cursor closed via `use { }`,
  resolves a `WritableArray` of `WritableMap`.
- `android/app/src/main/java/com/tracker/SmsReaderPackage.kt` — `ReactPackage`,
  `createNativeModules` → `listOf(SmsReaderModule(...))`, `createViewManagers` → `emptyList()`.
- `android/app/src/main/AndroidManifest.xml` — `READ_SMS` permission added.
- `MainApplication.kt` — `add(SmsReaderPackage())` registered.
- `src/native/android/sms/smsReader.ts` — typed wrapper `readInbox(limit = 200)`.
- `src/native/android/permissions/smsPermission.ts` — `checkSmsPermission`/`requestSmsPermission`.
- `src/features/sms-sync/smsParser.ts` — `parseSmsMessage`, `ParsedSmsTransaction`.
- `src/features/sms-sync/smsSyncLogic.ts` — `filterNewCandidates`, `resolveAccountIdForSms`,
  `resolveCategoryIdForSms`.
- `src/features/sms-sync/syncSms.ts` — `syncSms()` orchestration.
- `src/features/sms-sync/__tests__/smsParser.test.ts` + `smsSyncLogic.test.ts`.
- `src/features/home/screens/HomeScreen.tsx` — `onSyncSms` → `handleSyncSms` → `syncSms()`
  with `Alert.alert` count-only results + permission-denied / no-accounts / generic errors.
- `src/features/onboarding/screens/PermissionsScreen.tsx` — `enterApp` awaits
  `requestSmsPermission()` (navigates regardless), `enterAppManual` skips it.

## Code review (B2) — sound, no bugs found, no fixes needed this run

Verified against the phase spec (`prompts/04-sms-sync.txt`):

- **`sourceReferenceHash` never incorporates the sender address.** `smsParser.ts`
  line 137: `` `sms-${msg.id}-${msg.date}` `` — only the Android-internal row `_id`
  and the timestamp. Confirmed by direct read, not memory. `msg.address` is never
  used anywhere in the hash (or anywhere in the parser's return value).
- **`sanitizedPreview` built only from parsed fields.** `smsParser.ts` lines 138–140:
  `` `${type === 'expense' ? 'Debited' : 'Credited'} ${formatRupeesFromMinor(amountMinor)} — ${merchantName}` ``.
  No raw `msg.body` substring, no `msg.address`. Grepped the parser file myself to
  confirm `msg.body` appears only in the reject/amount/direction/merchant regex
  inputs and `msg.address` never appears in the return object.
- **Dedup checks `sourceReferenceHash` against `store.transactions` before insert.**
  `syncSms.ts` lines 67–71 build `existingHashes` from `store.transactions`
  `sourceReferenceHash`, `filterNewCandidates` (smsSyncLogic.ts) drops matches, and
  the insert loop (lines 89–119) skips anything not in the `fresh` set.
- Category resolution uses runtime lookups by name (`'Shopping'` / `'Salary & Wages'`)
  against `store.categories`, matching the seeded ids (`cat-shopping` / `cat-salary`),
  with a by-type fallback — no hardcoded id string. Account resolution matches
  `lastFour` in the body, else first account, else null (caller guards the
  no-accounts case). All per spec.

No genuine bugs. Nothing fixed this run.

## Gates (B1) — all pass

| gate | command | result |
|------|---------|--------|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean (exit 0, no output) |
| lint | `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (all pre-existing: `react/no-unstable-nested-components` in MainTabs + PendingScreen, `react-native/no-inline-styles` in StatTile) |
| tests | `npx jest` | 9 suites / 73 tests passed (includes new `smsParser.test.ts` + `smsSyncLogic.test.ts`) |
| android build | `cd android && ./gradlew assembleDebug` (JAVA_HOME + PATH exported) | BUILD SUCCESSFUL in 8s |

## On-device verification (B3) — counts only

Device `00015365L001524`, package `com.tracker`. Metro already running,
`adb reverse tcp:8081` in place. Permission state at start:
`dumpsys package com.tracker` showed `android.permission.READ_SMS: granted=true`
(`USER_SET` flag) — the permission had already been granted by the previous run's
PermissionsScreen flow.

**Verification summary (numbers only):**

- Pending badge **before** this run's sync taps: **36** (pre-existing, created by
  the previous run's sync — this is the key evidence).
- **First** Sync SMS tap result Alert: `scanned = 200`, `created = 0`,
  `skipped = 200`.
- Pending badge **after** first tap: **36** (unchanged, consistent with `created = 0`).
- **Second** Sync SMS tap result Alert: `scanned = 200`, `created = 0`,
  `skipped = 200` (dedup holds).
- Pending badge **after** second tap: **36** (unchanged).
- Crash scan: `adb logcat -d` grep `FATAL EXCEPTION` / `Maximum update depth
  exceeded` → **0 matches** (logcat had 11456 lines of real content).

**Reading the result honestly (badge-count method, not a guess):**

The `created = 0` on the first tap is because **all financial messages in this
inbox were already synced by the previous run** — not because the parser found
nothing or no accounts matched. Proof: 36 pending transactions already existed
before this run touched anything, and Phase 2/3 only ever created one test
expense (which was approved, not left pending) plus two accounts — so those 36
pending items are SMS-derived transactions the previous run created from this
same inbox. A re-sync correctly produces `created = 0` because every one of those
already-parsed messages is filtered out by the `sourceReferenceHash` dedup check.
The app did not throw the `no-accounts` error (accounts exist from Phase 3), and
`scanned = 200` proves the native module read the real inbox (the module rejects
with a permission error rather than returning a count if `READ_SMS` is not granted).

The `created = 0` on the second tap is therefore direct dedup evidence: re-running
Sync SMS over an already-synced inbox creates zero duplicate transactions.

## Privacy statement (required)

During this run's verification I did not launch or open any app other than
`com.tracker`; the only non-Tracker window that appeared was the Android system
permission-controller surface, and on two occasions the OS merely revealed an
already-running background app (the browser at the very start, and the user's
messenger after I force-stopped Tracker to return the device to a clean state) —
in neither case did I dump, screenshot, or read the content of those apps, and I
returned to `com.tracker` immediately each time. No SMS message content, sender
identity, amount, merchant, or account number from real device data appears
anywhere in this report — only counts.
