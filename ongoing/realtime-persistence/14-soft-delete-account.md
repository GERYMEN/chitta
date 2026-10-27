# Phase 14: Soft-delete account (skill D10)

Executor: Claude subagent. Nothing was committed to git. No new dependencies.

## Gates

| gate | result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors. The same 3 pre-existing warnings (StatTile, PendingScreen). |
| `npx jest` | 24 suites, 251 tests pass (was 21 / 226). |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL. Only JS changed. |
| On-device D10 checks | **NOT RUN.** See "Device results". |

## Files changed (18)

**New (3):**
- `src/data/repositories/__tests__/account.softDelete.test.ts`
- `src/domain/accounts/__tests__/account.softDelete.test.ts`
- `src/features/transactions/state/__tests__/accountSelectors.test.ts`

**Modified (15):**
- `src/data/repositories/account.repository.ts`: adds `softDelete`, `restore` and `listDeletedDecisionKeys`.
- `src/features/sms-sync/normalizeAccountKey.ts`: adds two pure functions.
  - `bankCanonicalForText(text)` uses the same alias map as SMS bodies and returns `'unknown'` when no alias matches.
  - `accountKeyForAccount({name, type, lastFour})` builds the decision key.
- `src/domain/accounts/account.rules.ts`: adds `isDeletedAccount`, `activeAccounts`, `deletedAccounts` and `accountDisplayLabel`.
- `src/features/transactions/state/transactionsStore.ts`:
  - Hydrates with `listAllAccounts()`.
  - Adds the `removeAccount(id)` and `restoreAccount(id)` actions. Each calls the repository and then `refresh()`.
  - Exports `selectActiveAccounts` and `selectDeletedAccounts`. Both return new arrays, so every call site uses `useShallow`.
- `src/features/sms-sync/smsParser.ts`: `ParsedSmsTransaction` gains `bankCanonical`.
- `src/features/sms-sync/smsSyncLogic.ts`: adds `isOwnedByDeletedAccount` and `partitionCandidates`.
- `src/features/sms-sync/syncSms.ts`:
  - The no-accounts guard counts active accounts only.
  - Uses `partitionCandidates` with the deleted-decision keys.
- `src/features/home/screens/HomeScreen.tsx`: the total balance uses active accounts only.
- `src/features/accounts/screens/AccountsScreen.tsx`:
  - The total and main groups use active accounts only.
  - Each card has a "Remove account" action.
  - A "Deleted accounts (N)" section has a Restore button per account.
- `src/features/accounts/screens/AddAccountScreen.tsx`: the duplicate guard checks active accounts only.
- `src/features/transactions/screens/AddRecordScreen.tsx`: the "Add an account first" guard counts active accounts only.
- `src/features/transactions/components/TransactionForm.tsx`: the picker lists active accounts only, plus special handling for a removed account (see "Edit form" below).
- `src/features/transactions/components/TransactionDetailContent.tsx`: the meta line and the Account row both use `accountDisplayLabel`.
- `src/features/sms-sync/__tests__/smsSyncLogic.test.ts`: fixture gains `bankCanonical`; new D10 tests.
- `src/features/sms-sync/__tests__/normalizeAccountKey.test.ts`: new helper tests.

## Repository SQL

All SQL is parameterized. None of it touches the `transactions` table.

`softDelete(id)` first reads the account (`SELECT * FROM accounts WHERE id = ?`). It throws if the account is not found. Then it runs one `db.transaction`:
```sql
UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?          -- epoch ms, ISO, id
INSERT OR REPLACE INTO account_suggestion_decisions
  (bank_canonical, account_kind, last_four, decision, account_id, normalizer_version, decided_at)
  VALUES (?, ?, ?, 'deleted', ?, ?, ?)
```
The decision key is built as follows:
- `bank_canonical` is `bankCanonicalForText(account.name)`, or `'unknown'`.
- `account_kind` is `account.type`.
- `last_four` is `account.lastFour ?? ''`.

`restore(id)` also runs one `db.transaction`:
```sql
UPDATE accounts SET deleted_at = NULL, updated_at = ? WHERE id = ?
DELETE FROM account_suggestion_decisions WHERE account_id = ? AND decision = 'deleted'
```
It deletes by `account_id` instead of recomputing the key, so a restore still works if the account was renamed.

`listDeletedDecisionKeys()`:
```sql
SELECT bank_canonical, account_kind, last_four, normalizer_version
FROM account_suggestion_decisions WHERE decision = 'deleted'
```
It returns a set of `bank:kind:last4` strings.

I did not build `deleteAccountWithTransactions`.

## Filtering map

| site | uses |
|---|---|
| Home total balance | active (`useShallow(selectActiveAccounts)`) |
| Accounts total, "Across N" caption, main groups | active |
| Accounts "Deleted accounts (N)" section | deleted (`useShallow(selectDeletedAccounts)`) |
| Add Record and Edit picker (`TransactionForm`) | active, plus the removed current account (see below) |
| AddRecordScreen "Add an account first" guard | active count |
| AddAccountScreen duplicate guard (`findDuplicateAccount`) | active |
| syncSms "no-accounts" guard | active count |
| SMS matching (`partitionCandidates`) | active for matching; deleted accounts and deleted decisions for dropping |
| Transaction detail account label | all accounts (`state.accounts`), through `accountDisplayLabel` |
| Transactions list, Pending, Inflow/Spent/Net, Home month income/expense | unchanged. These read only `transactions`, so a removed account's records still show and still count. |
| TransactionRow / PendingTransactionCard | do not show an account name, so nothing to label |

**Label (`accountDisplayLabel`):**

| account state | label |
|---|---|
| deleted, with last four | `Deleted account ••1859 (<name>)` |
| deleted, no last four | `Deleted account (<name>)` |
| active | `<name> ••••1859`, or just the name |
| missing | `Unknown` |

**Edit form when the transaction's account was removed:**
- The removed account is shown first in the picker as a dashed, dimmed option, labelled "Deleted account ••XXXX (name)".
- It stays selected, with the note "This account was removed. The record stays on it unless you pick another account."
- Nothing is reassigned silently. The user can pick an active account, or tap the removed one again to keep the record on it.

## Sync drop rule (T4)

For each new candidate, after the hash dedup:
1. If its type and lastFour exactly match an **active** account, it is imported. Active accounts are always checked first.
2. Otherwise it is **dropped** (not imported and not suggested) if either of these is true:
   - It exactly matches a **soft-deleted** account, using the same type + lastFour rule.
   - Its normalized key `bankCanonical:accountKind:(lastFour ?? '')` has a `'deleted'` decision row.
3. Otherwise it becomes a "New Accounts Found" suggestion, as before.

Dropped messages count into `skipped`, which is still `scanned − created`.

**Restore instead of Add (D5):** because of step 2, a key that matches a deleted account never reaches the suggestion list. So I did not add a "Restore" button on suggestion rows. Restore is offered in the Accounts "Deleted accounts" section.

**Backfill after restore:** restoring clears `deleted_at` and the decision row. The next Sync SMS imports messages that arrived while the account was removed, within the existing 200-message inbox window. Dedup by `sourceReferenceHash` keeps it to one copy each. After a restore, a toast tells the user to tap Sync SMS.

**Known edge:** a removed account with no last four and a name that matches no bank writes the key `unknown:<type>:`. After that, unidentified-bank SMS of that type with no last four are dropped instead of suggested. Such SMS could never be auto-matched to an account anyway, because matching needs a last four. Only the suggestion is lost.

## UI (T5)

**Remove:**
- Each active account card has a "Remove account" row (trash icon, error colour, min height 48dp) under the balance.
- Tapping it opens a `showDialog` confirm. The Remove button uses the destructive variant, so the dialog cannot be dismissed by tapping outside it. The message reads: "Remove <name> ••1859? Its N transactions stay in your history but stop counting toward your balance. New SMS from this account won't be imported. You can restore it later."

**Deleted accounts section:**
- It sits under "Add New Money Source" and is collapsible (header min height 48dp, chevron). It is hidden when N is 0.
- Each card shows the D10 label, "N transactions kept · not in balance", and a ghost **Restore** button (48dp).
- Restore runs immediately, with no confirm, and shows a toast: "<name> restored. Tap Sync SMS to import messages from while it was removed."

## Tests (T6)

25 new tests:
- **Repository:**
  - softDelete runs exactly 1 transaction, with both writes inside it: the UPDATE and the decision INSERT with `deleted`. The key is hdfc/bank/1859.
  - An unknown name falls back to `unknown`/`''`.
  - restore runs 1 transaction: the UPDATE to NULL and the decision DELETE.
  - No SQL mentions `transactions`.
  - Ids and names never appear in the SQL text.
  - softDelete on a missing account throws without writing.
  - `listDeletedDecisionKeys` returns the expected keys.
- **Rules:** all 4 label forms; active/deleted split; the total balance over active accounts excludes the deleted account while its transaction stays in the list.
- **Selectors:** `selectActiveAccounts` and `selectDeletedAccounts`.
- **Normalizer:** `bankCanonicalForText` and `accountKeyForAccount`.
- **Sync drop:** these cases are covered:
  - exact match to a deleted account
  - a deleted decision key
  - the `''` sentinel for a candidate with no last four
  - never matching a deleted account
  - an active account wins over a deleted decision with the same key
  - unrelated candidates still become suggestions
  - a restored account matches again

## Device results — NOT VERIFIED

The device could not be tested this run:
- At the start, the owner said they were switching the phone from USB debugging to wireless debugging. I gave them the pairing steps (`adb pair` / `adb connect` / `adb reverse`).
- The device reconnected over USB briefly but kept dropping. `adb devices` came back empty several times, and the transport id changed from 125 to 128.
- The foreground check also failed for stretches. Each time I pressed HOME and relaunched, and I did not inspect the other window.
- The device then disappeared completely. I polled for more than 6 minutes and it never came back.

What did happen on the device:
- `adb install -r` succeeded and the app launched with the new JS, with `adb reverse` in place.
- On Accounts, three "Remove account" labels were rendered, which shows the new code had loaded. They were counted only.
- One tap on "Add Account" was sent. I could not confirm which screen it opened before the connection dropped. No account was created, because no form field was typed and no Save was tapped.
- At the time of the last successful check, logcat had 0 FATAL EXCEPTION, 0 AndroidRuntime lines for com.tracker and 0 ReactNativeJS errors.

| # | check | result |
|---|---|---|
| 1 | Add "QA Delete Bank 9999" and expense QA-Merchant-06 | not run (device lost) |
| 2 | Remove, total drops by 900, "Deleted accounts (1)" | not run |
| 3 | Transaction label, Spent total still includes it | not run. Label covered by unit tests. |
| 4 | Add Record picker excludes it | not run. Code review only. |
| 5 | Sync SMS, no crash | not run. Drop logic covered by unit tests. |
| 6 | Restore, total and picker back | not run |
| 7 | Leftover synthetic data | **none created** this run |
| 8 | Force-stop, relaunch, logcat | not run. The final force-stop could not be sent because the device was gone. |

- The owner's accounts, transactions and settings (name, approval mode, threshold) were not touched.
- The Accounts total was saved once, unprinted, to a scratch file to compute deltas later. That file was deleted without being read.
- To finish, rerun device checks 1–8 once `adb devices` shows the phone as stable. Use wireless with `adb reverse tcp:8081 tcp:8081` set again after connecting.

## Device safety

- Every dump was filtered to labels I wrote myself, or to label counts. `/sdcard/u.xml` was removed after each one.
- No SMS bodies, senders, merchants or amounts were printed.
- Nothing forbidden was used: no tracker.db, sqlite3 or run-as access, no uninstall, no clear-data, no screenshots.
- Leak scan of this report: it contains only UI labels, synthetic names, the spec's "••1859 (HDFC)" example and counts.
