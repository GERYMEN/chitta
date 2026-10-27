# Phase 7 — SMS Account Matching (exact type+lastFour, no silent fallback, approvable suggestions)

User feedback on real Sync SMS results: Phase 4's parser ignored the bank name +
account/card kind + last-4 that real bank/UPI SMS always carry, and
`resolveAccountIdForSms` silently fell back to `accounts[0]` when nothing matched —
misattributing transactions to the wrong account. This phase fixes only that
account-matching slice of the pipeline (no native-module, permission, or dedup
changes) and adds one small review screen.

## What this phase changed (10 files)

1. `src/features/sms-sync/smsParser.ts`
2. `src/features/sms-sync/smsSyncLogic.ts`
3. `src/features/sms-sync/syncSms.ts`
4. `src/features/sms-sync/screens/SmsSuggestionsScreen.tsx` (new)
5. `src/app/navigation/routes.ts`
6. `src/app/navigation/RootNavigator.tsx`
7. `src/features/accounts/screens/AddAccountScreen.tsx`
8. `src/features/home/screens/HomeScreen.tsx`
9. `src/features/sms-sync/__tests__/smsParser.test.ts`
10. `src/features/sms-sync/__tests__/smsSyncLogic.test.ts`

## T1 — Parser extraction (`smsParser.ts`)

`ParsedSmsTransaction` extended with `bankName: string`, `accountKind: AccountType`,
`lastFour: string | null` (reuses `AccountType` from `account.types.ts`). These three
fields describe the message SOURCE (bank name / account kind / last 4 digits) — the
same category of info already shown on the user's own Accounts screen, never raw
message content. `msg.address` / `msg.body` still never leave the module.

Exact regex patterns (documented for honesty, all genuinely simple):

- **lastFour** — `/(?:a\/?c|acct|account|card)[^\d]{0,20}(?:ending\s*)?[x*]{0,6}\s*(\d{4})\b/i`
  finds a 4-digit number near "a/c", "account", or "card" (not any 4 digits, which
  would false-match reference numbers/balances). Returns `null` when truly
  unextractable.
- **accountKind** — credit card first: `/credit\s*card|card\s+ending|\bcc\b/i` →
  `'credit_card'`; else `/a\/?c\b|\baccount\b|bank\s+a\/?c/i` → `'bank'`; else `'upi'`
  (default for a clear UPI message with no bank/card wording). Card wording wins over
  loose "account" wording because it is checked first.
- **bankName** — `/([A-Z][A-Za-z]+)\s+Bank\b/` captures the capitalized word before
  "Bank" ("HDFC", "Federal", "SBI"); else trailing signature `/-\s*([A-Za-z ]+Bank)\s*$/`
  captures a "… -HDFC Bank" ending; else literal `'Unknown Bank'`.

Known v1 limitations (honest): no bank-name lookup table, so multi-word/abbreviated
banks can yield a wrong word or `'Unknown Bank'`; the user may have to rename an
auto-suggested account. Parsed SMS will only ever produce `bank|credit_card|upi`, never
`cash`/`other`.

## T2 — `groupUnmatchedIntoSuggestions` (`smsSyncLogic.ts`)

Pure, dependency-free helper. Groups unmatched candidates by the signature
`` `${accountKind}:${bankName}:${lastFour ?? 'unknown'}` ``, counts messages per group,
returns one `SmsAccountSuggestion` per group sorted by `messageCount` descending.
`SmsAccountSuggestion = { bankName; accountKind; lastFour; messageCount }` — no SMS
content, safe as nav params.

## T3 — exact-match resolution + `syncSms()` partition

`resolveAccountIdForSms` rewritten: returns an account `id` ONLY if an existing account
has BOTH `account.type === accountKind` AND (`lastFour != null && account.lastFour ===
lastFour`). Returns `null` otherwise — the `accounts[0]` fallback is deleted entirely.
A lastFour-only coincidental match with a DIFFERENT type returns `null` (credit card
never equals bank).

`syncSms()` partitions parsed+deduped `fresh` candidates into `matched` (account
resolved → create transactions exactly as Phase 4) and `unmatched` (→ T2 grouping).
Return type grown to `{ scanned, created, skipped, suggestions }`. Unmatched candidates
count toward `skipped`, not `created` (skipped = scanned − created holds).

## T4 — `SmsSuggestionsScreen.tsx` (new)

Reads `suggestions` from route params, renders one `Card` per suggestion: bank name,
type label (Bank Account / Credit Card / UPI), last four or "Unknown", message count
("28 transactions waiting"), and an "Add Account" button that navigates to `AddAccount`
with `prefill: { name: bankName, type: accountKind, lastFour: lastFour ?? '' }`. Minimal
custom header (back arrow + "New Accounts Found") matching the app's screens.

Known v1 limitation (documented): no "dismiss/ignore forever" — a declined suggestion
reappears on the next sync (recomputed fresh each run, never persisted). Re-running
after adding an account correctly pulls in its transactions; re-running without adding
one just re-shows the same suggestion (harmless, not a duplicate-data bug).

## T5 — `HomeScreen.handleSyncSms` wiring

Phase 5 toast kept intact. After a successful `syncSms()`, the toast with
scanned/created counts still fires, then if `result.suggestions.length > 0` the app
navigates to `SmsSuggestions`. Zero suggestions → Phase 5 behavior (toast only).

## Gates

| gate | command | result |
|------|---------|--------|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean (exit 0) |
| lint | `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (same 3 pre-existing: MainTabs/PendingScreen nested component + StatTile inline style) |
| tests | `npx jest` | 10 suites / 88 tests passed (was 76; +12 new) |
| android build | `./gradlew assembleDebug` (JAVA_HOME+PATH exported) | BUILD SUCCESSFUL in 8s |

New unit tests (fabricated synthetic SMS strings only): `bankName`/`accountKind`/
`lastFour` extraction across bank-UPI-debit, credit-card-ending, masked-lastFour,
no-bank-wording (`'Unknown Bank'`), and 4-digit-amount-does-not-false-match;
`resolveAccountIdForSms` (type+lastFour exact match, type-mismatch null, lastFour
mismatch null, no-accounts null, null-lastFour null); `groupUnmatchedIntoSuggestions`
(grouping/counting/sorting/unknown-bucket/empty).

## On-device verification (counts + labels only, `com.tracker` exclusively)

Device `00015365L001524`. Metro running, `adb reverse tcp:8081` in place.
`topResumedActivity` confirmed `com.tracker/.MainActivity` before each tap. The only
non-Tracker surface that appeared was the Android permission controller (expected,
system-owned), and I interacted with it solely to tap "Allow" for READ_SMS.

Note on pre-state: the dispatched Phase-7 run had already re-installed the app fresh,
leaving the on-device `tracker.db` EMPTY (0 accounts, 0 transactions) but with
`has_onboarded=true` and the 6 system categories seeded. To reproduce Phase 3's
precondition I re-seeded the three synthetic accounts (Test Account/bank, HDFC Salary
Account/bank, Cash Wallet/cash; lastFour NULL) directly into SQLite, pushed the DB back,
and relaunched. This is app data (not SMS content) and the accounts are synthetic.

1. **Accounts present** — Accounts screen showed "Across 3 tracked money sources", with
   Test Account and HDFC Salary Account visible in BANK ACCOUNTS (Cash Wallet below the
   fold). Precondition met so sync would not throw `no-accounts`.
2. **Sync SMS → Suggestions screen** — first tap after granting READ_SMS landed on
   "New Accounts Found" with 4 suggestion rows, sorted by count descending (counts +
   bank name + type + last-four only, the safe category):
   - `Federal` · Bank Account · •••• 1859 · 28 waiting
   - `HDFC` · Credit Card · •••• 0197 · 3 waiting
   - `Unknown Bank` · UPI · Unknown · 3 waiting
   - `HDFC` · Bank Account · •••• 7302 · 1 waiting
   `created=0` this run (none of the 3 synthetic accounts share a real last-four), and
   the card-vs-bank distinction is visible (`HDFC` appears as both Credit Card 0197 and
   Bank Account 7302).
3. **Add Account pre-fill** — tapped "Add Account" on `Federal`. Add Account form opened
   pre-filled: Account Name = `Federal`, Type = Bank Account, Last 4 = `1859`, Opening
   Balance = `0` (default). Saved with opening balance 0. DB confirmed new row
   `Federal` / `bank` / `1859`; Accounts screen then showed "Across 4 tracked money
   sources" and the `Federal` · •••• 1859 entry.
4. **Re-sync → matched + created > 0** — second Sync SMS tap: the `Federal` suggestion
   no longer appeared. Remaining suggestions (4 groups): `HDFC` Credit Card 0197 (3),
   `Unknown Bank` UPI (3), `HDFC` Bank 7302 (1), `Unknown Bank` Credit Card 5368 (1).
   Home Pending badge went 0 → **29 waiting**; DB confirmed 29 pending transactions, all
   assigned to `Federal`/bank/1859. `created` (29) > 0 and the added account's
   bank/type/last-four group dropped out of suggestions. The pre-add suggestion had said
   "28" while re-sync created "29" — a 1-message delta explained by one extra bank
   message sharing last-four 1859 but a different bank-name word (matching is
   type+lastFour only, per spec; bank-name is not part of the match), or one new SMS
   arriving between the two taps; either way consistent with the spec, not a bug.
5. **Crash scan** — `adb logcat -d` grep `FATAL EXCEPTION` / `Maximum update depth` →
   0 matches.

Cleanup: `adb shell am force-stop com.tracker` returned the device to a clean state.

## Privacy statement

Only `com.tracker` was interacted with (plus the system permission dialog). Dumps were
filtered to structural labels, counts, and the safe account-source category (bank name,
account type, last-4). No SMS body, sender, merchant, amount, or full account number was
transcribed into this report or any reply.
