# R4e — Encrypted backup/restore + "Where it went" donut: report

Executor: Claude subagent. Date: 2026-11-01. Branch: `phase/R4e-backup-pie` (from `phase/R4d-release-apk`). Nothing was committed or staged. The uncommitted R4d changes (`android/app/build.gradle`, `ongoing/roadmap/STATE.md`) were left exactly as they were.

This dispatch was **code + tests + gates only**. There was no device work: no adb at all.

## Summary

- **Gates: all pass.**
  - `npx tsc --noEmit -p tsconfig.json` is clean.
  - `npx eslint src --ext .ts,.tsx` has 0 errors and 2 warnings, both already there (MainTabs, StatTile).
  - `npx jest`: 93 suites, 853 tests, all pass. Baseline was 83 suites and 769 tests, so +10 suites and +84 tests.
  - `./gradlew assembleDebug`: BUILD SUCCESSFUL. This includes react-native-svg autolinking and the new Kotlin module. `assembleRelease` was not run, as instructed.
- **Files: 55 source/test files** (21 modified, 34 new), plus this report.
- **One new dependency:** `react-native-svg` **15.16.0**, pinned exactly with no caret. The owner approved it.
  - It is the current `latest` tag, published 2026-10-15. Its peer dependencies are `react: *` and `react-native: *`.
  - It autolinks, and it built under RN 0.87.1 New Architecture.
  - It renders in jest without a mock.
  - Its transitive JS-only dependencies are css-select, css-tree and friends.
- **No new permission.** The manifest is unchanged, because the Storage Access Framework pickers need none.
- **No migration.** `last_backup_at` lives in `app_settings`.
- **No network calls.**

## Files

**New (34)**

- **Native** (3):
  - `android/app/src/main/java/com/tracker/BackupCrypto.kt`: a pure Kotlin + javax.crypto object (format + crypto).
  - `BackupModule.kt`: the `TrackerBackup` module with SAF, I/O and executor.
  - `BackupPackage.kt`
- **Native JS wrapper:**
  - `src/native/android/backup/backupNative.ts`
  - its test `__tests__/backupNative.test.ts`
- **Domain:**
  - `src/domain/backup/backup.tables.ts`: the table and column catalogue with `sinceVersion`, plus device-local keys.
  - `backup.payload.ts`: the zod payload schema, build, validation, summary, `BackupError` and the file name.
  - `backupPassword.ts`
  - Tests: `__tests__/backup.tables.test.ts`, `backup.payload.test.ts`, `backupPassword.test.ts`.
- **Domain (pie):**
  - `src/domain/insights/pie.rules.ts`
  - `__tests__/pie.rules.test.ts`
- **Data:**
  - `src/data/db/restoreUpgrade.ts`: `CURRENT_SCHEMA_VERSION` and `dataStatementsAfter`.
  - `src/data/repositories/backup.repository.ts`
  - `__tests__/backup.repository.test.ts`
- **Charts:**
  - `src/components/charts/ChartDonut.tsx`
  - `donutGeometry.ts`
  - `__tests__/donutGeometry.test.ts`
- **Insights:**
  - `src/features/insights/components/CategoryDonut.tsx`
  - `__tests__/CategoryDonut.test.tsx`
- **Backup feature:**
  - `src/features/backup/backupService.ts`
  - `backupStore.ts`
  - `reloadAfterRestore.ts`
  - `backupLabels.ts`
  - `screens/BackupScreen.tsx`
  - `screens/RestoreScreen.tsx`
  - `components/PasswordField.tsx`
  - `components/backupScreenStyles.ts`
  - Tests: `__tests__/backupFlow.test.ts`, `__tests__/BackupScreens.test.tsx`.
- **Shared:** `src/shared/state/dataEpoch.ts`
- **Test helpers:**
  - `src/test/sqliteDb.ts`: a real SQLite through Node's built-in `node:sqlite`, behind the op-sqlite `execute`/`transaction` API.
  - `src/test/fixtures/backupRows.fixture.ts`: synthetic QA rows for every table.

**Modified (21)**

- **Root and native:** `package.json`, `package-lock.json`, `MainApplication.kt` (`add(BackupPackage())`).
- **Navigation:**
  - `routes.ts`: `Backup`, `Restore`.
  - `RootNavigator.tsx`
  - `navigationRef.ts`: `resetToHome()`.
- **Audit:**
  - `audit.types.ts`: the `backup_restored` type and its metadata.
  - `audit.rules.ts`: the sanitizer keeps table counts only.
  - `activityFeed.ts`: the sentence and icon.
- **Stores:** `transactionsStore.ts`. `hydrate` = `runMigrations` + the new `reloadFromDatabase`, which also resets filters and the period.
- **Feedback:**
  - `FeedbackWidget.tsx`: the position re-reads when the data epoch changes.
  - `widgetMachine.ts`: the button is hidden on `Backup` and `Restore`.
- **Home + Insights:**
  - `HomeScreen.tsx`: passes all `spendByCategory` rows, plus the two settings callbacks.
  - `WhereItWentCard.tsx`: shows the donut.
  - `insightLabels.ts`: the pie labels.
  - `HomeScreen.period.test.tsx`: the Where-it-went tests rewritten for the donut.
- **Onboarding:**
  - `OnboardingShell.tsx`: optional `footerLink`.
  - `OnboardingScreen.tsx`: the first slide has the "Restore from a backup" link.
- **Settings:** `ProfileSettingsSheet.tsx`, with the "Back up data" row (last backup date) and the "Restore from backup" row.
- **Shared UI:** `dialogStore.ts`. `confirmDialog` gets an optional `destructive`, which gives a red button and no scrim dismissal.
- **Theme:** `colors.ts`, with `chartSeriesColors` and `chartOtherColor` built from existing tokens.

## Part A — Backup / restore

### Native API (`TrackerBackup`, BackupModule.kt)

Restore is **two-step**, so the password is only asked for a file that really is a backup.

| Method | Behaviour |
|---|---|
| `saveBackup(json, password, suggestedName)` | Opens `ACTION_CREATE_DOCUMENT` with type `application/octet-stream` and `EXTRA_TITLE` set to the sanitized name. The name keeps only `[letters digits . - _]`, max 80 characters, and must end in `.trkbak`. On the background executor it then encrypts and writes with `openOutputStream(uri, "wt")`. Resolves `{saved: true, name, bytes}`, or `{saved: false}` on cancel. If the write fails, the half-written document is deleted and the call rejects `E_IO`. |
| `pickBackup()` | Opens `ACTION_OPEN_DOCUMENT` with `*/*`, because `.trkbak` has no MIME type. It reads the 38-byte header and checks the magic and version, and refuses files over 64 MB. Resolves `{uri, name, bytes}` and remembers the uri. Rejects `E_CANCELLED` / `E_NOT_BACKUP` / `E_TOO_NEW`. |
| `decryptBackup(uri, password)` | Only accepts the uri picked last; otherwise it rejects `E_NOT_BACKUP`. Reads the file (max 64 MB), decrypts and resolves the JSON string. Rejects `E_BAD_PASSWORD` ("Wrong password or damaged file", which is the same for a damaged file), `E_TOO_NEW`, `E_NOT_BACKUP` or `E_IO`. |
| `forgetPickedBackup()` | Drops the remembered uri. Called after a restore and when the Restore screen is left. |
| constants | `formatVersion`, `iterations` |

**Threading, privacy and errors**

- Crypto and file I/O run on a single-thread executor, never on the UI thread.
- There is **no logging anywhere**.
- Password char arrays are zeroed after use (in `finally`, and on cancel). The same goes for PBEKeySpec, the derived key bytes and the plaintext bytes.
- The JS string the password came from is immutable. It lives only in screen state and is cleared after success.
- A second picker while one is open rejects `E_BUSY`.
- The JS wrapper maps every rejection to a `BackupError` with a fixed message and drops the native text.

### File format (BackupCrypto.kt; javax.crypto only)

```
offset size  field
0      5     magic "TRKBK"
5      1     format version (1)
6      4     PBKDF2 iterations (big-endian Int) — new files: 600,000
10     16    random salt
26     12    random GCM IV
38     n+16  AES-256-GCM(ciphertext of UTF-8 JSON) + 128-bit tag
```

- The key is `PBKDF2WithHmacSHA256(password, salt, iterations, 256)`.
- The **38-byte header is GCM associated data**, so tampering with the iterations, salt, IV or version fails the tag check exactly like a wrong password does.

**Refusals on read**

| Condition | Result |
|---|---|
| Iterations outside 210,000–5,000,000 | NotBackup (the cap stops a crafted header from making the phone hash for minutes) |
| Version above 1 | TooNew |
| Bad magic, or a file that is too short | NotBackup |

**JVM check.** JVM unit tests are not wired in this project (no `android/app/src/test`, no junit on the classpath), so the crypto is a separate pure Kotlin object. It was still verified once, off-device, against the **compiled** `BackupCrypto.class` from this build. A throwaway javac harness in the scratchpad ran it with JDK 17 + kotlin-stdlib. It is not in the repo and no dependency was added. All of these passed:

- round trip
- wrong password → BadPassword
- damaged body → BadPassword
- damaged header salt → BadPassword
- bad magic → NotBackup
- version 2 → TooNew
- absurd iterations → NotBackup
- truncated → NotBackup
- header version + iterations as written

Node's `crypto` (pbkdf2 + aes-256-gcm + AAD) also decrypted that Kotlin-made file independently, so the layout above is exact.

On a desktop JVM, 600k iterations took about 0.8 s. A phone will take longer; the UI shows a spinner on the button.

### JS payload (`backup.payload.ts`, zod)

```
{ format: 1, app: {versionName, versionCode}, schemaVersion: 7,
  createdAt: ISO, tables: { <table>: rows[] } }
```

- `app` comes from the existing `TrackerFeedback` constants.
- `schemaVersion` = `CURRENT_SCHEMA_VERSION`, the highest numbered migration, which is 7.
- **How it is read:** `backupRepository.readAllTables` runs `SELECT * FROM <t> ORDER BY rowid` for every table inside **one** `db.transaction`, so it is a consistent snapshot.
- **Why rowid order:** a restore re-inserts in the same order, and the Activity feed's tie-breaker (audit `rowid`) survives. This is tested.
- **No raw SMS bodies** are exported, because none are stored. Only what the DB holds goes out, including `sanitized_preview`, as the DB already has it.

### Tables exported (11)

| Table | Since schema |
|---|---|
| `categories` | base (columns `archived_at`, `color`: 5) |
| `accounts` | base (`balance_anchor_minor`, `balance_anchor_at`, `deleted_at`: 1) |
| `transactions` | base (`bulk_batch_id`: 1; `transfer_account_id`, `linked_transaction_id`, `link_kind`: 6) |
| `audit_events` | base (`account_id`: 4) — the Activity history |
| `app_settings` | base — minus device-local `last_backup_at` |
| `merchant_rules` | 5 |
| `account_suggestion_decisions` | base |
| `account_suggestion_candidates` | base |
| `sms_sync_runs` | base |
| `transfer_pair_dismissals` | 6 |
| `duplicate_pair_dismissals` | 7 |

- Not exported: `schema_migrations`, which is the DB's own bookkeeping. The backup records `schemaVersion` instead.
- `backup.tables.test.ts` builds the real schema at **every** version 0–7 in SQLite. It fails if any table or column is missing from the catalogue or wrongly versioned, so a future migration cannot be forgotten.

### Validation (`parseBackupJson`)

| Problem | Code | Message |
|---|---|---|
| Not JSON or not an object | not_backup | "This file is not a Tracker backup, or it is damaged." |
| Wrong shape | not_backup | same |
| `format` is not 1 (e.g. 0) | not_backup | same |
| Bad `createdAt`, or a non-scalar cell | not_backup | same |
| `format` > 1 | too_new | "Backup is from a newer app — update Tracker first." |
| `schemaVersion` > current | too_new | same |
| A table that existed at the backup's schema is missing | incomplete | — |
| An unknown table | not_backup | — |
| An unknown column, or a column newer than the backup's schema | not_backup | — |

**Table and column names are never taken from the file.** Inserts use only catalogue names, and every value is a bound parameter. A crafted column name such as `name) VALUES…; DROP…` is rejected by validation (tested), and the insert also filters to catalogue columns.

### Restore rules (`backupRepository.replaceAllData`, one `db.transaction`)

1. Read this phone's device-local settings (`last_backup_at`).
2. `DELETE FROM` every backup table, children first.
3. Insert the backup rows, parents first, in the file's order. Device-local keys in the file are skipped.
4. **Older schema** (the "mapping" approach, documented in `restoreUpgrade.ts`):
   - The live DB is already at schema 7, so only the **data** half of every migration newer than the backup is replayed. That means the non-`ALTER`/`CREATE`/`DROP` statements: migration 3's confidence ×100, migration 5's Uncategorised seed and migration 6's Transfer seed.
   - Columns that are missing stay NULL or their default, just as after `ADD COLUMN`.
   - **Tested for every version 0→7 (including N-1 → N):** "restore old rows + replay" equals "old DB + the real numbered migrations", row for row, on real SQLite.
   - Rule for future migrations: keep data steps replay-safe. The test will catch a violation.
5. Put the device-local settings back.
6. Set `has_onboarded = 'true'` with INSERT OR IGNORE + UPDATE, so the rowid order is kept.
7. Write one audit row `backup_restored` (actor `user`) whose metadata is `{counts: {<table>: n}}` and nothing else. The sanitizer also keeps only integer counts under table-like keys.

Any failure rolls the whole transaction back. This is tested by a NOT NULL violation in the middle of the inserts: the DB is identical afterwards, the stores are not reloaded, and the message is "The backup could not be restored. Your data was not changed."

**After success** (`reloadAfterRestore`):

- Suggestion session cleared.
- Tour stopped.
- `transactionsStore.reloadFromDatabase()`: rows, accounts, categories, rules, dismissals, profile/approval settings, **SMS sync start + cursor**; filters and the period are reset.
- Data epoch bumped, so the feedback button re-reads its saved position.
- The tour launch rule runs on the restored `tour_completed_at`.
- Last-backup date re-read.
- Then `resetToHome()` (a fresh stack with Tabs → Home) and the Snackbar "Backup restored".

**SMS sync settings from another phone are kept as backed up** (start mode/date and `sms_last_synced_at`). Doubles are prevented by `source_reference_hash` dedup plus its unique index.

- **Caveat:** on a *different* phone the SMS row ids differ. Messages that exist on both phones are therefore not recognised as the same, but the cursor means only SMS newer than `sms_last_synced_at − 1 day` are scanned.

A restore is refused while an SMS sync is running ("Wait for the SMS sync to finish, then try again.").

### UI

**Settings sheet** (Home → greeting):

- **"Back up data"**, with the caption "Last backup: 30 Oct 2026" or "No backup saved on this phone yet".
- **"Restore from backup"**, with the caption "Replace all data with a backup file".
- Both rows are 56 dp and labelled. They sit above the SMS sync start row.

**Back up data screen:**

- An intro line.
- The last backup date.
- Password + Confirm fields.
  - Both are `secureTextEntry`, with `autoComplete="off"`, `importantForAutofill="no"`, no autocorrect or spellcheck, and accessibility labels.
  - One Show/Hide 48 dp toggle switches both fields.
- Inline errors: "Use at least 8 characters." / "Passwords don't match."
- The warning "If you forget this password the backup can't be opened."
- **[Save backup file]**. It is disabled until the input is valid and shows a spinner while saving. It opens the SAF picker with `tracker-backup-YYYY-MM-DD.trkbak`.
- After a save: Snackbar "Backup saved", fields cleared, back.
- A cancelled picker does nothing. An error shows a fixed message.

**Restore screen:**

- The warning "Restoring replaces everything in Tracker on this phone with the backup. This can't be undone."
- **[Choose backup file]**. Then the file name, the password field and **[Restore]**, plus "Choose a different file".
- Restore leads to a destructive confirm Dialog: "Replace all data in Tracker with this backup (1 Nov 2026, 4 transactions, 2 accounts)?" with [Cancel] / [Replace all data].
- Then the restore, Home, and "Backup restored".
- Errors show inline as fixed text: wrong password, not a backup, newer app.
- Leaving the screen forgets the picked file.
- Counts are **all rows**: every transaction (incl. rejected twins and hidden duplicates) and every account (incl. removed ones).

**Onboarding, first slide:**

- A "Restore from a backup" link (48 dp, button role) under the CTA. It opens Restore.
- After a successful restore, the stack is reset to Home, so onboarding is complete because the backup carries `has_onboarded` and the profile.
- The tour is not shown when the backup has a `tour_completed_at` date.

**Feedback button:** hidden on Backup and Restore, so password screens are never captured.

## Part B — "Where it went" donut

**Pie math (`domain/insights/pie.rules.ts`, pure):**

- **Slices:** only categories with spend > 0 get a slice. They are sorted largest first, with ties by id.
- **Other:** a category under **3 %**, or beyond the first **6**, folds into **"Other"**, which goes last.
  - When exactly one category would fold, it is shown as itself, the same rule as `topCategories`. So there are at most 7 slices.
- **Percents:** whole percents use the largest-remainder method and **always sum to 100**. This is checked on many random sets.
- **Angles:** degrees, clockwise from 12 o'clock. They tile 0→360 exactly. One category is the full ring. A zero total gives no slices.

**Rendering:**

- **`ChartDonut`** (`components/charts`) uses react-native-svg: one stroked arc per slice, a 2° gap (never more than ¼ of a sliver), and a full `Circle` for a single slice. Each slice is tappable. Geometry is in `donutGeometry.ts` (pure, tested).
- **`CategoryDonut`** shows:
  - centre: the total spent (`AmountText`) + "spent"
  - legend rows (48 dp): colour dot, category name, %, amount (`AmountText`)
- **`ChartBars` is unchanged** (Trends, and the Insights category list).

**Behaviour:**

- **Tapping** a slice **or** its legend row does what the bars did: a category → Transactions filtered to it (the period is unchanged), and "Other" → Insights.
- **Colours:** by rank, from existing tokens: primary, tertiaryContainer, primaryContainer, error, onTertiaryContainer, secondary, tertiaryFixedDim. "Other" uses outlineVariant.
  - Neighbours around the ring differ.
  - They were checked on the light cards only. There is no dark theme yet; see decisions.
- **Accessibility:**
  - The ring is one element with the summary "Spending by category, ₹500 in total: QA Food 60%, QA Shopping 40%".
  - Each legend row reads "QA Food, 60%, ₹300".
  - A sliver reads "<1%".
- **REDACTED:** the centre and every legend amount show `₹ ••••`, and the a11y labels are masked too (tested).
- **Empty state:** unchanged ("No spending this month.").

**Tour (B5 check):**

- Step 3 still targets `home.periods`. `useTourTarget('home.periods')` sits on the period chips in HomeScreen, and the tour model is untouched. The tour tests pass.

## Tests added (+84, 10 new suites, Home test updated)

| Suite | Covers |
|---|---|
| `backup.repository.test.ts` (real SQLite) | one-transaction export; JSON round trip → **identical rows for all 11 tables**; device-local key kept; `has_onboarded`; one `backup_restored` row with counts only, as the last row; **mid-way failure rolls back**; data-step filter; **older-schema restore 0..6 → 7 equals the real migrations**; N-1 → N with the newest table absent |
| `backup.tables.test.ts` | the catalogue equals the real schema at versions 0–7; parent/child order |
| `backup.payload.test.ts` | build (every table, device-local stripped), round trip, not_backup cases, too_new (format and schema), missing table → incomplete (and not at an older schema), unknown table/column/injection/newer column, summary, file name, data-free messages |
| `backupPassword.test.ts` | min 8, confirm match, max 128, restore accepts non-empty |
| `backupFlow.test.ts` (real SQLite, native mocked) | save (all tables, password + name passed through, `last_backup_at`), save cancel, short password refused; restore **reloads every store** (rows, accounts, settings, sync start/cursor, rules, filters/period, session, tour, epoch), device-local kept, audit counts only; **onboarding path: setup completes, tour not shown**; tour owed / missing rule; rollback leaves data and stores unchanged; wrong password / too new / not JSON; busy while syncing; **console spies: no password or JSON logged; audit has no password** |
| `BackupScreens.test.tsx` | secure fields, no autofill, labels; disabled until valid; error texts; Show/Hide; save → snackbar + back; cancel; error message; last date; restore pick → password → destructive confirm text → restore → snackbar + `resetToHome`; confirm Cancel; cancelled pick; not-a-backup and wrong-password messages; unmount forgets the file; sync running disables the picker; onboarding link → Restore; settings rows + last date |
| `backupNative.test.ts` | pass-through; every native code → BackupError with the native text dropped; missing module; audit sanitizer (counts only); Activity sentence |
| `pie.rules.test.ts` | constants, zero total, single = full ring, sort + negatives, **sum 100** (incl. random sets), 3 % merge, max 6 + Other, single-fold shown, angles tile, `roundPercents` |
| `donutGeometry.test.ts` | polar convention, arc flags, the gap clamp |
| `CategoryDonut.test.tsx` | legend labels + centre; rank colours (distinct) + Other; single = Circle; slice / legend / Other taps; **REDACTED masks the centre + legend amounts** and restores them; card empty state + Other → See all |
| `HomeScreen.period.test.tsx` (updated) | legend labels, donut summary, centre = EXPENSES tile; **legend tap and slice tap → the same filtered Transactions navigation as before**; See all → Insights |

The real-SQLite suites need Node ≥ 22.13 (`node:sqlite`); this machine runs Node 24. On an older Node they `describe.skip` instead of failing.

## Decisions I made

1. **Two-step native restore:** `pickBackup` then `decryptBackup(uri, password)`. The header is checked before the password is asked, and `decryptBackup` only accepts the uri picked last.
2. **600,000 PBKDF2 iterations** for new files, above the required minimum of 210,000. The count is in the header. Reading accepts 210k–5M.
3. **The header is GCM associated data**, so header tampering surfaces as "Wrong password or damaged file".
4. **64 MB cap** on backup files; anything larger is refused as "not a backup".
5. **Older-schema restore by mapping:** replay the data steps of newer migrations. It is verified equal to the real migrations for every version 0–6 → 7.
6. **`last_backup_at` is device-local:** it is not exported, and a restore keeps this phone's value.
7. **A restore always leaves `has_onboarded = 'true'`**, because a backup can only be made after setup.
8. **Tour after a restore:** a date means not shown; `''` (owed) means requested; a missing key means marked done silently (the upgrade rule).
9. **Filters and the selected period reset** after a restore, since they may name ids that no longer exist. The in-memory "New accounts found" session is cleared too.
10. **Restore and pick are refused while an SMS sync runs.**
11. **The feedback button is hidden on Backup and Restore.**
12. **`confirmDialog` gained `destructive`.** The restore confirm is red and cannot be dismissed with a scrim tap.
13. **Restore confirm counts = all rows** in `transactions` and `accounts` (incl. hidden twins/duplicates and removed accounts).
14. **The donut is on the Home card only.** The Insights screen keeps its full category bars, because it does not use the card.
15. **The donut centre = the sum of positive category spends.** It equals the EXPENSES tile unless refunds exceed a category's spend in the period; then that category has no slice and the centre is the ring's total.
16. **Slice colours by rank** from existing tokens, not per category. The built-in category colours collide (Shopping and Transport are both `onSurfaceVariant`), and the prompt asked for distinct slices. The legend dot shows the mapping.
17. **"Other" is always the last slice.** When exactly one category would fold, it is shown by name instead.
18. **Data epoch store** (`shared/state/dataEpoch.ts`) lets the feedback widget re-read its position without a restart.

## Not verified (needs the device pass)

- The SAF save and open pickers on the real phone: Downloads, Drive.
- `openOutputStream(uri, "wt")` on Drive.
- PBKDF2 time on the phone.
- The donut rendering, the gap look, slice tap hit areas and the legend layout at 1M–1Y.
- Light/dark readability. There is no dark theme yet (R12).
- TalkBack reading the ring summary and the legend rows.

## DEVICE PLAN (for later; not run)

Rules: only `com.tracker`, with the foreground check `adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` (both must show com.tracker) before every tap or dump, and an abort if it fails. UI dumps are grep-filtered to `bounds`, `content-desc`, `resource-id` and `text` of the named element only. No screenshots. No db access. No owner settings changed.

**Backup rules for the agent:**

- **The owner's backup is done by the owner, by hand.** The device agent never types a password into a backup on the owner's phone and never opens the backup file. It never restores on the owner's phone, never pulls or lists files in Downloads/Drive, and never interacts with the system file picker beyond pressing Back to cancel it.

**Agent checks:**

1. **Install and launch.** Install the debug-signed build for the owner's phone with `assembleRelease -PtrackerDebugSigning`, using `install -r`. Launch it and run the foreground check.
2. **Pie renders.**
   - On Home, grep `content-desc="Spending by category` for a count of 1 hit, plus its bounds. Expect it roughly square, about 176 dp.
   - Grep the `where-it-went-legend-` resource-ids for the **count only**.
   - Do **not** print the legend content-desc, because it contains category names and amounts.
3. **Legend tap.**
   - Tap the first legend row's bounds. Expect the Transactions tab to be in front with the category chip active: grep `text="Reset"` or the category chip resource-id (count only).
   - Press Back.
4. **Slice tap.** Tap a point on the ring, `(centre.x, top + 13 dp)`, which is the first slice. Expect the same result as the legend tap. Press Back.
5. **Periods.** Tap the 3M / 1Y chips. Expect the donut to still be present (count 1) and the empty state to be absent, unless the period has no spend.
6. **Backup screen renders and validates.**
   - Home → greeting → settings sheet. Grep `text="Back up data"` and the `settings-last-backup` text. The text shows a date or "No backup saved…" and is fine to print.
   - Tap the row. Then:
     - type `abc` in the first field (synthetic, not a real password) and expect `text="Use at least 8 characters."`
     - type `QA-test-pass1` + `QA-test-pass2` and expect `text="Passwords don't match."`
     - check that `backup-save` is `enabled="false"`
   - Tap Show and check that `password="false"` on the fields.
   - **Do not tap Save.** Press Back.
7. **Restore screen renders; the cancel path works.**
   - Settings → "Restore from backup". Grep the warning text (count) and `restore-pick`.
   - Tap **Choose backup file**. As soon as the foreground check shows the system picker (`com.google.android.documentsui` / `com.android.documentsui`), **press Back immediately without dumping**.
   - Expect Tracker in front again, with no error box (`restore-error` count 0).
   - Press Back to Home.
8. **The feedback button** is absent on the Backup and Restore screens (`content-desc="Send feedback"` count 0).
9. **Onboarding link.** This is only checkable on a fresh install, so do it on a **test device or emulator only, never on the owner's phone**: grep `text="Restore from a backup"` on the first slide.
10. **Logcat.** `logcat -d --pid=$(pidof com.tracker)`, counting FATAL / AndroidRuntime only.
11. **Cleanup.** Nothing was saved or restored, so there is nothing to clean.

**Owner's move to the release-signed build** (by hand, owner only):

1. Back up data, choose a password and save to Downloads or Drive.
2. Uninstall the debug-signed app.
3. Install the tester APK.
4. On onboarding, choose "Restore from a backup", pick the file, enter the password and confirm.
5. The app lands on Home with all data, and the tour is not shown.

## Leak scan

The dispatch's pattern was run in the shell against this report and against all new and changed source/test files: 0 hits. None of the new code contains a `console.*` call or Android `Log.*`. All fixture data is synthetic: "QA-Merchant-…", "QA Bank", "QA Wallet", "qa-secret-password-77".
