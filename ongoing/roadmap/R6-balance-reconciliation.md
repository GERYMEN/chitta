# R6 — Balance reconciliation

Branch `phase/R6-balance-reconciliation` (from `phase/R5c-budgets`). Code, tests,
gates and device script only; no device run, no commit.

## What was built

- **T0 — storage.** Migration **14** (additive `ALTER TABLE accounts ADD COLUMN`,
  no row rewritten): `sms_balance_minor INTEGER`, `sms_balance_at INTEGER`
  (epoch ms of the SMS), `sms_balance_dismissed_at INTEGER`, all nullable.
  `Account` gets optional `smsBalanceMinor / smsBalanceAt / smsBalanceDismissedAt`;
  `account.mapper.ts` maps them (ISO <-> epoch ms); `account.repository.ts`
  lists them in `COLUMNS` and adds `setSmsBalanceSnapshot` (latest wins) and
  `dismissSmsBalanceDifference`. `backup.tables.ts` lists all three with
  `sinceVersion 14`; an older backup restores with the columns NULL (tested).
- **T1 — sync write.** `syncSms.ts` collects every balance-bearing SMS candidate
  BEFORE dedup (so an already-recorded SMS still refreshes the snapshot), then
  after the scan `storeSmsBalanceSnapshots` matches them with the same R5d
  `partitionCandidates` the transactions use and writes the newest per account.
- **T2 — pure helper.** `src/domain/accounts/accountReconcile.ts`:
  `reconcileBalance(account, transactions, accountId)`, `isDifferenceDismissed`,
  `differenceDirection`, `prefillForDifference`, `formatAsOf`.
- **T3 — UI + actions.** `BalanceReconcile` component on each account card
  (`AccountsScreen`). Store actions `applyBankBalance` and
  `dismissBalanceDifference`. `AddRecord` route gets `reconcile` params.
- **T4 — audit.** No new type: "Use bank balance" goes through the existing
  `updateAccount`, which writes the existing `account_updated` event with
  field names only (`balanceAnchorMinor`, `balanceAnchorAt`); the Activity feed
  already labels those ("balance", "balance date"). Snapshot writes are not
  audited. "Add missing" rides the existing `created` audit of the pending item.
- **T5 — device script.** `scripts/device/r6.sh` (+ README section). `bash -n` ok;
  not run.

## Where the SMS balance comes from (reader reuse)

- Rules path: `ruleRead.ts` already maps template `account_balance` to
  `balanceMinor` on `ParsedSmsTransaction`.
- Legacy reader path: `readSms.ts` already classified amounts with role
  `balance` (used for `balance_info`) but did NOT put it on a transaction.
  `buildTransaction` now sets `balanceMinor` from `firstAmount(findAmounts(body), 'balance')`
  (a number only; one small additive reader change, no regex/rules change).
  `rules.json` is unchanged.

## Latest-wins snapshot rule

`setSmsBalanceSnapshot(id, minor, atMs)` runs in one transaction: it writes only
when the stored `sms_balance_at` is NULL or **strictly older** than the SMS time.
An older or equal SMS never overwrites (no churn). Within a run the newest SMS
per account is written once. It does not touch `updated_at`, the anchor, the
opening balance or any transaction. No match, no balance, a credit card or a
pay-later account = no write.

## Reconcile helper + anchor reuse

`trackedMinor = calculateBalance(account, transactions, id, asOfMs = smsBalanceAt)`:
like-for-like AT THE SNAPSHOT INSTANT (nothing re-summed; `calculateBalance` gained an
optional `asOfMs` cutoff). Rows dated after the SMS never create a phantom difference; a
missing row dated before it still shows. Anchor handling: an anchor at or before the
snapshot applies (anchor + approved rows after the anchor, up to the snapshot); an anchor
newer than the snapshot is ignored (pre-anchor baseline: opening balance + rows up to the
snapshot); `bankMinor = smsBalanceMinor`;
`diffMinor = tracked - bank`; `asOf = smsBalanceAt`. `null` with no snapshot and
for liability accounts. "Use bank balance" sets the **existing**
`balance_anchor_minor = bankMinor`, `balance_anchor_at = sms_balance_at` (the bank figure is
true as of the SMS, so rows after it keep counting toward the current balance; diff 0, tested).

## The three difference actions (only when diff != 0 and not dismissed)

1. **Use bank balance** — confirm dialog with the effect line ("will show X as of the
   SMS time, later transactions keep adding; earlier ones stay in history but stop counting"); only the
   confirm writes the anchor (audited `account_updated`).
2. **Add missing transaction** — opens Add Record pre-filled: amount = |diff|,
   this account, kind from the sign (tracked < bank = income, tracked > bank =
   expense), merchant "Balance difference"; saved **PENDING** (`approvedAt` null),
   audited `created`; after save it lands on Pending. Never auto-recorded. All other
   manual records stay approved (R5 unchanged).
3. **Dismiss** — stores the current `sms_balance_at` as `sms_balance_dismissed_at`;
   hidden only while they are equal, so a newer snapshot re-surfaces it. No anchor.

Copy: "Bank SMS: Rs X as of <time>" always when a snapshot exists;
"Difference Rs Y · Tracker shows more/less than the bank" when it differs. All
amounts via `formatRupeesFromMinor` (redaction masks them); relative time uses
the screen's `useNow` clock; targets are >= 48 dp with button role + label.

## Tests

Added: `accountReconcile.test.ts`, `account.smsBalance.test.ts` (real sqlite),
`syncSms.r6.test.ts` (10), `BalanceReconcile.test.tsx` (11),
`AddRecordScreen.r6.test.ts`; plus new cases in `migrations.test.ts`,
`mappers.test.ts`, `backup.repository.test.ts` (v13 -> 14 restore, current
round trip).
Changed: `migrations.test.ts` (ALTER count 15 -> 18; "last version" now 14, the
R5c test now checks migration 13 exists); `backup.repository.test.ts` (the R5c
N-1 test pinned to v12 instead of `CURRENT - 1`); `mappers.test.ts` (account
fixture carries the three null fields); `backupRows.fixture.ts` (accounts rows
carry the snapshot columns). All needed because the schema/version moved.

## Decisions beyond D-a..D-h

1. A **third column** `sms_balance_dismissed_at` (D-a lists two): the dismissal
   must persist and be keyed to the snapshot; keeping it on the account row is
   atomic with the snapshot and backed up.
2. `reconcileBalance` takes `(account, transactions, accountId)` — `calculateBalance`
   needs the transactions (D-c wrote `(account)`).
3. Liability accounts (credit card, pay later) are neither snapshotted nor
   reconciled: an SMS "balance" there can be available credit, not the ledger.
4. Legacy reader now emits `balanceMinor` (see above).
5. "Use bank balance" has no new audit type and no new store audit shape (D-h).
6. "Add missing" saves to Pending and navigates there; prefilled merchant
   "Balance difference" (the form requires a merchant).
7. Balance-only SMS (class `balance_info`, e.g. "Available Balance is Rs X") also feed the
   snapshot (follow-up): `balanceOnlyCandidates` in `syncSms.ts` builds match-only
   candidates (never a transaction or pending item) from `nonTransaction.amountMinor`
   (rules: `account_balance`, else `available_limit` / `amount`; legacy reader: the
   'balance' amount) and `nonTransaction.lastFour`. They go through the same
   `partitionCandidates` and `setSmsBalanceSnapshot` (latest wins across both kinds,
   liability skipped, no match = no-op). With no transaction kind on the SMS they are
   tried as bank / upi / other, and a known bank on both sides must agree.

## Known limits

- A balance-only SMS needs a last-4 (a 3-digit mask is not matched).
- A difference does not say WHICH transaction is missing (could be several, a
  fee or an unparsed SMS) — no detection claim.
- New-account suggestion imports (R2b "Add account" with waiting SMS) do not
  write a snapshot; the next Sync SMS does.
- Edit account stays split out to R5j.
- The device script cannot inject SMS; the snapshot path is unit-tested, and the
  script's difference steps run only when an account already has a snapshot.

## How to run the device script

`scripts/device/r6.sh [--skip-install]` (phone over USB, idle 30 s, owner-assisted;
see `scripts/device/README.md`, section R6).

## Gates

tsc clean; eslint 0 errors (2 pre-existing warnings); jest 151 suites / 2590 tests pass
pass; `validate_v2.js` ALL OK (rules.json unchanged); `./gradlew assembleDebug`
BUILD SUCCESSFUL.
