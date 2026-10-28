# R1 — Trust foundation: report

Executor: Claude subagent. Date: 2026-10-28. Not committed.

## Summary

- **Gates:** all pass. tsc is clean, eslint has 0 errors (3 warnings that were already there), jest passes 319/319 (was 263), and `assembleDebug` is OK.
- **Device:** D1–D6 PASS over USB on serial 00015365L001524. Only synthetic QA data was touched.
- **Audit writer:** every money-changing store action now writes exactly one audit event, in the same `db.transaction` as the change it records. The single exception is approval settings: one save can change two keys, so it writes one event per changed key.
- **Activity feed:** a new screen, opened from the Home settings sheet.
- **Transactions filters:** they now actually filter.
- **Pending:** the dead Delete path is removed (user decision B).

## Files changed (29)

Modified (16):
- src/app/navigation/RootNavigator.tsx — `Activity` stack screen
- src/app/navigation/routes.ts — `Activity` route
- src/data/db/migrations.ts — migration 4
- src/data/db/__tests__/migrations.test.ts — migration 4 runs once; ALTER count now 5
- src/data/repositories/transaction.repository.ts — create/update/delete take audit drafts; each runs in one `db.transaction`
- src/data/repositories/account.repository.ts — create/update/softDelete/restore take audit drafts, written inside the transaction
- src/data/repositories/settings.repository.ts — `setMany(entries, audit)` writes in one transaction
- src/domain/audit/audit.types.ts — reconciled with the table: dropped `previousHash` and `eventHash` (R1 has no hash chain); added `accountId`, `seq`, typed metadata, `created` and the account/settings event types
- src/features/transactions/state/transactionsStore.ts — audit drafts on every action; `approve(id, auto?)`; new `updateAccount`; filter state with set/reset
- src/features/sms-sync/syncSms.ts — passes `{confidence, threshold}` on auto-approve; updated doc comment
- src/features/home/screens/HomeScreen.tsx — settings sheet `onOpenActivity`
- src/features/profile/components/ProfileSettingsSheet.tsx — "Activity" row at the top of the sheet
- src/features/pending/screens/PendingScreen.tsx — removed `handleDelete`, the dialog, the `deleteTransaction` selector, `showDialog` and the `onDelete` prop
- src/features/transactions/components/TransactionDetailContent.tsx — `onDelete` is now optional; Delete renders only when it is passed
- src/features/transactions/screens/TransactionDetailScreen.tsx — when the transaction is missing it shows "Transaction deleted" with a back header and safe area (was a bare "Transaction not found.")
- src/features/transactions/screens/TransactionsScreen.tsx — filters (chips, pickers, search, Reset); totals and counts follow the filtered set

New (13):
- src/data/repositories/audit.repository.ts — `insert(executor, input)` and `listRecent(limit, cursor)`
- src/data/mappers/audit.mapper.ts
- src/domain/audit/audit.rules.ts — metadata whitelist sanitizer and changed-field helpers
- src/features/activity/activityFeed.ts — pure sentence, impact, time and day-grouping helpers
- src/features/activity/hooks/useActivityFeed.ts — cursor pagination
- src/features/activity/screens/ActivityScreen.tsx
- src/features/transactions/filters/transactionFilters.ts — the one pure filter predicate, plus counts and totals
- src/test/fakeDb.ts — in-memory op-sqlite stand-in that records calls and which transaction each ran in
- Tests:
  - src/data/repositories/__tests__/audit.repository.test.ts
  - src/features/transactions/state/__tests__/transactionsStore.audit.test.ts
  - src/features/sms-sync/__tests__/syncSms.audit.test.ts
  - src/features/activity/__tests__/activityFeed.test.ts
  - src/features/transactions/filters/__tests__/transactionFilters.test.ts

## Migration 4 SQL

```sql
ALTER TABLE audit_events ADD COLUMN account_id TEXT
CREATE INDEX IF NOT EXISTS ix_audit_event_at ON audit_events(event_at)
CREATE INDEX IF NOT EXISTS ix_audit_transaction ON audit_events(transaction_id)
```

- It goes through the existing `schema_migrations` guard and runs in its own transaction.
- No old migrations were edited.
- A test runs it 3 times and confirms each statement runs exactly once.

All audit SQL is parameterized. The insert is:

`INSERT INTO audit_events (id, transaction_id, account_id, event_type, event_at, actor, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`

## Audit call-site map

Every row below writes in the same `db.transaction` as the data change.

| User / system action | Store action | Repository call | event_type / actor | metadata |
|---|---|---|---|---|
| Add Record (manual) | `addTransaction` (sourceType manual) | `transactionRepository.create` | `created` / user | null |
| SMS sync inserts a pending item | `addTransaction` (sourceType sms), called from `syncSms` | `create` | `detected` / system | `{kind, confidence}` |
| SMS auto-approve (opt-in) | `approve(id, {confidence, threshold})`, called from `syncSms` | `update` | `auto_approved` / system | `{kind, confidence, threshold}` |
| Approve: Pending card, Pending sheet, Detail, Home fast-approve | `approve(id)` | `update` | `approved` / user | null |
| Reject | `reject` | `update` | `rejected` / user | null |
| Edit | `updateTransaction` | `update` | `edited` / user | `{kind, fields:[names]}` |
| Delete (Transaction Detail) | `deleteTransaction` | `delete` | `deleted` / user | `{kind, merchantName, amountMinor, type, status}` |
| Add account | `addAccount` | `accountRepository.create` | `account_created` / user | null |
| Update account (no UI yet; ready for R6) | `updateAccount` | `update` | `account_updated` / user | `{kind, fields}` |
| Remove account | `removeAccount` | `softDelete` (same transaction as `deleted_at` and the decision row) | `account_removed` / user | null |
| Restore account | `restoreAccount` | `restore` | `account_restored` / user | null |
| Settings sheet / ProfileSetup save | `updateProfile` | `settingsRepository.setMany` | `settings_changed` / user, one per changed key | `{kind, key, from, to}`, only for `approval_mode` and `auto_approve_threshold` |

Decisions and edge cases:
- **`created` is an extra type.** It is not in the prompt's type list, but D1 needs a "created" row, and a manual entry is not "detected".
- **No-change saves write nothing.** An edit that changes no field writes no audit row, and neither does an approval-settings save that changes nothing. A name-only save also writes nothing, and `user_name` is never audited.
- **Approve/reject on a non-pending item writes nothing.** Both actions already return early in that case (via `canTransition`).
- **Metadata is whitelisted.** `sanitizeAuditMetadata` rebuilds every payload from allowed fields only, so extra properties are dropped. A test proves this by passing in `sanitizedPreview`, `body` and `address`.
- **The `deleted` snapshot keeps the merchant name.** It stores merchant, amount, type and status so the feed can still describe the deleted record. The merchant is the parsed, user-visible field, never SMS text, sender or preview. Trade-off: that merchant name stays in `audit_events` after the transaction itself is deleted.
- **Deleted transactions keep their audit rows.** Their `transaction_id` points at a row that no longer exists. That is fine because SQLite foreign keys are off (no `PRAGMA foreign_keys`, and op-sqlite is not built with `SQLITE_DEFAULT_FOREIGN_KEYS`). If foreign keys are ever enabled, this design needs revisiting.
- **The optimistic approve/reject path is unchanged.** If the transaction fails, the change and its audit row both roll back and the store refreshes.

## Activity feed design

**Entry and layout**
- Opened from Home → greeting → settings sheet → "Activity" row at the top of the sheet. This is a stack screen, not a 5th tab.
- Header with a back button. SafeAreaView covers top and bottom, like Transaction Detail.

**Data**
- `useActivityFeed` reloads the first page on every focus (`useFocusEffect`) and loads more `onEndReached`.
- Page size is 30. The cursor is the keyset `(event_at, rowid)`, so events with the same timestamp are never skipped or repeated.
- `listRecent` also returns the `deleted` snapshot for each event's transaction (correlated subquery). This lets older events of a deleted transaction still name it.

**Rows**
- Each row is an icon, a sentence, a coloured impact line and a relative time ("Just now", "N min ago", "N h ago", or the time of day).
- Rows are grouped by day (Today / Yesterday / "20 Oct"), newest first.
- Impact colours use theme tokens: income = approved green, expense = onSurface, pending = pending amber, negative = failed red, neutral = outline.
- Sentences come from the pure `describeActivity` helper. Examples:
  - "You added QA-Merchant-07 ₹50.00" / "Waiting for approval"
  - "Detected X ₹Y from SMS" / "Waiting for approval · 90% match"
  - "Auto-approved X ₹Y at 90% match" / "Balance -₹Y"
  - "You approved X ₹Y" / "Balance -₹Y" (income shows "+₹Y")
  - "You edited X" / "Changed notes"
  - "You rejected X ₹Y" / "Not counted in balance"
  - "You deleted X ₹Y" / "No longer in balance (was -₹Y)", or "Removed from records" if it was not approved
  - "You removed account ••9999", "You restored account ••9999", "You added account …"
  - "You turned on/off auto-approve", "You set the auto-approve threshold to 85%" / "Was 90%"

**Tapping a row**
- Transaction rows open TransactionDetail.
- If the transaction was deleted, Detail shows "Transaction deleted / This record was removed. Its history stays in Activity." and does not crash.

**Empty and error states**
- Empty: "No activity yet / Approvals, edits, deletions and account changes will appear here as they happen."
- Load failure: "Could not load activity".

## Transactions filter design

**State**
- Filter state lives in the store as `transactionFilters`, so it survives tab switches. "Reset" clears it.

**Logic**
- One pure predicate, `matchesTransactionFilters`, combines the filters with AND:
  - type: all / expense / income
  - accountId
  - categoryId
  - query: matches merchant OR notes, case-insensitive and trimmed
- The list, the chip counts and the totals all use the same predicate, so they always agree.

**Chips**
- One horizontal row: All N, Expenses N, Income N, Account, Category, and Reset (shown only when a filter is active).
- Chip counts apply every filter except type, so each count shows what tapping that chip would list.

**Pickers**
- Account and Category each open a BottomSheet picker.
- The account picker lists "All accounts", then active accounts, then a "Deleted" heading with soft-deleted accounts, so their transactions stay findable.

**Labels when filtering**
- Inflow, Spent and Net reflect the filtered set.
- A "Totals reflect the current filters" note appears.
- The subtitle changes to "Showing N of M settled".
- With no matches: "No transactions match these filters."

**Search placeholder**
- Now "Search merchant or notes" (tags do not exist yet).

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (MainTabs, StatTile and Pending ItemSeparator, all already there before R1) |
| `npx jest` | 31 suites, 319 tests pass (+56) |
| `./gradlew assembleDebug` | OK (re-run after the final JS change) |

Test coverage for T6:
- **Audit per action:** one event per action, with the right type, actor and metadata, in the same transaction as the data write. Covers all 12 store paths plus the no-op cases.
- **syncSms:** manual mode writes `detected`×2. Auto mode writes `detected`/`auto_approved`×2 with `{confidence:90, threshold:90}`. A re-sync writes no new rows. No sender or SMS text appears in any metadata.
- **Repository:** the insert uses the given `tx`, never the database directly. The metadata whitelist strips extra fields. Cursor SQL and parameters are checked, the limit is clamped, and malformed metadata is tolerated.
- **Feed helper:** every sentence form, the deleted snapshot fallback, relative time and day grouping.
- **Filter predicate:** every filter dimension, the combinations, a whitespace-only query, a null note, chip counts and totals.
- **Migration 4:** idempotent across 3 runs, exact statements, still the last migration.

## Device checks (USB 00015365L001524, Metro + adb reverse, `adb install -r`)

How the device was handled:
- **Foreground guard:** `dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` had to show `com.tracker` on both lines, and the keyguard had to be off, before every tap, dump and key event. A failed guard aborts the command chain.
- **Dumps:** every dump was filtered to QA-… elements, fixed labels or counts, and `/sdcard/u.xml` was removed afterwards (verified absent at the end).
- **Off-limits:** no screenshots, no db/sqlite/run-as access, no Sync SMS, and no settings changes. The settings sheet was opened only to tap the Activity row.

| Check | Result | Evidence (QA data and labels only) |
|---|---|---|
| D1 | PASS | Added the QA-Merchant-07 50.00 expense on QA Delete Bank 9999; it landed in Pending. Approved it via the Review sheet, then edited notes to "QA note" (Detail shows Personal Note "QA note"). Activity showed "You added QA-Merchant-07 ₹50.00 / Waiting for approval", "You approved QA-Merchant-07 ₹50.00 / Balance -₹50.00" and "You edited QA-Merchant-07 / Changed notes". No other events existed. |
| D2 | PASS | Expenses chip: 2 rows incl. QA. Income chip: 0 rows ("No transactions match these filters."). Account filter = QA Delete Bank 9999: 1 row, the QA item; the "Deleted" heading appeared in the picker. Search "QA note": 1 row, the QA item. Reset restored "2 Settled · All Verified" and cleared search. |
| D3 | PASS | Deleted QA-Merchant-07 from Detail (confirm dialog → Delete). Activity added "You deleted QA-Merchant-07 ₹50.00". Tapping the deleted row, and an older approved row of the same item, showed "Transaction deleted". No crash. |
| D4 | PASS | Opened Review on a pending QA-Merchant-05: Approve Transaction (₹55), Edit and Reject; 0 Delete buttons. Back closed the sheet; both QA-Merchant-05 cards still pending. |
| D5 | PASS | Approval settings not changed; Sync SMS not tapped. |
| D6 | PASS | Force-stop + relaunch: Activity still shows all 4 QA-Merchant-07 events. Logcat (11,923 lines): 0 FATAL com.tracker, 0 AndroidRuntime FATAL, 0 "Maximum update depth", 0 ReactNativeJS errors. App force-stopped at the end; launcher in front. |

The deleted-row impact text was reworded during the device run, from "Removed from balance (-₹50.00)" to "No longer in balance (was -₹50.00)". The new text was seen on device after the relaunch.

Incidents: none. The guard never failed during a tap, and no other app was inspected.

## Leftover synthetic data on device

- **QA-Merchant-07:** created, approved, edited, then deleted, so no transaction remains. Its 4 audit rows (created, approved, edited, deleted) stay in `audit_events` by design and are shown in Activity.
- **QA Delete Bank 9999:** still ACTIVE (from Phase 16), unchanged.
- **2 pending QA-Merchant-05:** unchanged, not acted on.
- **Transactions screen:** the filter store state resets on app restart. Nothing persisted.
- **Owner data:** no real accounts, transactions or settings were touched. Settings are untouched; the greeting still reads "QA User", left over from Phase 13.

## Not verified / open

- **Device paths not exercised** (unit-tested only): `settings_changed`, `detected` and `auto_approved` (D5 forbids changing settings and tapping Sync SMS), plus account create/remove/restore audits.
- **`updateAccount` has no UI.** The store action and its audit exist for R6.
- **Category filter:** the picker and its predicate are covered by unit tests; the picker was not tapped on device.
- **Activity pagination beyond 30 rows:** not exercised on device (only 4 events exist). The cursor SQL is unit-tested.
- **Out of scope, noticed:** TransactionsScreen day headers still use the fixed `NOW = 2026-10-01` fixture (an existing TODO), so "TODAY/YESTERDAY" labels there are wrong.
- **Open trade-off:** the `deleted` snapshot keeps the merchant name in `audit_events` after deletion. If the user wants deletes to erase the merchant entirely, store only amount and type.
