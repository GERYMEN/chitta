# R5j — Polish (G7 + G9)

Branch `phase/R5j-polish` (stack tip, migration 14). **No migration was needed**
(no schema change, no new table, no new column; `event_type` has no CHECK).
No permission, dependency or network added.

## Gates
tsc clean · eslint 0 errors (2 pre-existing warnings) · jest 159 suites / 2635
tests pass · rules validate ALL OK (rules.json untouched) · `assembleDebug` OK.

## Per task

**T1 Hidden accounts (done).** New `IgnoredAccountsScreen` (route
`IgnoredAccounts`, Settings row "Hidden accounts"). Lists the 'ignored'
decisions (public bank id, kind, last-4 masked by redaction) via
`ignoredAccountsFrom` (suggestionGroups.ts). "Un-ignore" →
`accountRepository.unignoreSuggestion` deletes only the `ignored` row for that
key (an added/linked/deleted row is never touched); matching SMS are suggested
again from the next sync. No audit: Ignore itself writes none (no money, no
account/transaction id to hang it on) — Un-ignore mirrors it.
Tests: `unignore.r5j.test.ts` (4), `IgnoredAccountsScreen.r5j.test.tsx` (1).

**T2 Restore archived category (done).** "Restore" button on each archived row
in Categories → `restoreCategory` → `categoryRepository.restore` clears
`archived_at`, one transaction with a new audit `category_restored` (category id
only; sanitiser, activity-feed icon + sentence added). System / live categories
are a no-op. Restored category is pickable again. Tests: 2 in
`transactionsStore.categories.test.ts`, `CategoriesScreen.r5j.test.tsx` (1).

**T3 Not-understood content hash (done, no migration).** `transactions` already
has `sms_content_hash`. "Add as transaction" now computes the salted one-way
`smsContentHash` from the live body (NotUnderstoodScreen) and passes only the
hash in `fromSms.smsContentHash`; `AddRecordScreen` stores it (expense/income
via `smsSourceFields`, transfer via `smsReference.contentHash` →
`addTransfer`). Old `sms-<id>-<date>` key unchanged. No backfill. If the salt is
unavailable the row is saved without a hash (as before). Tests:
`notUnderstoodHash.r5j.test.ts` (4: stores hash; same SMS under a new inbox id
dedupes; control without hash does not) + 1 screen test (hash passed, text never).

**T4 Add Record a11y (done).** Account options, Type (Expense/Income/Transfer),
Category and Payment-method choices in `TransactionForm`, and From/To accounts +
the Type row in `TransferForm`, expose `accessibilityRole="radio"` +
`accessibilityState {selected, checked}` + a label. No logic change; reconcile
"Add missing" prefill still pre-selects account + kind. Tests:
`formsA11y.r5j.test.tsx` (4).

**T5 Backup crypto test (PARTIAL — Kotlin part flagged not-done).** The only
crypto in TS is password rules + the native-error mapping; the PBKDF2 / AES-GCM
code is Kotlin (`BackupCrypto.kt`). There is no Kotlin test source set or JUnit
dependency, so a repo test for it is **not done** (not invented). Added
characterisation tests for the reachable TS side: `backupCrypto.r5j.test.ts`
(length boundaries 7/8/128/129, no trim, confirm, error text never holds the
password, every native code maps with a fixed message, password passed through
unchanged). These pass on first run (they pin existing behaviour).

**T6 Filters persist (done, owner-optional).** `filterPersistence.ts` stores
type, account id, category id and period in `app_settings`
(`transactions_filters`); restored in `reloadFromDatabase` (launch + backup
restore); ids that no longer exist drop to "all"; Reset writes the defaults. The
search text and merchant chip are never saved. Easy to drop: remove the three
store hooks. Tests: `filterPersistence.r5j.test.ts` (6). `fakeDb` now also
answers `SELECT value FROM … WHERE col = ?`.

**T7 "Last read N days ago" (done).** `lastRead.ts` + `LastReadBanner` on Home:
shown when the last completed read is more than **3 days** old (N = 3), not
while syncing, only when onboarded with an active account; two actions "Sync
now" / "SMS settings" (opens Settings). `sms_last_synced_at` is the newest SMS
date (a cursor), not a read time, so a quiet inbox would false-alarm; completed
reads (`runSmsSync`, not cancelled/declined) now stamp `sms_last_read_at`
(settings key, no migration) via `useSmsReaderStore.markRead`. Installs with no
stamp yet fall back to the cursor. Uses `useNow`'s `now` from
`useSelectedPeriod`. Tests: `lastRead.r5j.test.tsx` (9).

**T8 Device script (done, not run).** `scripts/device/r5j.sh` (+ README
section). `bash -n` OK. Checks: Hidden list opens, QA category Restore, Add
Record selectors present, filter persists across force-stop + relaunch and Reset
stays cleared, banner absent after Sync SMS. QA data only; never taps Un-ignore.
Run: `scripts/device/r5j.sh [--skip-install]`.

## Decisions / limits
- Un-ignore and Restore audit: Un-ignore none (mirrors Ignore); Restore adds
  one enum `category_restored` (no schema impact).
- T4 also covers Category + Payment-method chips (same pattern).
- Role/selected state is not visible in the device text dump; covered by Jest.
- T7 banner is hidden when nothing is known (no stamp and no cursor).
