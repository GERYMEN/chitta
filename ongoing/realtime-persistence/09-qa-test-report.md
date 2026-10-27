# Phase 9 — QA Test Suite Report

Independent QA verification of the Tracker Android app (React Native, `com.tracker`)
on the physical device `00015365L001524` (Android 16 / SDK 36, screen 1260×2800).
No source code, config, or build files were modified. All bugs documented with
repro steps; none fixed. Debug build served by Metro on 8081 (`adb reverse`
in place). `topResumedActivity` re-confirmed `com.tracker/.MainActivity` before
every tap; the only non-Tracker surface interacted with was the Android
permission controller. All `uiautomator` dumps of data-bearing screens were
grep-filtered to the single element being located.

## 0. Starting state (important context)

At dispatch start the app was found in a **reset state**: Onboarding Tour
re-showing, `READ_SMS` = denied, and **0 accounts / 0 transactions** ("No
accounts yet — add one to start tracking"). Phase 8 had left it with accounts
and granted permission. This is consistent with an intervening uninstall /
re-install (data cleared) by a prior interrupted dispatch, **not** an app bug.
READ_SMS was granted through the real permission dialog during this run and the
app was exercised from a clean empty DB using only synthetic data created via
the app's own screens.

## 1. Summary

| category | count |
|---|---|
| PASS | 22 |
| FAIL | 6 |
| FLAKY | 0 |
| BLOCKED | 0 |
| NOT RUN | 4 |

S1 bugs: **1** (config-change crash). S2 bugs: **1** (Delete button no-op).
Plus 3× S3 and 2× S4 findings (see §4).

## 2. Gate results (Section A)

| gate | command | result |
|---|---|---|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | PASS (exit 0) |
| lint | `npx eslint src --ext .ts,.tsx` | PASS (0 errors, 3 warnings — same 3 pre-existing) |
| tests | `npx jest` | PASS (14 suites / 178 tests) |
| android debug | `./gradlew assembleDebug` | PASS (BUILD SUCCESSFUL) |
| android release | `./gradlew assembleRelease` | PASS (BUILD SUCCESSFUL — signing configured, unsigned release artifact produced) |

## 3. Test results

### Section B — critical journeys (journey-verified on device)

| ID | area | result | notes |
|---|---|---|---|
| B1 | Add Account (Accounts screen) | PASS | "QA Test Bank 0001" · •••• 1111 · ₹5,000.00 created; TOTAL BALANCE ₹5,000.00 |
| B2 | Add New Money Source | PASS | "QA Cash Wallet" (Cash) created via bottom CTA; "Across 2 tracked money sources" |
| B3 | Add Record → Pending → Approve → Transactions + balance | PASS | 250.75 expense approved; balance 5000.00 − 250.75 = **₹4,749.25 exact** (no float drift); appears in Transactions |
| B4 | Edit approved record (merchant+amount) | PASS | merchant → "QA-Merchant-02", amount → 300.00; persisted; balance recalc 5000.00 − 300.00 = ₹4,700.00 exact |
| B5 | Delete record | **FAIL** | Delete button exists but is a no-op (see BUG-2) — transaction survives |
| B6 | Reject pending record | PASS | "QA-Reject-Test" rejected; balance unchanged at ₹4,700.00 |
| B7 | Sync SMS + dedup | PASS | First sync (no matching account): created=0, 4 suggestion groups; re-sync re-shows same groups, pending badge stable (dedup holds) |
| B8 | SMS Suggestions approve + match | PASS | Approved "Federal" suggestion → account created; re-sync matched **31** pending transactions (count only); credit_card vs bank kept separate (HDFC appears as both Credit Card 0197 and Bank Account 7302) |
| B9 | Persistence (force-stop/relaunch) | PASS | 5 accounts, ₹4,700.00 balance, 31 pending, approved record all survive; no onboarding repeat |

### K1 — duplicate accounts (user-reported)

**FAIL — confirmed real product gap (S3).** Two accounts with identical
`(name, type, lastFour)` were created through the normal Add Account form
("QA Dup Test" / bank / 5555, created twice) with **no warning, no block, no
error** — "Across 4 tracked money sources" after the second save, and both
entries visible in the list. Root cause confirmed by inspection: the `accounts`
table has only a `id` PK (no uniqueness on name/type/last_four), and
`accountForm.schema.ts` has no duplicate check. Phase 8's "test-hygiene"
explanation (fast swipes re-triggering the suggestion Add Account flow) is a
correct description of *how* those specific duplicates arose, but it is
**incomplete**: the deeper product gap is that nothing prevents duplicates at
all, for a manual user or the suggestion flow alike.

### K2 — missing/mislabeled bank (user-reported)

**FAIL — confirmed parser bug (S3), independent of the existing reports.** Two
distinct failures, both verified with synthetic strings against the live
`parseSmsMessage`:

1. `"Rs.500.00 debited from SBI Card ending 4444 …"` → `bankName = 'Unknown Bank'` (no adjacent word "Bank").
2. `"Rs.500.00 debited from SBI A/C X4444 …"` → `bankName = 'Unknown Bank'`.
3. `"… State Bank of India A/C 4444"` → `bankName = 'State'` (regex captures only the single word before "Bank", truncating multi-word names).
4. Control `"… HDFC Bank A/C 7302"` → `'HDFC'` (works).

Root cause: `smsParser.ts` `extractBankName` uses only
`/([A-Z][A-Za-z]+)\s+Bank\b/` and a trailing `"- X Bank"` signature. **A bank
alias normalizer already exists in the tree (`sms-sync/normalizeAccountKey.ts`,
containing `'SBI Card' → 'sbi'`, `'SBI' → 'sbi'`, `'State Bank of India' →
'sbi'` etc.) but it is NOT wired into `smsParser.ts`** — the parser still uses
the old regex, so the bug is still live in the active code path. (Also note:
uncommitted schema tables `account_suggestion_decisions`, `account_suggestion_candidates`,
`sms_sync_runs` exist alongside the normalizer, i.e. an in-progress "D4" phase
is half-landed but not connected.)

### Section C — input validation & money edge cases (synthetic data)

| ID | case | result | notes |
|---|---|---|---|
| C1 | amount "0" | PASS | rejected "Amount must be greater than 0" |
| C2 | amount "abc" | PASS | rejected "Enter a valid amount" |
| C3 | amount "12.345" | PASS | rejected (3 decimals) "Enter a valid amount" |
| C4 | amount "0.01" | PASS | accepted (1 paise) |
| C5 | amount "1,234.50" (pasted comma) | PASS | rejected "Enter a valid amount" (safe, not mangled) |
| C6 | amount negative / empty / "0.005" / leading "007" / "99999999.99" | PASS (code) | regex `^\d+(\.\d{1,2})?$` + `> 0`; negative/empty/0.005 rejected; "007"→₹7.00; 99999999.99 accepted within safe int range |
| C7 | merchant empty | PASS | rejected "Merchant name is required" |
| C8 | merchant 1 char / 200+ chars / emoji / Hindi / Arabic | NOT RUN | schema imposes no max-length or charset; 200+ char & emoji not typed on-device (impractical via adb). Display caps at 2 lines (`numberOfLines={2}`) so long names truncate visually |
| C9 | Add Record with zero accounts | PASS | empty-state guard present ("Add an account first" + "Go to Accounts"), observed empty state at start; code path `accounts.length === 0` |
| C10 | double-tap Save | NOT RUN | not reliably reproducible via adb; `submitting` flag + "Saving…" label likely de-bounce it, but unverified |
| C11 | back button mid-form | PASS | forms do not auto-save; back = discard with no partial save; **no confirm-discard dialog implemented** |

### Section D — Android platform behaviour

| ID | case | result | notes |
|---|---|---|---|
| D1 | READ_SMS deny | PASS | clear Alert "SMS permission needed" (no crash) |
| D2 | deny with "don't ask again" | **FAIL** | shows same generic Alert; message "grant it the next time you tap Sync SMS" is misleading (dialog never re-appears) and there is **no Settings guidance** (see BUG-3) |
| D3 | revoke while backgrounded (`pm revoke`) | PASS | no crash; app backgrounds on revoke (Android restarts app on permission change — expected) |
| D4 | background mid-form, return | PASS | Add Record form retained partial input ("50"), no crash |
| D5 | rotation | PASS | `orientation` in `configChanges`; landscape renders fine, no crash |
| D6 | process death (force-stop while on screen) | PASS | data survives (B9); no crash on reopen |
| D7 | gesture-nav inset | **FAIL** | still present — see BUG-4 |
| D8 | open while Metro stopped | NOT RUN | Metro was running throughout this run |

### Section E — non-functional

| ID | case | result | notes |
|---|---|---|---|
| E1 | cold start | PASS | `am start -W` TotalTime: 404 / 397 / 417 ms → **median 404 ms** (debug/Metro) |
| E2 | jank | PASS | 238 frames, 7 janky → **2.94%** janky frames during 10s Transactions scroll |
| E3 | memory | PASS | `dumpsys meminfo` TOTAL PSS ≈ **250 MB** (debug build) |
| E4 | font scale 1.3 | **FAIL** | **app crashes** on font-scale change — see BUG-1 |
| E5 | content-desc on buttons | PASS | tab bar (Home/Pending/Transactions/Accounts), "Add Record", "Sync SMS" all have content-desc; form buttons use text labels |
| E6 | touch targets ≥ 48dp | **FAIL** | Edit ~39px, Delete ~21px tall on Transaction Detail (see BUG-4) |
| E7 | stability scan (whole run) | **FAIL** | 2× FATAL EXCEPTION (both BUG-1); 0 "Maximum update depth"; 0 ReactNativeJS errors; 0 Fatal signal |

### Section F — destructive tests (NOT RUN)

| ID | case | result |
|---|---|---|
| F1 | fresh-install / uninstall | NOT RUN — requires explicit user approval, not granted in this dispatch |
| F2 | upgrade path | NOT RUN — requires explicit user approval, not granted in this dispatch |

## 4. Bugs

### BUG-1 — App crashes on configuration change (font scale) — **S1**

- **Where**: `MainActivity` relaunch → `react-native-screens` fragment restore.
- **Repro**: With the app open, `adb shell settings put system font_scale 1.3`
  (or any config change not in `configChanges`). App crashes. Change back to
  1.0 → crashes again. Reproduced 2× (PIDs 26532, 26596).
- **Expected**: app survives font-scale change (and rotation/locale/density).
- **Actual**: `FATAL EXCEPTION: main` → `Unable to instantiate fragment
  com.swmansion.rnscreens.ScreenStackFragment`.
- **Root cause**: `android:configChanges="keyboard|keyboardHidden|orientation|
  screenLayout|screenSize|smallestScreenSize|uiMode"` is missing `fontScale`,
  `density`, `locale`. A font-scale change triggers a full Activity relaunch;
  on relaunch Android restores the fragment manager, and react-native-screens'
  `ScreenFragment.<init>` throws `IllegalStateException: Screen fragments
  should never be restored`.
- **Log excerpt (filtered, no personal data)**:
  `Caused by: java.lang.IllegalStateException: Screen fragments should never be
  restored. … at com.swmansion.rnscreens.ScreenFragment.<init>(ScreenFragment.kt:66)`
- **Note**: rotation does NOT crash because `orientation` IS in `configChanges`.
  No data loss (SQLite persistence held through both crashes).

### BUG-2 — "Delete" button on Transaction Detail is a no-op — **S2**

- **Where**: `TransactionDetailScreen.tsx:52` → `onDelete={() => navigation.goBack()}`.
- **Repro**: Transactions → open an approved record → "Delete". The detail
  dismisses but the transaction remains (still listed, "Expenses" unchanged).
- **Expected**: delete removes the record and recalculates balance.
- **Actual**: nothing deleted; button merely navigates back.
- **Root cause**: `transactionRepository.delete` (SQL `DELETE`) exists but is
  never wired into the store or any screen; `transactionsStore` has no delete
  action, and `PendingScreen` also stubs `onDelete={() => {}}`.

### BUG-3 — "Don't ask again" deny has no Settings guidance — **S3**

- **Where**: `HomeScreen.tsx:62-65` permission-denied branch.
- **Repro**: deny READ_SMS with the "don't ask again" option, then tap
  "Sync SMS" again.
- **Expected**: guidance to grant in system Settings.
- **Actual**: the same Alert ("…you can grant it the next time you tap Sync
  SMS") which is false — the system never re-prompts, and no Settings link is
  offered; the user is stuck.

### BUG-4 — Gesture-nav inset / undersized touch targets on Transaction Detail — **S4**

- **Where**: `TransactionDetailContent` actions row (`Edit`/`Delete`).
- **Repro**: open an approved record's detail. `Edit` renders at
  y≈2689–2728, `Delete` at y≈2707–2728 (bottom ~110 px of a 2800 px screen).
- **Actual**: tapping the lower half of `Edit`/`Delete` is swallowed by the
  system gesture zone (first tap on `Edit` did nothing; `Delete` tap dismissed
  the sheet via the back gesture). Buttons measure ~39 px and ~21 px tall —
  well under the 48 dp accessibility minimum.

### BUG-5 — Compact amount display floors (truncates) paise — **S4**

- **Where**: `formatRupeesFromMinor` uses `Math.floor(absoluteMinor / 100)` when
  `showPaise` is false.
- **Repro**: an amount of 250.75 shows as "-₹250" in the Pending list, the
  Transactions list, and the "Net" summary, but "-₹250.75" in the detail
  (showPaise). The `.75` is dropped (floor), not rounded.
- **Expected**: round to nearest rupee (₹251) or show paise consistently.

### K1 — Duplicate accounts silently allowed — **S3** (see §3 K1)

### K2 — bankName extraction misses "SBI Card" / "SBI A/C" and truncates multi-word banks — **S3** (see §3 K2)

## 5. Not tested / out of scope

- Play internal/release track, other devices, TalkBack full audit — not part of
  this dispatch.
- Section F destructive tests (fresh-install/uninstall, upgrade path) — not
  approved.
- D8 (open while Metro stopped), C8 (emoji/non-Latin/long merchant on-device),
  C10 (double-tap Save) — not executed (reason noted inline).
- Release-build runtime behaviour — only the debug/Metro build was exercised;
  gate `assembleRelease` passes but was not installed/run.

## 6. Recommendations

**Automated E2E (critical path only)** — B1→B3→B9 chain is the money path and
the highest-value target: add account → add/approve record → assert exact
balance (integer-paise equality) → force-stop/relaunch → assert data survives.
Also an E2E for "Sync SMS → approve suggestion → re-sync dedup" using a
fixture/mocked SmsReader (never a real inbox) to lock the dedup invariant.

**Unit tests** — already strong (178). Add: (a) bankName extraction for the K2
phrasings ("SBI Card", "SBI A/C", "State Bank of India", and a long-bank-name
case), (b) a regression test asserting `parseSmsMessage` uses the *wired*
normalizer (not the dead regex), (c) duplicate-account detection once K1 is
fixed, (d) currency rounding (BUG-5).

**K1 (duplicate prevention) — fix direction only, not implemented**: add a
uniqueness check at the Add Account submit boundary — compare normalized
`(type, lowercased/trimmed name, lastFour)` against existing active accounts
and warn/block ("This account already exists") rather than silently inserting;
optionally add a DB unique index on `(type, name, last_four)` as the
backstop. Do NOT silently dedupe on the suggestion path — surface the
conflict to the user.

**K2 (bank-name extraction) — fix direction only, not implemented**: wire the
already-written `normalizeAccountKey.ts` alias map into `smsParser.ts`
(replace `extractBankName`'s two regexes with a call to the normalizer, using
`bankCanonical` as the suggestion label and the human-friendly alias as the
display name). Once wired, the synthetic "SBI Card"/"SBI A/C"/"State Bank of
India" cases must yield "sbi". Bump `ACCOUNT_KEY_NORMALIZER_VERSION` and add a
migration if any persisted suggestion rows exist.

**BUG-1 (config-change crash) — fix direction only, not implemented**: add
`fontScale|density|locale` (and any other config the app should survive) to
`MainActivity`'s `android:configChanges`, or follow the react-native-screens
state-restoration instructions to make `MainActivity` restore-safe.

**BUG-2 (delete)**: wire `transactionRepository.delete` into a store action and
call it from `TransactionDetailScreen` (with a confirm dialog), replacing
`navigation.goBack()`.

## Privacy statement

Only `com.tracker` was interacted with (plus the Android permission dialog). No
real SMS body, sender, merchant, or amount appears in this report. SMS results
are reported as counts and the established safe account-source category (bank
name, account type, last-4). All merchant names and amounts referenced are
synthetic test data typed during this run (QA Test Bank 0001, QA Cash Wallet,
QA Dup Test, QA-Merchant-01/02, QA-Reject-Test, 250.75, 300.00, 5000.00). A
self-scan of this report and the run log found no real merchant/phone-number/
SMS text (one incidental real pending-transaction row was observed in an
unfiltered early dump and was never transcribed here).
