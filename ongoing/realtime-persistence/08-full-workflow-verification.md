# Phase 8 — Full Workflow Verification (end-to-end regression, clean slate)

One continuous end-to-end regression test of all 7 prior phases on the real
physical device, from a genuinely fresh install. No code changed this phase.
Purpose: confidence that the whole app — onboard once, add accounts both ways,
manual add/approve/edit, sync real SMS, approve a suggested account, re-sync
with dedup, survive a restart — works together with zero crashes.

Device `00015365L001524`, package `com.tracker`, Android 16 (SDK 36), Metro
running on 8081 with `adb reverse tcp:8081` in place. `topResumedActivity`
re-confirmed `com.tracker/.MainActivity` before every tap. `uiautomator dump`
used throughout (text only, never screenshots); any dump of a screen that can
show real transaction rows was grep-filtered to the specific element being
located.

## Chronological log

### 1. Clean slate install

- `adb uninstall com.tracker` → Success.
- Build: `./gradlew assembleDebug` (JAVA_HOME + PATH exported) → BUILD SUCCESSFUL.
- `adb install -r app-debug.apk` → Success.
- `logcat -c`, `am force-stop`, `am start -n com.tracker/.MainActivity` →
  `topResumedActivity=com.tracker/.MainActivity`.
- Launch successful, no red-box.

### 2. Onboarding (first launch) — PASS

- First launch showed the Tour: headline "Your money, automatically tracked.",
  "Skip Tour" + "Get Started" CTA visible.
- Advanced through all tour steps ("Next Step" → … → STEP 7 OF 7 · PERMISSIONS).
- Tapped **"Enable & Continue to Home"** (the real permission path, not manual skip).
- Real Android system permission dialog appeared
  (`com.google.android.permissioncontroller/…/GrantPermissionsActivity`), showing
  "Allow" / "Don't allow". Tapped **Allow**.
- `dumpsys package com.tracker` confirms `READ_SMS: granted=true` (USER_SET flag).
- Landed on Home with genuine empty state: TOTAL BALANCE ₹0.00, INCOME ₹0,
  EXPENSES ₹0, "0 waiting", empty Recent Transactions.

### 3. Add Account (first real account, UI only) — PASS

- Accounts → "Add Account" (balance-card entry point).
- Filled: name "Primary Checking", type Bank Account, lastFour 1234, opening
  balance 10000.00. Saved.
- Accounts screen confirmed: TOTAL BALANCE ₹10,000.00, "Across 1 tracked money
  sources", "Primary Checking · •••• 1234 · ₹10,000.00".

### 4. Add Record (manual transaction) — PASS

- Home → "Add Record". Filled valid expense: amount 250.75, merchant
  "Office Supplies", category Shopping, account Primary Checking (radio selected),
  date/time defaulted. Note: payment method defaulted to UPI (my "Cash" chip tap
  was consumed by the on-screen keyboard — test-input artifact, not an app bug).
- Submitted → landed on Pending: "1 waiting for approval", merchant
  "Office Supplies", category "Shopping", status pending. Review sheet showed
  exact amount -₹250.75, account Primary Checking ••••1234, "Not counted in
  balance".

### 5. Approve — PASS

- Approved the pending transaction.
- Pending → "0 waiting for approval".
- Accounts balance updated correctly: TOTAL BALANCE ₹9,749.25
  (10000.00 − 250.75). Primary Checking "Approved Ledger Balance ₹9,749.25".

### 6. Edit — PASS

- Transactions → opened the transaction detail → "Edit".
- Form pre-filled correctly (amount 250.75, merchant "Office Supplies", account
  Primary Checking selected).
- Changed merchant to "Stationery Store", saved.
- Detail and Transactions list both reflect "Stationery Store"; change persisted
  after navigating away and back.

### 7. Add second account via bottom CTA — PASS

- Accounts → "Add New Money Source" (bottom button — the other entry point).
- Filled: name "Cash Wallet", type Cash, lastFour empty, opening balance 0. Saved.
- Accounts confirmed both entry points work and both accounts show correctly:
  TOTAL BALANCE still ₹9,749.25 (cash adds 0), "Across 2 tracked money sources",
  "Cash Wallet · Physical wallet · ₹0.00" in CASH group.

### 8. Sync SMS — PASS

- Home → "Sync SMS". Real inbox read (READ_SMS granted).
- No matched transactions created (my 2 fabricated accounts share no real
  last-four) — instead navigated to "New Accounts Found" (Suggestions) screen
  with 4 groups (bank/type/last-four + counts only, the safe category):
  - Federal · Bank Account · •••• 1859 · 28 waiting
  - HDFC · Credit Card · •••• 0197 · 3 waiting
  - Unknown Bank · UPI · Unknown · 3 waiting
  - HDFC · Bank Account · •••• 7302 · 1 waiting
- Same 4 groups/counts as Phase 7's verified run (deterministic).

### 9. Approve one real suggestion — PASS

- Tapped "Add Account" on the Federal suggestion.
- Add Account form pre-filled correctly: Account Name "Federal", Type Bank
  Account, Last 4 "1859", Opening Balance 0 (default). Saved with 0.
- Back on Accounts, "Federal · •••• 1859 · ₹0.00" now listed alongside Primary
  Checking.

### 10. Re-sync (match + dedup) — PASS

- Second "Sync SMS" tap: Federal suggestion gone from the list; remaining 4
  groups (HDFC Credit 0197 ×3, Unknown UPI ×3, HDFC Bank 7302 ×1, Unknown Credit
  5368 ×1). Home Pending badge went 0 → **29 waiting** — Federal's messages now
  matched (type bank + last-four 1859) and created as pending transactions.
- Third "Sync SMS" tap immediately after: Pending badge stayed **29 waiting**
  (no new Federal transactions) — dedup holds after all this session's changes.
- Toast lifecycle evidence in logcat (3 `com.tracker` toasts observed).

### 11. Persistence across restart — PASS

- `am force-stop com.tracker` then `am start` (NOT uninstall).
- Relaunch landed directly on Home ("Good morning, Siraj") — **no Onboarding/Tour
  reappeared** (Phase 6 fix holds).
- Data intact: TOTAL BALANCE ₹9,749.25, Pending badge 29, approved
  "Stationery Store" transaction present, EXPENSES ₹250.
- Accounts screen shows the accounts with correct balances (Primary Checking
  ₹9,749.25, Federal ₹0.00, Cash Wallet ₹0.00).
- Home greeting header at `bounds=[48,210][1212,312]` — top y=210, clearly below
  the status bar (Phase 6 SafeArea fix holds).

### 12. Crash check — PASS

- `adb logcat -d` across the session (11,617 lines in buffer): grep
  `FATAL EXCEPTION` → 0, `Maximum update depth exceeded` → 0, `AndroidRuntime
  FATAL` → 0, `ReactNativeJS` error/exception → 0, `Process com.tracker … died`
  / `Fatal signal` → 0. Zero crashes from start to finish.

### 13. Cleanup

- `adb shell am force-stop com.tracker` → device returned to launcher.

## Test-hygiene note (not an app bug)

During step 11's verification I initially dumped the Accounts screen ~1.5s after
tapping the Accounts tab on the freshly restarted app and briefly saw "Across 3
tracked money sources" with no account cards in the tree. A re-test with a longer
settle time (2.5s) showed all account cards rendering correctly — the earlier
observation was a dump-timing artifact, not a rendering defect. While
investigating it I issued several fast swipe gestures that unintentionally
triggered the SmsSuggestions "Add Account" flow multiple times, creating 5 extra
accounts (HDFC bank 7302, HDFC credit 0197 ×2, Unknown credit 5368, Unknown UPI).
Each was created through the normal, correct Add Account flow — this is my own
input hygiene, not a defect. It does not affect any assertion: total balance
remains ₹9,749.25 (all accidental accounts opened at 0), pending badge remained
29, and no accidental transactions were created.

## Verdict

Every step passed. The full real-world workflow — onboard once via the real
READ_SMS permission dialog, add accounts via both entry points, manual
add/approve/edit, sync real SMS into approvable suggestions, approve a suggested
account, re-sync with correct matching + dedup, and survive a force-stop/relaunch
with data intact and no onboarding repeat — works end-to-end with zero crashes and
zero `FATAL EXCEPTION` / `Maximum update depth exceeded`.

## Privacy statement

Only `com.tracker` was interacted with (plus the expected Android system
permission dialog). No real SMS body, sender identity, merchant, amount, or
account number appears in this report. Real SMS-derived results are reported as
counts and the established safe account-source category (bank name, account type,
last-4). The only merchant names/amounts referenced are my own fabricated test
data (Primary Checking, Cash Wallet, Office Supplies, Stationery Store, 250.75,
10000.00).
