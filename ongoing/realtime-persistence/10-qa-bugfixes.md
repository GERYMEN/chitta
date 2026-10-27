# Phase 10 — QA bugfixes (T1–T7) — report

Executor: Claude subagent (continuation 10b, after the opencode/deepseek runs
died on billing errors). Device: `00015365L001524`, 1260×2800, density 480
(1dp = 3px, so 48dp = 144px). Metro already running (200), `adb reverse` set.

## 1. Code review — what was already implemented

| fix | file(s) | state found | verdict |
|---|---|---|---|
| T1 | `android/app/src/main/AndroidManifest.xml` | `configChanges` now ends `...|uiMode|fontScale|density|locale` | correct |
| T2 | `transactionsStore.ts` (`deleteTransaction` = `transactionRepository.delete(id)` + `refresh()`), `TransactionDetailScreen.tsx`, `PendingScreen.tsx` | both screens route `onDelete` through a `handleDelete` that shows `Alert.alert('Delete transaction?', ..., [Cancel, Delete(destructive)])`; the store call only fires from the Delete button's `onPress` | correct, confirmation step is present |
| T3 | `smsPermission.ts`, `syncSms.ts`, `HomeScreen.tsx` | `requestSmsPermission` returns `'granted'|'denied'|'never_ask_again'`; `syncSms` throws new `SmsSyncErrorCode` `'permission-permanently-denied'` for `never_ask_again` and keeps `'permission-denied'`; `HomeScreen` catch shows "SMS permission blocked" Alert with Cancel / "Open Settings" (`Linking.openSettings()`); old denial message unchanged | full chain already wired, nothing to finish |
| T4 | `TransactionDetailContent.tsx`, `TransactionDetailScreen.tsx` | `secondaryButton` has `minHeight: 48`; detail screen renders the action row in a sticky footer outside the ScrollView, inside `SafeAreaView edges={['top','bottom']}`, with `paddingBottom: spacing.xl` | correct for Transaction Detail; **one gap found in the Pending review bottom sheet, fixed (see §2)** |
| T5 | `src/shared/utils/currency.ts`, `__tests__/currency.test.ts` | `showPaise ? Math.floor : Math.round`; tests assert 25075→`₹251`, 25000→`₹250`, -25075→`-₹251`, showPaise 25075→`₹250.75`, 25000→`₹250.00`; no stale floor assertions remain | correct |
| T6 | `accountForm.schema.ts` (`findDuplicateAccount`), `AddAccountScreen.tsx`, `accountForm.schema.test.ts` | normalizes `(type, trim+lowercase name, trimmed lastFour or null)` against active, non-deleted accounts; screen shows "Account already exists" / "An account named '<name>' already exists." and returns before `addAccount`; SMS matching path (`smsSyncLogic.ts`) untouched | correct |
| T7 | `smsParser.ts`, `smsParser.test.ts` | imports `normalizeAccountKey`; `bankName = BANK_DISPLAY_NAMES[bankCanonical] ?? 'Unknown Bank'` (option (b): canonical→display map, e.g. `sbi`→`SBI`, `hdfc`→`HDFC`, `federal`→`Federal`; every canonical id the normalizer can emit is in the map); `lastFour ''`→`null` at the boundary; all 8 old helpers/regexes (`extractBankName`, `BANK_NAME_WORD_PATTERN`, `BANK_NAME_SIGNATURE_PATTERN`, `extractAccountKind`, `CREDIT_CARD_PATTERN`, `BANK_ACCOUNT_PATTERN`, `extractLastFour`, `LAST_FOUR_PATTERN`) are gone from `smsParser.ts`; tests cover "SBI Card ending 4444"→`SBI` and "State Bank of India A/C X4444"→`SBI` | correct |

## 2. Finished/fixed this run

- **`src/shared/ui/BottomSheet/BottomSheet.tsx`** (T4 follow-up). The Pending →
  Review sheet renders the same `TransactionDetailContent` action row. The sheet
  sits at the physical bottom of the screen, and its scroll content had only
  `paddingBottom: spacing.xl`. Even scrolled all the way down, Edit/Reject
  ended at y=2680/2704, which is inside the last ~100–120px. I added
  `useSafeAreaInsets()` and set the content padding to
  `spacing.xl + insets.bottom`. After the change the bottom edges are at
  2608/2632 (168–192px from the bottom), and Reject worked on the first tap.
  No other source changes were needed.

## 3. Gates

| gate | result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS (exit 0), re-run after the BottomSheet edit |
| `npx eslint src --ext .ts,.tsx` | PASS: 0 errors, 3 warnings (the same 3 that existed before), re-run after the edit |
| `npx jest` | PASS: 14 suites / 186 tests, re-run after the edit |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL (before install and again at the end) |

## 4. On-device verification

Setup: force-stop, `adb install -r` of the new debug APK, `adb logcat -c`, launch.
At the start, READ_SMS was `granted=false` with `USER_SET|USER_FIXED`, which is
residual "don't ask again" state from the interrupted run.

1. **T1 (font-scale crash)**: PASS. With Home open: `font_scale 1.3`. Tracker
   stayed `topResumedActivity`, the PID was unchanged (13025, so the Activity
   was not recreated), and Home elements still resolved. Then `font_scale 1.0`
   gave the same result. Logcat had 0 `FATAL EXCEPTION` and 0 `Screen fragments
   should never be restored`. Observation: the text did not visibly re-scale
   live (bounds unchanged). This is expected now that the Activity handles the
   change itself, and it is not a crash.
2. **T2 (delete)**: PASS. Add Record 250.75 / QA-Merchant-01 / QA Test Bank 0002
   → approve → Transactions → detail → **Delete** showed the "Delete
   transaction?" dialog. **Cancel** kept the record. **Delete → DELETE**
   removed it from Transactions, and the account balance was back to ₹5,000.00.
   This was repeated for a second record (QA-Merchant-02): balance went from
   ₹4,749.25 back to ₹5,000.00 after the delete. (A different "QA-Merchant-02"
   row at -₹300 is still in the list. It is Phase 9's B4 record, not one of
   ours.)
3. **T3 (permission denial paths)**: PASS.
   - Residual USER_FIXED state: Sync SMS → "SMS permission blocked" with
     CANCEL / OPEN SETTINGS. OPEN SETTINGS brought `com.android.settings/.spa.SpaActivity`
     to the front. Its content was not read, and BACK returned to Tracker.
   - Reset mechanism used: `adb shell pm clear-permission-flags com.tracker
     android.permission.READ_SMS user-set user-fixed`. It affects only Tracker
     and only this permission. `pm reset-permissions` was deliberately NOT used
     because it resets runtime permissions device-wide.
   - First "Don't allow" → original "SMS permission needed" alert with
     unchanged text.
   - Second "Don't allow" → Android 11+ marks the permission USER_FIXED
     (Android 16 has no explicit checkbox), the request returns
     NEVER_ASK_AGAIN, and the app showed "SMS permission blocked" with
     OPEN SETTINGS.
   - After another flag reset, "Allow" → granted, and sync ran normally (see 7).
4. **T4 (touch targets / gesture zone)**: PASS.
   - Transaction Detail: Edit clickable `[48,2464][618,2608]` (144px = 48dp),
     Delete `[642,2464][1212,2632]` (168px). The bottom edges are 192px and
     168px above the screen bottom. No scroll was needed, because it is a
     sticky footer.
   - Edit opened "Edit Transaction" on the first tap, and Delete opened the
     confirm dialog on the first tap.
   - Pending review sheet, after the §2 fix: Edit 144px and Reject 168px tall,
     bottom edges at 2608/2632. Reject worked on the first tap.
5. **T5 (rounding)**: PASS. A 250.75 record shows `-₹251` in both the Pending
   and Transactions lists, and 99.50 shows `-₹100`. The Pending sheet's
   Approve button also reads ₹251.
6. **T6 (duplicate guard)**: PASS. "qa test bank 0001 " / Bank / 1111 matches
   the existing Phase 9 account case- and whitespace-insensitively, and was
   blocked with the "Account already exists" alert. A new "QA Test Bank 0002" /
   Bank / 2222 / 5000 was created (5 → 6 money sources). Creating it a second
   time was blocked, and the count stayed at 6.
7. **T7 (SBI label)**: PASS. Sync SMS on the real inbox (granted via the real
   dialog) went to "New Accounts Found" with 4 groups: HDFC Credit Card 0197
   (4 msgs), Unknown Bank UPI no-last4 (3), HDFC Bank Account 7302 (1), and
   **SBI Credit Card 5368 (1)**. SBI is now labelled "SBI" instead of
   "Unknown Bank". The remaining "Unknown Bank" group is UPI with no last-4,
   meaning those messages name no bank at all. Counts only; no SMS content
   was read.
8. **Regression B1 → B3 → B9**: PASS. B1: Add Account worked (QA Test Bank
   0002, ₹5,000.00). B3: Add Record 250.75 → Pending → Approve → Transactions,
   and the balance was exactly ₹4,749.25. B9: after force-stop and relaunch,
   the app went straight to Home with no onboarding, and the balance was still
   ₹4,749.25.
9. **Logcat** (whole session, 16,463 lines since `logcat -c`):
   - `FATAL EXCEPTION`: 0
   - `Maximum update depth exceeded`: 0
   - "Screen fragments should never be restored": 0
   - ReactNativeJS errors: 0

## 5. Device state at end

- `font_scale` = 1.0 (verified).
- `com.tracker` force-stopped.
- READ_SMS = granted (normal, user-set). This matches the state the app was in
  before the QA phases.
- Synthetic data left on the device: account "QA Test Bank 0002" (₹5,000.00,
  no transactions) and one rejected "QA-Merchant-03" record. QA-Merchant-01 and
  the new QA-Merchant-02 records were deleted.

## 6. Privacy / isolation notes

- Only `com.tracker`, the permission controller dialog, and (for T3) the
  Settings screen opened by `Linking.openSettings()` were interacted with.
- Before every tap, `topResumedActivity` was checked with a guard script.
- Every `uiautomator dump` was grep-filtered to specific labels, bounds, or
  synthetic-row amounts.
- One incident: midway through, `com.nothing.ntessentialrecorder` (the phone's
  Essential-key recorder, not launched by me) came to the foreground during a
  filtered dump. The filter matched nothing, so no content from it was printed.
  I pressed HOME and relaunched Tracker. After that I added the
  focus-check guard to the dump scripts as well.
- No `tracker.db` access, no `sqlite3`/`run-as`, no screenshots, no uninstall
  or clear-data.
- No real SMS body, sender, merchant, or amount appears in this report. Only
  counts and bank/type/last-4 labels are recorded.
