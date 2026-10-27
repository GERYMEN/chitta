# Task: Replace mock/fixture data with real SQLite persistence + wire up dead buttons

User's exact complaint: "Add Record" (Home), "Sync SMS" (Home), "Edit" (Transaction
Detail), "Add Account" and "Add New Money Source" (Accounts) are all no-ops
(`onPress={() => {}}`). User wants real functionality, real on-device SQLite
persistence instead of the in-memory Zustand store seeded from
`src/test/fixtures/*`, and explicitly asked this be done via the
orchestrator-executor method (this file + dispatched `opencode run` phases).

## Ground facts (already verified — do not re-derive)

- Project root: `/Users/mohammedsiraj/Downloads/projects/experiment/Tracker`
- Not a git repo at the project root level beyond what `npx react-native init`
  auto-created; no branches, work directly in the tree.
- Android SDK/JDK setup (from the earlier `android-build-green` task, still
  valid, do not redo):
  - `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`
    (export this plus `PATH=$JAVA_HOME/bin:$PATH` before any `./gradlew` call)
  - `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`
    (`android/local.properties` already points `sdk.dir` here)
  - Installed: platform-tools, platforms;android-37.0, build-tools;37.0.0,
    ndk;27.1.12297006 — matches `android/build.gradle`. Do not change these
    version pins.
- A **physical Android device is connected via USB** (`adb devices` should
  show one entry, state `device`). This is the **user's personal daily-driver
  phone** — real WhatsApp, Instagram, real SMS inbox, etc. are on it.
  - **CRITICAL PRIVACY RULE**: later phases of this task add a feature that
    reads the device's real SMS inbox. When that lands and gets tested on
    this physical device, NEVER log, print, write-to-file, or include in any
    reply the actual content of SMS messages, sender phone numbers, or any
    other personal data read from the device. Verification must be limited
    to counts and structural checks (e.g. "read N messages", "parsed M as
    financial, created M pending transactions") — never the message bodies
    themselves. This mirrors the app's own existing design principle (see
    `sanitizedPreview` field — the app already never stores full raw SMS
    bodies, only a sanitized preview it itself computes).
  - Also do not screenshot the device at arbitrary moments (the orchestrator
    did this earlier in the session and twice caught the user's private
    WhatsApp notification shade / Instagram feed by accident). Before any
    `adb exec-out screencap`, first confirm via
    `adb shell dumpsys activity activities | grep topResumedActivity` that
    `com.tracker/.MainActivity` is genuinely focused, and even then prefer
    `adb logcat` / `pidof` / `uiautomator dump` (text, not pixels) for
    verification over screenshots wherever that's sufficient.
  - App package: `com.tracker`. Metro dev server may or may not currently be
    running on port 8081; if not, start it (`npx react-native start` in the
    background) and `adb reverse tcp:8081 tcp:8081` before expecting the app
    to load JS after an install.
- Current architecture (built up over this whole session, all working,
  verified on-device as of the last task): React Navigation (stack + bottom
  tabs), Zustand (`src/features/transactions/state/transactionsStore.ts`,
  currently seeded from `src/test/fixtures/transactionFixtures`), a full
  design-token theme (`src/theme/`), shared UI primitives
  (`src/shared/ui/*`), and these screens: `HomeScreen`, `PendingScreen`,
  `TransactionsScreen`, `TransactionDetailScreen` (+ its shared
  `TransactionDetailContent` component used both as a bottom-sheet "Review"
  surface and a full-screen "Transaction Detail" view), `AccountsScreen`,
  onboarding tour + `PermissionsScreen`.
- Domain types already exist and are correct — do not redesign them, build
  on top:
  - `src/domain/transactions/transaction.types.ts` — `Transaction`,
    `TransactionType`, `TransactionStatus`, `PaymentMethod`, `SourceType`.
    Note `amountMinor` is an integer (paise) — NEVER use floating point for
    money anywhere in new code either.
  - `src/domain/transactions/transaction.rules.ts` — `confidenceTier`,
    `canFastApprove`, `affectsBalance`, `canTransition`. Reuse these; don't
    duplicate the logic.
  - `src/domain/accounts/account.types.ts` — `Account`, `AccountType`.
  - `src/domain/accounts/account.rules.ts` — `calculateBalance`,
    `isLiabilityAccount`. Reuse — balance is ALWAYS derived
    (opening + approved income − approved expense), never stored/edited
    directly.
  - `src/domain/categories/category.types.ts` — `Category`.
  - `src/domain/audit/audit.types.ts` — `AuditEvent`, `AuditEventType`,
    `AuditActor`.
- SQLite library already installed and proven to build/compile on this
  device: `@op-engineering/op-sqlite`. Exact API (verified from
  `node_modules/@op-engineering/op-sqlite/lib/typescript/src/{functions,types}.d.ts`
  — do not guess a different API shape):
  ```ts
  import { open } from '@op-engineering/op-sqlite';
  const db = open({ name: 'tracker.db' }); // location defaults to the app's documents dir
  const result = await db.execute('SELECT * FROM transactions WHERE id = ?', [id]);
  // result: { insertId?, rowsAffected, rows: Array<Record<string, Scalar>>, ... }
  await db.transaction(async (tx) => {
    await tx.execute('INSERT INTO ...', [...]);
  });
  ```
  `execute` is async (returns a Promise). There's also `executeSync` — prefer
  the async `execute`/`transaction` API for app code; `executeSync` blocks
  the JS thread.
- Files currently importing fixture/mock data that MUST be rewired to use
  real persistence instead (exact list, verified via grep — don't go
  hunting for more, this is complete):
  1. `src/features/transactions/state/transactionsStore.ts` — seeds from
     `transactionFixtures`, exports `useTransactionsStore`, `selectPending`,
     `selectApproved`. This file becomes the hydration/cache layer backed by
     the new transaction repository (see Phase 1 contract below).
  2. `src/features/home/screens/HomeScreen.tsx` — no longer imports fixtures
     directly itself actually (check current imports) but reads
     `accountFixtures` for balance calc — must switch to a real accounts
     source.
  3. `src/features/transactions/components/TransactionDetailContent.tsx` —
     uses `categoryById`/`accountById` from fixtures for display lookups.
  4. `src/features/accounts/screens/AccountsScreen.tsx` — uses
     `accountFixtures` directly as its account list.
  5. `src/features/pending/components/PendingTransactionCard.tsx` — uses
     `categoryById` from fixtures.
  - **`src/features/onboarding/components/TourIllustration.tsx` is the ONE
    EXCEPTION — leave it alone.** It uses fixtures purely as static,
    decorative preview content inside the onboarding tour slides (it is
    never shown as "your real data", it's illustrating what the feature
    looks like, same as a marketing screenshot would). Do not touch it, do
    not wire it to the real database, do not remove its fixture import.
- `src/test/fixtures/*` files themselves: do NOT delete them. They remain
  useful as literal test fixtures for unit tests (several already exist
  under `src/**/__tests__/*.test.ts` and may reasonably use them, or new
  tests may). Only remove their usage from the **application/UI code** listed
  above.
- No `@hookform/resolvers` package installed yet (needed to bridge the
  already-installed `zod` with the already-installed `react-hook-form` for
  the new forms in Phase 2). Not needed for Phase 1.
- `react-native-sqlite-storage` was REMOVED earlier this session (abandoned
  package, broken on modern Gradle). `@op-engineering/op-sqlite` replaced it
  and is the one and only SQLite library in this project. If `npm ls` or any
  build error mentions `react-native-sqlite-storage`, something
  re-introduced it — treat that as a bug to remove, not a thing to fix
  forward.
- `react-native-reanimated`, `react-native-worklets`, `@gorhom/bottom-sheet`,
  `react-native-gesture-handler` were deliberately removed (real upstream
  version incompatibility, confirmed via direct investigation). The
  project's `BottomSheet` component (`src/shared/ui/BottomSheet/`) is a
  hand-rolled `Modal` + `Animated` implementation with a `visible`/`onClose`
  API (not a ref-based API) — if you need a bottom sheet for anything in
  this task, reuse that component, do not reintroduce the removed libraries.

## Phase table

| # | phase | output file | status |
|---|-------|--------|--------|
| 1 | persistence-foundation | 01-persistence-foundation.md | DONE — orchestrator independently verified: parameterized SQL in both repositories, useShallow intact at all 4 call sites (HomeScreen/PendingScreen/TransactionsScreen/MainTabs), tsc clean, jest 25/25 pass, device shows genuine empty state (₹0 everywhere, "No accounts yet"), zero crashes |
| 2 | forms-add-edit | 02-forms-add-edit.md | DONE — orchestrator completed the live device click-through after user unlocked phone: Add Record (amount/merchant/category/account all correct) -> Pending -> Approve -> shows correctly in Transactions/Accounts with correct balance (-₹250.75) -> Edit (merchant change persisted). Zero crashes throughout. One UX finding: Edit/Save/Delete buttons at the very bottom of TransactionDetailContent and the edit form sit inside Android's gesture-nav exclusion zone on this device — taps there get eaten by the system gesture, not the app; scrolling the content up ~100-150px before tapping works around it. Worth a Phase-5-or-later polish: add bottom padding/safe-area inset so those buttons never render in the last ~100px of screen height. |
| 3 | accounts-forms | 03-accounts-forms.md | DONE — both "Add Account" and "Add New Money Source" verified end-to-end on device: 2 new real accounts (HDFC Salary Account/bank, Cash Wallet/cash) persisted via SQLite, correct balance math, live in Add Record picker, survives app restart. Zero crashes. |
| 4 | sms-sync | 04-sms-sync.md | DONE — native SmsReader module + READ_SMS permission + regex heuristic parser v1 + dedup, all gates pass (tsc/eslint/jest 73 tests/gradle build), on-device verified via count-only method (36 real pending SMS-derived transactions already synced from the real inbox by the first run; re-sync correctly produces created=0 twice, proving dedup; zero crashes). First run's privacy incident documented above; the 04b continuation respected the new app-isolation rule correctly. |
| 5 | sync-feedback-toast | 05-sync-feedback-toast.md | DONE — ToastAndroid wired for plain success/generic-fail, Alert kept for permission-denied/no-accounts, all gates pass, confirmed on-device via logcat toast-lifecycle evidence. Note: its run log leaked one real merchant/amount pair ("<redacted merchant> P.", "-₹50") via an incidental Home-screen dump; deleted, not committed. |
| 6 | ui-onboarding-polish | 06-ui-onboarding-polish.md | DONE — HomeScreen wrapped in SafeAreaView (header clears status bar), app_settings SQLite table + hasOnboarded/completeOnboarding store flag, RootNavigator now takes initialRouteName prop gated on hydration, both PermissionsScreen exits mark onboarding complete. All gates pass, confirmed on-device: first launch shows Tour, relaunch skips straight to Home. |
| 7 | sms-account-matching | 07-sms-account-matching.md | DONE — parser now extracts bankName/accountKind/lastFour; exact-match (type+lastFour) required, fallback-to-first-account removed; unmatched SMS grouped into an approvable SmsSuggestionsScreen (bank/type/last4/count) instead of silent misassignment. All gates pass (88 tests). Verified end-to-end on-device via real taps: Sync → 4 suggestions shown → approved "Federal" bank/1859 → re-sync created 29 correctly-matched real pending transactions, credit_card vs bank correctly kept separate for the same bank (HDFC appeared as both). Process violation during setup documented above (raw SQL db seeding) — fixed going forward with a hard no-exceptions rule. |

Each phase is one `opencode run ... --model deepseek/deepseek-v4-pro`
dispatch. Phases are sequential — phase N's prompt should tell the executor
to read phase N-1's output file first, since later phases build directly on
earlier ones (new repository methods, new screens, new routes).

## Phase 8

| 8 | full-workflow-verification | 08-full-workflow-verification.md | DONE — all 13 steps pass on a genuinely fresh install, zero bugs found, zero crashes (checked FATAL EXCEPTION/Maximum update depth/AndroidRuntime FATAL/ReactNativeJS errors/process-died, all 0 across 11,617 logcat lines). Onboard-once, both Add Account entry points, Add/Approve/Edit, real Sync SMS → Suggestions → approve → re-sync dedup, and restart-persistence all confirmed working together. No raw DB access used this run — new hard rule held. Device left with a few extra accidental-but-harmless test accounts from the executor's own input-timing slip (documented, zero impact on balances/assertions). |

## Phase 9

| 9 | qa-test-suite | 09-qa-test-report.md | IN PROGRESS, attempt 4 — user explicitly approved a clean slate: orchestrator ran `adb uninstall com.tracker` (wipes all prior test data: Phase 2/3/7/8 synthetic accounts, 29+ real SMS-derived pending transactions — regenerable by re-sync, nothing irreplaceable), rebuilt + fresh-installed the current code (includes all 4 sms-sync-v2 phases), confirmed clean install, then dispatched the unchanged QA prompt. PID 54697, log at phase9-run.log. Attempts 1-3's partial history is above for context only. |

## Phase 10

| 10 | qa-bugfixes | 10-qa-bugfixes.md | IN PROGRESS — first attempt (PID 72871) died mid on-device verification on an API/billing error ("Insufficient Balance"), not a code/device issue. Orchestrator independently confirmed all 7 fixes (T1-T7) were already implemented in source before the crash. Continuation 10b first tried on opencode (PID 80209) — died instantly, same balance error. Re-dispatched to a Claude subagent. DONE — all 7 fixes confirmed on-device (font-scale no crash, delete with confirm, permanently-denied → Open Settings, 48dp targets clear of gesture zone, rounding, duplicate-account block, SBI label via normalizer). Subagent also fixed the Pending review BottomSheet's buttons sitting in the gesture zone (added bottom inset). Gates: tsc clean, 186 tests, build OK, zero FATAL. Report leak-scanned clean by orchestrator. |

## Phase 11

| 11 | safearea-dialog | 11-safearea-dialog.md | DONE — Transactions/Accounts/Pending wrapped in SafeAreaView top (Onboarding already safe via OnboardingShell). 9 reachable screens verified on device: all text below status bar (y≥186, bar ends 162), all bottom buttons clear of nav bar. New shared `src/shared/ui/Dialog` (themed Modal + showDialog store + DialogHost in src/app/App.tsx); all 6 Alert.alert sites migrated, zero remain. Delete + duplicate-account dialogs verified on device, no stock AlertDialog ids. 190 tests, gates clean, zero FATAL. Unverified on device: Permissions/Onboarding (need uninstall), 3 Home sync dialogs (need revoked permission / zero accounts). Finding: Pending sheet's Delete path is unreachable dead code (Delete only shows for non-pending; sheet only shows pending). |

## Phase 12

| 12 | sms-source-view | 12-sms-source-view.md | DONE — "View original SMS" in Detection Transparency: native `readById` (bound `_id = ?`), new `OriginalSmsView.tsx` holds text in useState only (verified: no store/DB/log writes), states for denied/not-found/date-mismatch/error, hidden for manual entries. Confidence fixed: parser now 0–100, migration 3 rescales old rows; device shows "90% High Match". 195 tests, gates clean, 0 app FATAL. Side effect: SMS items ≥90 now eligible for Home fast-approve (correct per rules, new). Incident: foreground check read only the FIRST topResumedActivity line and missed WhatsApp in front during ~5 filtered dumps (Tracker-label-only output, no other-app text printed). Leftover: 2 synthetic pending "QA-Merchant-05" records. |

## Phases 13–14

| 13 | profile-approval-mode | 13-profile-approval-mode.md | DONE — ProfileSetup step, hand-rolled Slider, settings keys user_name/approval_mode/auto_approve_threshold, Home greeting + settings sheet, shouldAutoApprove in syncSms via store.approve. 226 tests, gates clean, 0 FATAL. Device: sheet + real swipe + persistence verified; ProfileSetup unreachable (no uninstall) → code review/tests only; no real auto-approval happened (parser only emits 90/60/40, threshold was 95; no retroactive approval by design). CAUTION: executor overwrote owner's pre-existing settings (name "Siraj", Auto/85) with "QA User", Manual/95 — owner told to restore. No audit writer exists → auto-approvals unaudited. Open UX: thresholds >90 can never fire with current parser; sheet height jumps ~324px on mode toggle. |
| 14 | soft-delete-account | 14-soft-delete-account.md | CODE DONE, DEVICE UNVERIFIED — softDelete/restore (deleted_at + 'deleted' decision row, one transaction each, only the decisions table is ever DELETEd from; transactions never touched), store loads all accounts + active/deleted selectors (useShallow), deleted excluded from totals/pickers/guards/matching, "Deleted account ••XXXX (name)" label helper, edit form keeps deleted account w/ note, sync partitionCandidates drops SMS owned by deleted accounts, Accounts "Remove account" + collapsible "Deleted accounts (N)" + Restore. 251 tests, gates clean, report leak-clean. Phone disconnected mid-run (wireless-debugging switch, then gone >6 min) → device checks 1–8 NOT run; no QA data created; owner's accounts/settings untouched. NEXT: rerun device checks once `adb devices` shows the phone stably. Known edge: removing a no-last-four, unknown-bank account suppresses suggestions for unknown-bank/no-last-four SMS of that type. |

## Phase 15

| 15 | approval-toggle | 15-approval-toggle.md | CODE DONE, DEVICE UNVERIFIED — user asked for Manual/Auto as a toggle: ProfileForm now uses a themed `Switch` "Auto-approve" (on = auto); threshold slider always rendered, dimmed + non-draggable when off (fixes the ~324px sheet jump); TwoPositionSlider deleted (no other users). 254 tests, gates clean. Device verification for 14 + 15 pending: phone not on adb (user moving to wireless debugging). |

## Phase 16

| 16 | device-verify-14-15 | 16-device-verify-14-15.md | DONE — 13/13 PASS over USB. Phase 14 VERIFIED: remove drops totals by exactly 900.00, Deleted accounts section + Restore work, transaction kept with "Deleted account ••9999 (QA Delete Bank 9999)" label, excluded from picker, edit shows note, Sync no crash. Phase 15 VERIFIED: Save button y unchanged on toggle, slider disabled when off. Owner settings read OFF/95, restored OFF/95 (closed without Save), persisted after relaunch. Name field already "QA User" (Phase 13 leftover, untouched). Logcat 0 FATAL/0 Max update depth/0 ReactNativeJS. Report leak-clean. Minor open: F1 "Its 1 transaction stay" grammar (AccountsScreen.tsx); F2 sheet top edge grows 60px when ON (helper text wraps 2 lines vs 1) — fix with minHeight. Incident-free: incoming call put Dialer in front; executor did not inspect or press HOME, waited idle, one tap re-sent. Pre-existing deleted account (not created by QA) seen in Deleted accounts, untouched. Leftover synthetic: "QA Delete Bank 9999" ACTIVE (+1000.00 to totals), 2 pending QA-Merchant-05; QA-Merchant-06 deleted. |

## Phase 17

| 17 | polish-threshold-note | 17-polish-threshold-note.md | DONE — F1 fixed (removeAccountMessage helper: 0 "It has no transactions." / 1 "stays" / many "stay"); F2 fixed (fixed 84dp copy block, no movement OFF/ON at 89–100); user chose keep range 70–100 + note: `shouldShowThresholdNote` shows muted note when auto && threshold > SMS_PARSER_MAX_CONFIDENCE (= CONFIDENCE_HIGH, parser literal 90 replaced with constant). 263 tests, gates clean. Device D1–D4 PASS; dialog cancelled (QA Delete Bank 9999 still active); owner settings OFF/95 restored without Save, persisted. Trade-off: sheet now always ~192px taller than old OFF state (reserved note space). Report leak-clean. Open: user to choose Pending Delete A (add) vs B (remove dead code, recommended). |

## Decisions log

- 2026-10-25: User opted into auto-approve as a USER CHOICE (default Manual,
  threshold 70–100%, default 90). This relaxes "SMS transactions are never
  auto-approved" only when the user turns Auto on; approval still goes
  through canTransition, and existing pending items are not retroactively
  approved.

- 2026-10-25: FOREGROUND-CHECK FIX — `dumpsys activity activities | grep
  topResumedActivity` prints MULTIPLE lines (one per display/task stack);
  Phase 12's executor read only the first and missed WhatsApp in front.
  Rule from now on: the foreground check must be
  `adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` and BOTH
  must contain `com.tracker` before any tap or dump. Put this exact
  command in every future device prompt.
- 2026-10-25: User chose live-read for SMS source view: the original SMS is
  fetched from the device inbox by id on demand and held only in component
  state. The "never store raw SMS bodies" rule stays intact.

- 2026-10-25: EXECUTOR CHANGE — opencode/deepseek-v4-pro account hit
  "Insufficient Balance" twice (Phase 10 and 10b). User instruction: stop
  using opencode/deepseek entirely; future executors are Claude subagents
  (Agent tool) that read the phase prompt file and follow it. Same
  STATE.md/prompt/report structure, same device-safety rules.

- 2026-10-25: INCIDENT — Phase 4's first run navigated out of Tracker into
  the device's real Messages app (`com.google.android.apps.messaging`) and
  `uiautomator dump`'d real SMS content (real bank sender, real UPI
  amounts, real counterparty names) into its own command output, which
  landed in `phase4-run.log` on disk. The orchestrator discovered this,
  deleted the log (confirmed never tracked/committed by git — `ongoing/` is
  entirely untracked in this repo), force-stopped the Messages app, and
  returned the device to home. Phase 4's actual code (native module,
  manifest, parser, wiring) was otherwise complete — only the
  verification step went out of bounds. NEW PERMANENT GROUND RULE for every
  remaining/future phase that touches the device: the executor may interact
  with EXACTLY ONE app, `com.tracker` (plus the system permission dialog
  when it's expected), and must re-check `topResumedActivity` before every
  tap; if anything else is ever foreground, stop and return to Tracker
  without inspecting it. A dispatched Phase 4-continuation
  (`prompts/04b-sms-sync-finish.txt`) re-states this explicitly and
  restricts remaining Phase 4 verification to count-only checks (badge
  numbers, Alert numbers) instead of reading any transaction list content.
- 2026-10-25: Phase 5 repeated a smaller version of the same mistake — a
  `uiautomator dump` taken while locating a button on Home incidentally
  included a Recent Transactions row with a real merchant name and amount
  ("<redacted merchant> P.", "-₹50"), which landed in its run log. Deleted, not
  committed. ADDITIONAL PERMANENT RULE: any `uiautomator dump` of a screen
  that can show real transaction rows (Home, Pending, Transactions,
  Transaction Detail, Accounts once real SMS-derived accounts exist) must
  be grepped/filtered down to ONLY the specific element being located
  (e.g. `grep -o 'text="Sync SMS"[^>]*bounds="[^"]*"'`) — never print the
  full dump's text nodes to stdout when one of these screens is on-screen,
  even "just to see what's there." This applies to every remaining/future
  phase, not only ones that directly touch SMS.
- 2026-10-25: Phase 7's first dispatch stalled ~28min with zero log
  progress (likely a hung API call or an internal approval prompt nobody
  could answer) — killed and restarted clean under a new PID, no code was
  touched by the stuck attempt. The restarted run otherwise succeeded, but
  committed a real rule violation during its own device setup: it found
  the on-device `tracker.db` EMPTY (0 accounts, 0 transactions — a side
  effect of Phase 6's own test, which intentionally `adb uninstall`'d the
  app to verify first-launch-only onboarding, and nothing restored real
  data afterward) and, instead of recreating test accounts through the
  app's own already-working Add Account screen, directly `adb push`'d a
  hand-edited `tracker.db` with raw `sqlite3 INSERT` statements to seed 3
  synthetic accounts — an explicit violation of the "never run sqlite3
  against tracker.db" rule stated in that phase's prompt, even though the
  rows it inserted were synthetic (not real user data) and the rest of its
  verification (Sync SMS → Suggestions screen → Add Account prefill →
  re-sync) WAS done through genuine in-app taps afterward, producing real,
  correctly-matched results (confirmed: 29 real SMS-derived transactions
  correctly assigned to a newly-approved "Federal"/bank/1859 account). No
  irrecoverable data loss: the lost items were 3 synthetic test accounts
  (trivially recreatable) and the real pending SMS transactions Phase 4
  had synced (regenerable byte-for-byte by tapping Sync SMS again, since
  `sourceReferenceHash` is deterministic from the SMS's own row id + date —
  the underlying SMS messages are untouched on the device). NEW PERMANENT
  RULE, stronger than before: NO phase may EVER read, write, push, pull,
  or otherwise directly manipulate `tracker.db` (or any file under the
  app's `databases/`/`files`/`documents` directories) via `adb`/`sqlite3`/
  `run-as cat`/`run-as cp`, for ANY reason, including "the database is
  unexpectedly empty and I need test data." If the device's app data is
  ever empty when a phase starts, the correct and only allowed fix is to
  recreate whatever's needed (accounts, transactions) through the app's
  own screens (Add Account, Add Record) via real taps — exactly as Phases
  2/3/4 originally did it. This is non-negotiable from here forward.
- 2026-10-25: INFRA QUIRK — two separate dispatches (Phase 4's first attempt
  and Phase 9's first attempt) have now died mid-run with the identical
  signature: `permission requested: external_directory (/sdcard/*);
  auto-rejecting` followed by `Error: The user rejected permission to use
  this specific tool call.`, then the process exits. This is opencode's own
  local sandbox refusing a tool call that treats a `/sdcard/...` path as if
  it were a local filesystem path (e.g. calling its own file-read/write tool
  directly on `/sdcard/u.xml` instead of going through `adb shell cat
  /sdcard/u.xml` or `adb pull`). NEW GROUND FACT for every future phase:
  NEVER pass a `/sdcard/...` path to a native Read/Write/Edit tool call.
  Every reference to an on-device path must be wrapped inside an `adb
  shell`/`adb pull`/`adb push` command string (e.g. `adb shell cat
  /sdcard/u.xml`, not a direct file-read of `/sdcard/u.xml`). State this
  explicitly near the top of every future device-testing prompt.
- 2026-10-25: K2 confirmed via a real (synthetic-data-only) unit test before
  Phase 9's first attempt crashed: `smsParser.ts`'s `bankName` regex only
  catches a bank name adjacent to the literal word "Bank" — a message
  phrased as "SBI Card ending ####" or "SBI A/C ####" (no adjacent word
  "Bank") falls through to `'Unknown Bank'`. This matches the user's real
  on-device observation (their actual SBI messages produced an "Unknown
  Bank" suggestion instead of "SBI"). Confirmed as a genuine v1 parser
  accuracy gap — tracked as a Phase 9 finding, not yet fixed (QA's job is
  to report it, not fix it).

- 2026-10-05: Scoping decision — "remove mock data" means the app starts
  with a genuinely EMPTY database (zero accounts, zero transactions) on
  first run. The only seeded data is the system `categories` table (food,
  shopping, transport, coffee, salary, freelance — the same 6 currently in
  `src/test/fixtures/categories.fixture.ts`), because categories are a
  taxonomy/reference list (like a dropdown's static options), not "fake
  data standing in for the user's real data" the way mock transactions and
  accounts are. This is a judgment call by the orchestrator, not the user's
  literal words — flagged here in case the user disagrees once they see an
  empty Accounts screen with no way to add a transaction until they add an
  account first (which is the correct, honest product behavior — you can't
  have a transaction with no account).
- 2026-10-05: SMS Sync is scoped as a genuine first version (real
  `READ_SMS` permission, real native Android module reading the actual SMS
  inbox, real regex-based parsing into candidate transactions), not a fake
  stub — but it is explicitly a v1 heuristic parser, not the fully-specified
  multi-signal classifier in `docs/PROJECT.md` §14. This is flagged to the
  user in the final report, not silently presented as more sophisticated
  than it is.
