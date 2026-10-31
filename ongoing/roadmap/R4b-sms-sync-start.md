# R4b — Choose where SMS sync starts + no 200-message cap: report

Executor: Claude subagent. Date: 2026-11-01. Branch: `phase/R4b-sms-sync-start` (from `phase/R4-insights`). Nothing was committed or staged.

This dispatch was **code + tests + gates only**. There was no device work: no adb at all.

## Summary

- **Gates: all pass.**
  - `npx tsc --noEmit -p tsconfig.json` is clean.
  - `npx eslint src --ext .ts,.tsx` has 0 errors and 2 warnings, both already there (MainTabs, StatTile).
  - `npx jest`: 75 suites, 710 tests, all pass. Baseline was 69 suites and 651 tests, so +6 suites and +59 tests.
  - `./gradlew assembleDebug`: BUILD SUCCESSFUL.
- **Files: 39 source/test files** (25 modified, 14 new), plus this report. `ongoing/roadmap/STATE.md` was already modified by the orchestrator and was not touched.
- **No migration, no new dependency, no new Android permission.**
  - The settings fit the existing `app_settings` key/value table.
  - "Pick a date" reuses `@react-native-community/datetimepicker`, which is already used by the Add/Edit forms.
- **The 200 cap is gone.** Sync now reads a date window in pages of 300.
  - It parses and inserts each page, then yields to the UI before the next.
  - Progress and Cancel are shown on the Home card.

## Files

**New (14)**

- `src/domain/settings/smsSyncStart.rules.ts`: the pure core of this phase.
  - Modes, keys, the 4 options and their copy.
  - `startForChoice`, `upgradeDefaultStart`, `computeSyncWindow`, `classifyStartChange`, `needsLargeScanConfirm`, `nextLastSyncedAt`.
  - Labels and count formatting.
- `src/features/sms-sync/inboxPaging.ts`: a pure TS mirror of the native paging (cursor, last page, selection, order).
- `src/features/sms-sync/syncRunner.ts`: one scan at a time.
  - A zustand store holds progress (`running`, `scanned`, `total`) and a cancel token.
  - It also holds the large-scan confirm.
- `src/features/sms-sync/components/SyncStartOptions.tsx`: the radio list shared by onboarding and Settings.
- `src/features/sms-sync/components/SyncStartEditor.tsx`: the Settings editor (4 options + Pick a date + Save start).
- `src/features/onboarding/screens/SyncStartScreen.tsx`: the onboarding step, plus `saveOnboardingSyncStart`.
- `src/data/repositories/smsSync.repository.ts`: `firstRunStartedAtMs()` (MIN `started_at` of `sms_sync_runs`). It is read-only.
- `src/test/helpers/fakeInbox.ts`: a test double of the native paged API, built on the `inboxPaging` mirror.
- Tests (6):
  - `src/domain/settings/__tests__/smsSyncStart.rules.test.ts`
  - `src/features/sms-sync/__tests__/inboxPaging.test.ts`
  - `src/features/sms-sync/__tests__/syncSms.paging.test.ts`
  - `src/features/sms-sync/components/__tests__/SyncStartOptions.test.tsx`
  - `src/features/transactions/state/__tests__/transactionsStore.syncStart.test.ts`
  - `src/shared/ui/Dialog/__tests__/confirmDialog.test.ts`

**Modified (25)**

- **Native**
  - `android/app/src/main/java/com/tracker/SmsReaderModule.kt`
  - `src/native/android/sms/smsReader.ts`
- **Sync**
  - `src/features/sms-sync/syncSms.ts`
  - `src/features/sms-sync/syncToast.ts`
- **Store**
  - `src/features/transactions/state/transactionsStore.ts`
- **Audit**
  - `src/domain/audit/audit.types.ts`
  - `src/domain/audit/audit.rules.ts`
  - `src/features/activity/activityFeed.ts`
- **UI**
  - `src/features/home/screens/HomeScreen.tsx`
  - `src/features/home/components/BalanceCard.tsx`
  - `src/features/profile/components/ProfileSettingsSheet.tsx`
  - `src/features/pending/screens/PendingScreen.tsx`
  - `src/features/pending/pendingGroups.ts`
  - `src/features/onboarding/screens/PermissionsScreen.tsx`
  - `src/features/onboarding/screens/ProfileSetupScreen.tsx` (step label "7 OF 9")
  - `src/shared/ui/Dialog/dialogStore.ts` (adds `confirmDialog`)
- **Navigation**
  - `src/app/navigation/routes.ts`
  - `src/app/navigation/RootNavigator.tsx`
- **Tests**
  - `syncToast.test.ts`
  - `syncSms.audit.test.ts`
  - `syncSms.session.test.ts`
  - `syncSms.transfer.test.ts`
  - `suggestionGroups.test.ts` (mocks moved to the paged API)
  - `activityFeed.test.ts`
  - `pendingGroups.test.ts`

## Native API (T1)

All three methods are in the own module `SmsReader`. Every value is a bound selection argument and nothing is concatenated.

- **`readInboxPage(sinceMs, beforeMs, beforeId, limit)`**
  - It reads `content://sms/inbox`, projecting `_id, address, body, date`.
  - Selection: `date >= ? AND (date < ? OR (date = ? AND _id < ?))`
  - Args: `[sinceMs, beforeMs, beforeMs, beforeId]`
  - Order: `date DESC, _id DESC`.
  - At most `limit` rows are read from the cursor. There is no LIMIT in the sort order, because some SMS providers reject that.
  - **Deviation from the prompt signature:** I added a 4th argument, `beforeId`, for the equal-date tiebreak. Paging is by (date, `_id`), so SMS that share one date are never skipped or read twice.
  - The first page passes `beforeId = 0`. `_id < 0` never matches, so the first page is exactly `since <= date < before`.
- **`countInboxSince(sinceMs)`**
  - It runs a COUNT(*) projection with `date >= ?`.
  - If a provider rejects aggregate projections, it falls back to the count of an `_id`-only cursor.
  - Neither path reads an address or a body.
- **`readById` is unchanged** (used by View original SMS).
- **`readInbox` was removed**, because nothing else used it.
- **Error messages** are fixed strings. The old `readInbox` passed `e.message` through; the new methods do not.
- **Window counts:** the estimate for a window is `count(date >= since) − count(date >= before)`, from `estimateWindowCount` in `syncSms.ts`.

## Settings keys (T2)

All three keys live in `app_settings`, so no migration was needed.

| Key | Values | Audited |
|---|---|---|
| `sms_sync_start_mode` | `install` / `month` / `3m` / `all` / `custom` | yes — `settings_changed {key, from, to}` |
| `sms_sync_start_at` | ISO date; `''` = whole inbox | yes — `settings_changed {key, from, to}` (`from: 'unset'` when the key did not exist) |
| `sms_last_synced_at` | ISO date of the newest SMS a normal sync fully processed | no — it is a sync cursor, not a user setting (avoids one Activity row per sync) |

- **Audit content:** `AuditedSettingKey` gains the two start keys. The metadata holds dates and mode names only.
- **Activity copy:**
  - User: "You set SMS sync to start from 14 Oct 2026" / "You chose SMS sync start: Last 3 months". The impact line is "Was …".
  - Upgrade (actor `system`): "SMS sync start set to …", with "Set automatically on update".
- **Upgrade path** (`applySmsSyncStartUpgrade`, run at the end of `hydrate`):
  - It runs only when onboarding is done and no mode is saved.
  - It saves `custom` with the earliest of the first `sms_sync_runs.started_at` and the earliest SMS-sourced transaction `occurredAt` (any status). If neither exists, it uses the time of the upgrade.
  - It is audited by `system`, with no UI.
  - A failure never blocks the app from opening.
- **Note on `sms_sync_runs`:** nothing in the codebase writes to this table today, so on existing installs the earliest SMS row decides.

## Window rules and paging (T3)

- **Normal Sync:** the window is `[start, now]` (start null → 0).
- **Later syncs:** from `max(start, sms_last_synced_at − 1 day)` to now. Dedup by `sourceReferenceHash` prevents doubles in the overlap.
- **Pages:**
  - 300 rows per page, newest → oldest. Each page is parsed, deduped, matched, categorised and inserted.
  - Progress `{scanned, total}` is reported after each page. `total` is the COUNT estimate.
  - Then `setTimeout(0)` yields before the next page.
  - The raw page (address/body) goes out of scope once it is parsed.
- **Cancel** is checked between pages.
  - Inserted items are kept.
  - `sms_last_synced_at` is **not** moved. Pages run newest → oldest, so no older part of the window is complete until the whole window is.
  - The next sync re-reads the window and dedup skips what was inserted. The test proves 300 + 350 = 650 with no doubles.
- **The cursor moves** only after a normal sync completes, to the newest SMS date seen. It only ever moves forward.
- **Large scans:** when the estimate is above 500, Sync asks first: "About N SMS to scan — this may add many items to Pending." with Cancel / Scan.
  - If the user says no, nothing is read.
  - Exactly 500 does not ask.
- **Unchanged:** account matching, R2b suggestion session (unmatched items are collected across all pages, one session per run), R2 categories, R3a/R3b pair holds, the auto-approve rule (still after ALL pages, over this run's new rows) and the audit.
- **Toast:** "Scanned N SMS · M new", plus " · K auto-approved" / " · U uncategorised" when > 0, and a "Stopped · " prefix after Cancel. Counts only.

## UI (T4)

- **Onboarding** is now Permissions → **SyncStart** ("STEP 9 OF 9 · SMS SYNC").
  - It is a radio list of 4 options, each with a helper line.
  - "From install date" is pre-selected and has the Recommended badge. Its helper says the first sync starts empty.
  - Continue saves the mode and date (audited), then completes onboarding.
  - Rows are ≥ 56dp, with `accessibilityRole="radio"`, a checked state and labels.
  - The "Enter transactions manually instead" link skips the question, saves the install-date default (audited) and finishes.
- **Settings sheet:** a new row "SMS sync starts: 14 Oct 2026 | Whole inbox" expands the editor.
  - The editor shows the 4 options, "Pick a date" (date picker, max today, local midnight) and Save start.
  - **Earlier:** the sheet closes and asks "Scan SMS from <new> to <old>? About N SMS." If the count can't be read (e.g. no permission), the count line is omitted.
    - On Scan, only the gap `[new, old)` is scanned, with progress on Home.
    - The new start is saved **only when the gap scan completes**. If it is cancelled, the toast says "start date not changed", so a half-scanned gap is never hidden behind a moved start.
    - A gap scan never moves `sms_last_synced_at`.
  - **Later:** saved. A dialog says "Items already recorded stay; future syncs start from <date>." Nothing is deleted.
  - **Same date:** the mode is saved, and audited only if it changed.
- **Home:** while a scan runs, the Balance card's button row is replaced by "Scanning 1,200 / 4,800" + Cancel.
  - The row is the same 48dp height, so there is no layout jump.
  - Before the count is known it shows "Preparing scan…", and after Cancel "Stopping…".
- **Pending:** "Approve all N".
  - N counts the visible pending items under the current type and account filter, minus any item in a possible transfer or duplicate pair. Pairs are found over all rows, so a debit whose credit twin is filtered out is still held.
  - Tapping it opens a confirm Dialog, then `store.approveAll` approves through `approve` (canTransition, audited `approved`, actor user).
  - A Snackbar then says "Approved N" with UNDO for 5 s. Undo returns exactly those items to pending.
  - "Approve all" shows whenever items are visible. "Auto-approve (N)" still shows only in auto mode, so both appear only in auto mode.

## Decisions I made

1. **Paging tiebreak:** `readInboxPage` takes a 4th argument, `beforeId`, and pages by (date, `_id`) DESC.
2. **Undo audit:** a new audit type `approval_undone` (actor user, `{transactionType}`). Activity shows "You undid the approval of …" / "Back in Pending · not in balance".
   - Undo deliberately bypasses `canTransition`, the same way R3a/R3b exact restores do. approved → pending is not a normal transition.
   - Undo touches an item only if it is still approved with the same `approvedAt` and `linkKind`.
3. **Upgrade cursor:** besides the start, the upgrade sets `sms_last_synced_at` to the newest SMS-sourced row's date.
   - The old 200-cap sync had already read up to then, so the first sync after the update stays a normal incremental one (1-day overlap) instead of rescanning from the start date.
   - If there are no SMS rows, the cursor stays unset (and the start is the upgrade time, so the window is tiny anyway).
4. **The sync cursor is not audited.** Only the user-facing keys are.
5. **Gap scan saves the new start only after completion.** A cancelled or failed gap scan leaves the start unchanged, and inserted items are kept.
6. **Custom date ("Pick a date") is included**, because a date picker already exists. It sets local midnight of the picked day, with maximum today.
7. **Manual-entry path in onboarding** saves the recommended default (install date) without showing the question.
8. **Step labels:** "STEP 7 OF 9" / "STEP 8 OF 9" (now "89% Completed") / "STEP 9 OF 9". The Permissions button reads "Enable & Continue".
9. **`confirmDialog` helper** (promise-based) in the shared Dialog store. It resolves false on Cancel, back, scrim, or when the dialog is replaced.
10. **Large-scan confirm** runs only for a normal Sync. A gap scan is already confirmed with its own estimate.
11. **COUNT fallback:** `countInboxSince` falls back to an `_id`-only cursor count if a provider rejects a COUNT(*) projection.

## Tests (T5)

| Area | What is covered |
|---|---|
| Paging planner | first page = exact window; 650 rows → 3 pages, each once, newest first; 7 equal dates split by page size 3 → no skip or double; exactly full last page; window start respected; cancel after 1 page; empty window |
| Window | first sync; whole inbox; incremental 1-day overlap; start later than the cursor wins; cursor only forward |
| Start moved | earlier → gap only (incl. whole inbox → from 0); later → no gap; same; copy |
| Upgrade | runs vs SMS rows (earliest wins both ways); SMS rows only; run only; neither → upgrade time; manual rows ignored; no-op before onboarding or when already set; cursor = newest SMS row |
| Estimate threshold | 500 → no ask, 501 → ask; message copy |
| Sync end to end (fake paged inbox) | 650 SMS all inserted, progress per page, cursor advanced; > 500 declined → nothing read; ≤ 500 no ask; cancel keeps 300 and does not move the cursor, then the next sync adds 350; incremental reads overlap + new only; install start → empty first sync; gap scan reads only the gap and leaves the cursor |
| Onboarding | choice saved + audited (`unset` → mode/date); install = completion moment; whole inbox stores `''`; repeat save → no extra audit |
| Approve all | excludes transfer/duplicate pair items; respects the filter (held twin outside the filter); dismissed pairs approvable; only pending; audited approved/user; Undo exact (other approved rows untouched; changed item skipped); `approval_undone` metadata |
| Privacy | no sender/body/merchant text in `app_settings` writes, audit rows or console during a sync; same for the upgrade and Approve all/Undo audits |
| UI | radio rows (4, +1 in Settings), recommended + checked state, ≥ 48dp; BalanceCard progress text + Cancel |

All SMS in tests are synthetic ("QA-Merchant-NN", sender "AD-QASNDR").

## DEVICE PLAN (for later — not run)

These are the safety rules for the run:

- The owner's sync start is never changed.
- The run never scans more of the real inbox than a normal incremental sync.
- Only `com.tracker` is used, with the usual foreground check and abort.
- There is no db access, no screenshots, and no output beyond counts.

1. **Install the build.** Install the R4b build over the existing app (`install -r`, data kept). Launch and confirm a clean start.
2. **Upgrade path.**
   - Open Home → greeting → the settings sheet.
   - Read the row "SMS sync starts: <date>" (a date only). It should equal the owner's earliest SMS-sourced item (~14 Oct 2026). **Do not open the editor and do not save.**
   - In Activity, expect one system row, "SMS sync start set to <date> · Set automatically on update", and a mode row.
3. **Incremental Sync.**
   - Tap Sync SMS once. Expect a short "Scanning N / M" row with no large-scan dialog. Because the upgrade cursor is the newest SMS row, N should be about 1 day of SMS plus anything newer, not the whole period since 14 Oct.
   - Record only the toast counts ("Scanned N SMS · M new").
   - If the large-scan dialog appears, tap **Cancel** (nothing is read) and report it. **Do not tap Scan.**
4. **Cancel.** Do not exercise Cancel on the real inbox. Cancel is unit-tested. If it must be seen, only look at the button while step 3 runs and do not tap it.
5. **Onboarding screen.** Not reachable without clearing data, which is not allowed. It is covered by code review and tests.
6. **Settings editor.** Open the editor only to check that the 5 rows render (≥ 48dp, Recommended badge), then close the sheet **without saving**. Never tap Save start, never pick a date, and never trigger a gap scan on the owner's phone.
7. **Approve all.**
   - Only with synthetic QA rows: add 2 manual pending QA items (e.g. QA-Merchant-20/21) on the QA account.
   - On Pending, filter to the QA account. Tap "Approve all 2", confirm, then tap UNDO within 5 s. Expect both back in Pending, and Activity showing "You undid the approval of …" ×2.
   - Delete both QA items afterwards. Never tap Approve all with the owner's real items visible: always filter to the QA account first.
8. **Finish.** Run logcat FATAL/ANR for `com.tracker` since install (counts only), then force-stop.
