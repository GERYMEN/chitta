# R3a — Transfers between own accounts: report

Executor: Claude subagent. Date: 2026-10-30. Built on f658ae8 (R2 + R2b). Nothing was committed.

## Summary

- **Gates: all pass.**
  - tsc is clean.
  - eslint has 0 errors and 2 warnings. Both warnings were already there (MainTabs, StatTile).
  - jest passes: 45 suites, 484 tests (415 before, so +69).
  - `assembleDebug` is OK.
- **Device (USB 00015365L001524):** D1–D6 all PASS.
  - Only synthetic QA data was created, changed or deleted.
  - No real pair was confirmed or dismissed by the executor.
  - Sync SMS was not tapped.
  - There were no screenshots and no database access.
- **Files changed: 52 source/test files** (39 modified, 13 new), plus this report.

## Files

Modified (39):

**Data layer**
- `src/data/db/migrations.ts`
  - Migration 6.
  - A statement can now be `{ sql, params }`, executed with bound parameters.
  - `TRANSFER_CATEGORY_SEED`.
- `src/data/mappers/transaction.mapper.ts`: maps `transfer_account_id`, `linked_transaction_id` and `link_kind`.
- `src/data/repositories/transaction.repository.ts`
  - The 3 new columns.
  - `buildTransaction` defaults them to null.
  - New exported `updateTransactionTx(tx, row)`, which `update` now uses.

**Domain**
- `src/domain/transactions/transaction.types.ts`
  - `TransactionType` adds `'transfer'`.
  - `LinkKind = 'transfer_twin' | 'refund' | 'duplicate'`.
  - Optional fields `transferAccountId`, `linkedTransactionId` and `linkKind`.
- `src/domain/transactions/transaction.rules.ts`: `countsTowardIncomeExpense` and `incomeExpenseTotals`.
- `src/domain/accounts/account.rules.ts`: `calculateBalance` handles transfers on both sides.
- `src/domain/categories/category.rules.ts`
  - `TRANSFER_CATEGORY_ID`, `isHiddenCategory` and `visibleCategories`.
  - `pickableCategories` never offers cat-transfer.
  - `uncategorisedItems` and `ruleApplyTargets` exclude transfers and twins.
- `src/domain/audit/audit.types.ts`
  - New event types `transfer_paired` and `transfer_unpaired` with their metadata.
  - The `deleted` snapshot gets an optional `transferAccountId`.
- `src/domain/audit/audit.rules.ts`
  - Whitelist sanitizer for the new metadata.
  - `transferAccountId` is an editable field.
  - Changed-field check treats undefined as null.

**Features**
- `src/features/transactions/state/transactionsStore.ts`
  - `transferDismissals` state (loaded in `loadAll`).
  - Actions: `addTransfer`, `updateTransfer`, `markAsTransfer`, `confirmTransferPair`, `dismissTransferPair`, `undoTransfer`.
  - A deleted transfer's snapshot keeps its "to" account id.
- `src/features/transactions/filters/transactionFilters.ts`
  - `TypeFilter` adds `'transfer'`.
  - The account filter matches either side.
  - `typeCounts.transfer`.
  - `totalsFor` goes through the helper.
- `src/features/transactions/components/transactionForm.schema.ts`: shared `amountFieldSchema`, plus `transferFormSchema` (zod refine from ≠ to, error on `toAccountId`).
- `src/features/transactions/components/TransactionForm.tsx`: optional third "Transfer" chip in the Type row.
- `src/features/transactions/components/TransactionDetailContent.tsx`
  - Transfer and twin rendering.
  - "Mark as transfer" and "Undo transfer" actions.
  - The status chip now says "Rejected" for rejected rows (it used to say "Approved").
- `src/features/transactions/screens/AddRecordScreen.tsx`: Expense / Income / **Transfer** tabs.
- `src/features/transactions/screens/EditTransactionScreen.tsx`: a transfer opens TransferForm.
- `src/features/transactions/screens/TransactionDetailScreen.tsx`
  - Mark-as-transfer picker.
  - Undo dialog.
  - Twin → "View transfer" link.
  - Paired-transfer delete warning.
- `src/features/transactions/screens/TransactionsScreen.tsx`
  - "Transfers N" chip.
  - Day net via the helper.
  - Transfer row subtitle.
  - cat-transfer hidden from the category filter.
- `src/features/home/screens/HomeScreen.tsx`
  - Income and expense via the helper.
  - "N possible transfers — Review ›" card.
  - Transfer subtitle in Recent.
- `src/features/pending/screens/PendingScreen.tsx`: "Looks like a transfer · N" section above the account groups.
- `src/features/activity/activityFeed.ts`
  - "You moved ₹ •••• from A to B".
  - New event types and icons.
  - Transfer-aware impact lines.
- `src/features/activity/screens/ActivityScreen.tsx`: passes the from/to accounts of transfer subjects.
- `src/features/accounts/screens/AccountsScreen.tsx`: transaction count includes both sides of a transfer.
- `src/features/categories/screens/CategoriesScreen.tsx`: hides cat-transfer.
- `src/features/sms-sync/smsSyncLogic.ts`: `autoApproveAfterSync` (pure).
- `src/features/sms-sync/syncSms.ts`
  - Inserts everything first, then auto-approves.
  - Paired items are held.
  - `heldForTransfer` in the result.
- `src/features/sms-sync/importSuggestion.ts`: the same hold rule after an R2b "Add account" import.

**Shared**
- `src/shared/ui/AmountText/AmountText.tsx`: transfer = no +/−, neutral `colors.secondary` ink.
- `src/shared/constants/categoryVisuals.ts`: `cat-transfer` visual (swap-horizontal, secondary tokens).
- `src/test/fakeDb.ts`: primary key for `transfer_pair_dismissals`.

**Tests updated:** migrations, mappers, account.rules, category.rules, transaction.rules, activityFeed, transactionForm.schema, transactionFilters, and syncSms.audit (new auto-approve order).

New (13):
- `src/domain/transfers/transfer.rules.ts`
  - `findTransferPairs`, `isPairCandidate` and `pairedTransactionIds`.
  - `confirmTransferPair` and `undoTransferPair` (pure).
  - `snapshotTransferRow`, `findTransferTwin`, `touchesAccount`, `transferDirection` and `markAsTransferPatch`.
- `src/data/repositories/transfer.repository.ts`: `listDismissals`, `dismissPair`, `confirmPair`, `undoPair` and `latestPairing`.
- `src/features/transfers/transferLabels.ts`: route, row subtitle, pair title/dates and Home label.
- `src/features/transfers/useTransferPairs.ts`: memoised pairs hook. It is not a store selector, so it does not hand back a new array on every render.
- `src/features/transfers/components/TransferPairCard.tsx`
- `src/features/transfers/components/PossibleTransfersCard.tsx`
- `src/features/transfers/components/TransferAccountPickerSheet.tsx`
- `src/features/transactions/components/TransferForm.tsx`
- Tests:
  - `src/domain/transfers/__tests__/transfer.rules.test.ts`
  - `src/domain/audit/__tests__/audit.rules.transfer.test.ts`
  - `src/features/transfers/__tests__/transferLabels.test.ts`
  - `src/features/transactions/state/__tests__/transactionsStore.transfers.test.ts`
  - `src/features/sms-sync/__tests__/syncSms.transfer.test.ts`

## Migration 6 (parameterized, idempotent)

```sql
ALTER TABLE transactions ADD COLUMN transfer_account_id TEXT
ALTER TABLE transactions ADD COLUMN linked_transaction_id TEXT
ALTER TABLE transactions ADD COLUMN link_kind TEXT
-- params: ['cat-transfer', 'Transfer', 'both', 'swap-horizontal']
INSERT OR IGNORE INTO categories (id, name, parent_id, type, icon, is_system) VALUES (?, ?, NULL, ?, ?, 1)
CREATE TABLE IF NOT EXISTS transfer_pair_dismissals (
    debit_id TEXT NOT NULL,
    credit_id TEXT NOT NULL,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (debit_id, credit_id)
  )
CREATE INDEX IF NOT EXISTS ix_tx_linked ON transactions(linked_transaction_id)
```

- Guarded by `schema_migrations` like 1–5, and runs in one `db.transaction`.
- There is no UPDATE, DELETE or DROP: existing rows are never rewritten, and the new columns start NULL.
- The seed id is bound as a parameter, never interpolated. Tests assert this.

## Data model

**Transfer: ONE row.**
- `type = 'transfer'`
- `account_id` = **from**
- `transfer_account_id` = **to**
- `category_id = 'cat-transfer'`
- `status = 'approved'`

Variants:
- **Manual (Add Record → Transfer):**
  - `merchant_name = 'Transfer'`, `payment_method = 'bank'`, `source_type = 'manual'`.
  - Notes go in `note`.
- **SMS pair:** the debit row *becomes* the transfer and keeps its merchant, hash and preview.
- **Mark as transfer:** the existing row becomes the transfer.
  - Expense on A → "to" B: `account_id` stays A.
  - Income on A → "from" B: `account_id` becomes B, `transfer_account_id` becomes A.

**Twin (SMS credit half of a confirmed pair):**
- The same row is kept with `status = 'rejected'`, `link_kind = 'transfer_twin'` and `linked_transaction_id = <transfer id>`.
- It keeps its `source_reference_hash`, so re-sync dedup never recreates it.
- It is in no list, total or balance: rejected rows are excluded by status, and `countsTowardIncomeExpense` also excludes twins.
- Its detail (reachable from Activity) shows a "Part of a transfer" chip and card with "View transfer ›".
- The transfer side has no back-link column. "Was paired" means a twin points at it (`findTransferTwin`).

**Undo storage (decision): audit metadata, no extra columns.**
- `transfer_paired` metadata contains:
  - `{ kind, debit_id, credit_id, previous: { debit, credit } }`
  - Each snapshot is `{ type, status, categoryId, approvedAt, transferAccountId, linkedTransactionId, linkKind }`.
  - These are enum values, ids and one ISO time only. There is never merchant text, an amount or SMS text, and a whitelist sanitizer enforces this.
- "Undo transfer" reads the newest `transfer_paired` row for the transfer.
- It then restores both rows' snapshot fields exactly; `updated_at` = now.
- It writes `transfer_unpaired { debit_id, credit_id }`.
- Confirm and undo each run in ONE `db.transaction`: 2 row UPDATEs + 1 audit row.

## Pairing rules (`findTransferPairs`, pure)

- **What makes a pair:** an expense on own account A plus an income of the **exact** same `amount_minor` on own account B.
- **Accounts:** A ≠ B, and both accounts active (not soft-deleted).
- **Time window:** `|occurredAt diff| ≤ windowHours` (default 24, inclusive).
- **Row status:** both rows are pending or approved, neither is a transfer, linked (`link_kind`/`linked_transaction_id` set) or rejected/invalid, and the pair is not in `transfer_pair_dismissals`.
- **Each row is in at most one pair:**
  - Candidates are ranked by time difference.
  - On a tie, the pair whose earlier row happened first wins, then the earlier debit, then ids.
  - Pairs are taken greedily.
- Output is ordered newest debit first.
- **Unit-tested edge cases:**
  - 24 h boundary (in), 24 h + 1 ms (out), both directions, and a custom window.
  - Same account.
  - ±1 paisa.
  - Three-way ambiguity (two credits, and two debits).
  - Tie → earliest.
  - Greedy leftovers.
  - Dismissed pair, including the credit re-pairing with another debit.
  - Rejected, invalid, transfer, twin and linked rows.
  - Pending + approved mix.
  - Deleted account.
  - Same type on both sides.
- **"It's a transfer"** (`confirmTransferPair`) re-validates the pair and refuses a stale one with no writes.
  - The debit gets `approvedAt` = now if it was pending, and keeps its own `approvedAt` if it was already approved.
  - A twin that was approved goes to rejected. This is a system-defined transition that deliberately bypasses `canTransition`; Undo puts it back.
- **"Not a transfer"** does `INSERT OR IGNORE` into dismissals. It writes no audit row (no money changes), and the suggestion disappears.

## Totals helper call-site map — `countsTowardIncomeExpense` / `incomeExpenseTotals`

| Total | Call site |
|---|---|
| Home INCOME / EXPENSES | `HomeScreen.tsx` → `incomeExpenseTotals(approved)` |
| Transactions INFLOW / SPENT / NET | `transactionFilters.ts totalsFor` → `incomeExpenseTotals` |
| Transactions day-section "Net" chip | `TransactionsScreen.tsx` → `incomeExpenseTotals(data).netMinor` |
| Uncategorised count + quick-assign list | `category.rules.ts uncategorisedItems` → `countsTowardIncomeExpense` |
| Merchant-rule "Apply to N" targets (per-category re-filing) | `category.rules.ts ruleApplyTargets` → `countsTowardIncomeExpense` |
| Activity impact line | `activityFeed.ts balanceImpact`: transfer → "Moved between your accounts · not income or expense"; created/edited/paired transfer → neutral transfer copy, never Balance ± |
| Per-category sums | none exist yet. R4 must use `incomeExpenseTotals` (noted) |

- Balances are not an income/expense total: `calculateBalance` handles transfers itself.
  - from −, to +.
  - Pending and rejected rows don't count, and anchors are respected.
- Home TOTAL BALANCE, which excludes cards, is unchanged by a transfer between two non-card accounts.
- **Credit cards:**
  - A bank → card transfer raises the card balance toward 0, so the outstanding amount (|balance|) goes down, and lowers the bank balance.
  - This is unit-tested: card spend 3,000, then a 1,200 payment → owed 1,800, and the bank goes down by 1,200.

## T4 — SMS sync

- `syncSms` now inserts **all** new pending rows first, then calls `autoApproveAfterSync(created, allTransactions, accounts, dismissals, mode, threshold)`.
- A new row that forms a pair with another new row OR with an existing pending/approved row is **not** auto-approved. It stays pending, and `heldForTransfer` is counted in the result.
- Every other new row follows the unchanged `shouldAutoApprove`.
- Side effect: in auto mode the audit order is now detected… then auto_approved… (it used to be interleaved). The test was updated to match.
- The R2b "Add account" import (`importSuggestion.ts`) uses the same hold rule.
- Dedup by `sourceReferenceHash` is unchanged. A test confirms a re-sync after confirming a pair creates 0 rows.

## UI

**Pending**
- A "Looks like a transfer · N" section with a short explainer sits above the account groups, under the filter chips.
- There is one card per pair:
  - "₹X from <A> to <B>"
  - "Out: <when> · In: <when>"
  - [It's a transfer] (brand) and [Not a transfer] (ghost), each followed by a snackbar.
- Pairs include approved rows.
- The account chip narrows the list to pairs that touch that account.

**Home**
- "N possible transfers — Review ›" appears when N > 0, on secondary-container tokens below the Uncategorised card.
- It opens Pending.

**Add Record**
- The Type row has Expense / Income / **Transfer**.
- Transfer shows TransferForm:
  - From-account and To-account radio lists (active accounts; a11y labels "From <name>" / "To <name>").
  - Amount, date/time and note.
  - No category.
- zod refine: from ≠ to.
- Saved approved with a `created` audit, then navigates to Transactions.

**Edit transfer**
- The same form, with From, To, amount, date and note.
- Audited `edited` with the changed field names.

**Detail**
- Approved income/expense: "Mark as transfer".
  - Bottom sheet: "Moved to which account?" for an expense, "…from…" for an income. Own account excluded.
  - Snackbar afterwards.
- Transfer:
  - "Transfer · not income or expense" chip.
  - "From A → To B" line.
  - Type "Transfer", From and To rows.
  - No category row.
  - If it was paired: "Undo transfer" with a confirm dialog.
  - Deleting a paired transfer warns that the twin stays hidden and suggests Undo instead.
- Twin: "Part of a transfer" chip and card with "View transfer ›" (push to the transfer). It has no actions.

**Lists**
- Transfer rows use the swap-horizontal icon on secondary tokens and an unsigned amount in `colors.secondary`.
- The subtitle is "A → B · time". In a per-account view it becomes "Out to B" on A and "In from A" on B.

**Transactions**
- A "Transfers N" chip.
- The account filter matches either side.
- cat-transfer is not in the category filter.

**Activity**
- created / paired / mark-as-transfer events read "You moved ₹ •••• from A to B" (masked unless the eye is on).
  - Impact lines: "Between your accounts · not income or expense", "Confirmed as a transfer · …" and "Marked as a transfer · …".
- Undo reads "You undid a transfer of ₹ ••••" / "Both items restored as they were".
- A deleted transfer shows "Balances moved back".

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors, 2 pre-existing warnings |
| `npx jest` | 45 suites, 484 tests, all pass |
| `./gradlew assembleDebug` | OK |

## Device checks

**Setup**
- `adb install -r` and `adb reverse tcp:8081 tcp:8081`.
- Metro was already running from this project.
- At the start another app was in front. I pressed HOME (no call was active; `mCallState=0`) and launched Tracker. The other app was never inspected.

**Device-safety rules followed**
- Every tap and dump went through a guard script that **aborts** unless every `mCurrentFocus`/`mFocusedApp` line contains com.tracker and the keyguard is not showing.
- Dumps were read by a filter that prints only QA strings, fixed labels, counts or coordinates.
- `/sdcard/u.xml` was removed after each dump.
- Real Home totals were compared only as keyed HMACs; the key and HMACs were deleted afterwards.

| Check | Result | Evidence (QA values only) |
|---|---|---|
| D1 | PASS | "QA Wallet 8888" (cash, opening 0) was missing, so I created it. Balances: QA Delete Bank 9999 = ₹1,000.00, QA Wallet 8888 = ₹0.00. Home TOTAL/INCOME/EXPENSES captured (not printed). |
| D2 | PASS | Add Record → Transfer 500.00, from QA Delete Bank 9999 to QA Wallet 8888, notes "QA transfer". Bank ₹500.00 (−500), wallet ₹500.00 (+500). Home TOTAL SAME, INCOME SAME, EXPENSES SAME. |
| D3 | PASS | Add Record expense QA-Merchant-09 100.00 on the QA bank → pending. I approved this QA item (manual records start pending; Mark as transfer is for approved items). Bank ₹400.00. Detail → Mark as transfer → To QA Wallet 8888 → snackbar "Marked as a transfer"; detail shows "From QA Delete Bank 9999 ••••9999 → To QA Wallet 8888" and no Undo (not paired). Bank ₹400.00 (unchanged vs after the expense), wallet ₹600.00 (+100). Home TOTAL/INCOME/EXPENSES SAME as D1. |
| D4 | PASS | The Transactions "Transfers" chip showed both QA transfers (rows: "QA-Merchant-09" and "Transfer", subtitle "QA Delete Bank 9999 ••••9999 → QA Wallet 8888 · <time>"). Chip count 3 = 2 QA + **1 other row** (see note). Activity showed 3 QA rows "You moved ₹ •••• from QA Delete Bank 9999 ••9999 to QA Wallet 8888": D2 created, QA-09 created, QA-09 marked. |
| D5 | PASS | Home card: **1** possible transfer. Pending "Looks like a transfer · **1**" (1 card). Neither button was tapped. |
| D6 | PASS | Both QA transfers deleted (search "QA" + Transfers chip → 0). QA balances back to bank ₹1,000.00 and wallet ₹0.00. QA Wallet 8888 removed via Accounts → Remove (soft delete, 0 transactions). Force-stop + relaunch: Home TOTAL/INCOME/EXPENSES SAME as D1. Logcat (22,286 lines since the clear before the run): 0 FATAL (any process), 0 FATAL com.tracker, 0 "Maximum update depth", 0 ReactNativeJS E, 0 ReactNativeJS W. Ended with `am force-stop com.tracker`. |

**Note: one real transfer was not created by the executor.**
- Activity showed one non-QA "You moved …" row with the impact "Confirmed as a transfer", dated about 32 minutes before the D4 check. This is about 2–3 minutes after the new build was installed, before D1, and while the executor had only taken dumps and was on the Accounts tab.
- At first launch the app was already on the Pending tab, although the initial route is Home. So the owner was very likely using the phone and tapped "It's a transfer" on a real pair. This matches the R2 note that the owner uses builds during runs.
- The executor never opened a pair card before D5 and tapped nothing on it. The row was left untouched.
- The orchestrator may want to confirm this with the owner. "Undo transfer" on that row restores both items if it was unintended.

## Leftover synthetic data

- **QA Wallet 8888:** cash account, soft-deleted. It is listed under Accounts → "Deleted accounts" and has 0 transactions.
- **Audit rows:**
  - `created`, `edited`, `approved` and `deleted` rows for QA-Merchant-09 and the QA transfer.
  - `account_created` and `account_removed` for QA Wallet 8888.
- **Unchanged from before:** QA Delete Bank 9999 is active (₹1,000.00, as before), and the other older QA accounts are as they were.

## Unit-test only (not exercised on device)

- **Confirm a pair ("It's a transfer") and Undo transfer**, including the exact restore, the `transfer_paired`/`transfer_unpaired` audit and one db.transaction. No real pair may be touched, and no synthetic SMS can be created on the phone.
- **"Not a transfer"** (dismissal).
- **Twin detail** ("Part of a transfer" / "View transfer").
- **Sync holding paired items from auto-approve**, and the same rule on an R2b import.
- **Edit transfer form** (updateTransfer audit fields).
- **Mark as transfer for an INCOME** ("from").
- **Credit-card bill-payment sign math.**
- **Migration 6 on a fresh install** (the device ran it as an upgrade).
- **Per-account "Out to / In from" subtitles** (the device used no account filter).

## Decisions I made

1. **Manual transfers are saved APPROVED.** Add Record income/expense stays pending.
   - A transfer is the owner moving their own money, not a detection, and it never touches income or expense.
   - D2 expects balances to move at once.
   - Audited `created` (actor user).
2. **Undo data lives in `transfer_paired` audit metadata** (ids + previous enum/id/time fields of both rows), not new columns. Undo reads the newest such event.
3. **Only the twin carries the link.** The transfer row has `linked_transaction_id = NULL`; "paired" = a twin points at it.
4. **Mark as transfer also moves the category to cat-transfer.** The `edited` audit lists the fields that really changed:
   - Expense: `['type','categoryId','transferAccountId']`.
   - Income: `['type','categoryId','accountId','transferAccountId']`.
   - The prompt said `['type','transferAccountId']`; I kept the audit truthful.
   - There is no Undo for a marked (unpaired) transfer: Undo is only for SMS pairs. Delete or re-add instead.
5. **The confirm path sets twin status to rejected even when it was approved.** This is a system rule outside `canTransition`; Undo restores it.
6. **Dismissals write no audit row** (no money change).
7. **cat-transfer is type 'both'** and is hidden from every picker, the category filter and the Categories management list.
8. **Pairing excludes rows on soft-deleted accounts,** and the pairs list is memoised in a hook, never computed in a store selector (avoids re-render loops).
9. **Activity shows "You moved …"** for transfer `created`, `transfer_paired` and mark-as-transfer `edited` events. Because sentences use the live row, the original `created` event of a later-marked expense also reads "You moved …".
10. **`payment_method` of a manual transfer = 'bank'** (label "Bank Transfer"), and its merchant text is "Transfer".
11. **Deleting a paired transfer leaves its twin rejected/linked** (still deduped and hidden). The delete dialog says so and points to Undo.
12. **The detail status chip now says "Rejected" for rejected rows.** Before, every non-pending row showed "Approved". This was needed so the twin shows correctly.
