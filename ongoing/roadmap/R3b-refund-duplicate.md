# R3b — Link refund + mark duplicate: report

Executor: Claude subagent. Date: 2026-10-30/31. Branch: `phase/R3b-refund-duplicate` (built on ee28691, R3a). Nothing was committed and nothing is staged.

## Summary

- **Gates: all pass.**
  - tsc is clean.
  - eslint has 0 errors and 2 warnings. Both warnings were already there (MainTabs, StatTile).
  - jest passes: 50 suites, 530 tests (484 before, so +46).
  - `assembleDebug` is OK, and so is `assembleRelease`.
- **Files changed: 42 source/test files** (24 modified, 1 deleted, 17 new), plus this report. `ongoing/roadmap/STATE.md` was already modified before this run and was not touched.
- **Device: D1–D5 NOT RUN, D6 PARTIAL.**
  - The owner was actively using the phone. Tracker was switched away through Recents seconds after I launched it, then a browser stayed in front with the screen awake for more than 10 minutes.
  - Per the safety rule ("something changed that you did not do → stop touching it"), I stopped all UI interaction.
  - No QA data was created and nothing on the phone was changed. Only the Add Record form was opened, and it was never saved.
  - The release build was re-installed with `adb install -r` (Success, data kept, not debuggable) without launching it over the owner's app. Tracker was then force-stopped.

## Files

**Modified (24)**

- `src/domain/transactions/transaction.types.ts`: LinkKind docs.
- `src/domain/transactions/transaction.rules.ts`:
  - New `isLinkedRefund` and `spendContributionMinor`.
  - `countsTowardIncomeExpense` excludes `duplicate`.
  - `incomeExpenseTotals` subtracts linked refunds from spend.
- `src/domain/audit/audit.types.ts` and `audit.rules.ts`:
  - 4 new event types with metadata.
  - A whitelist sanitizer for each.
- `src/data/db/migrations.ts`: migration 7.
- `src/test/fakeDb.ts`: primary key for `duplicate_pair_dismissals`.
- `src/features/transactions/state/transactionsStore.ts`:
  - `duplicateDismissals` state, loaded in `loadAll`.
  - New actions: `linkRefund`, `unlinkRefund`, `markDuplicate`, `restoreDuplicate`, `dismissDuplicatePair`.
  - New helper `linkedRefundsOf`.
- `src/features/sms-sync/smsSyncLogic.ts`:
  - `autoApproveAfterSync` also holds duplicate pairs.
  - New optional last parameter `duplicateDismissals` and new result field `heldForDuplicate`.
- `src/features/sms-sync/syncSms.ts`: passes duplicate dismissals and returns `heldForDuplicate`.
- `src/features/sms-sync/importSuggestion.ts`: the same hold for the R2b "Add account" import.
- `src/features/activity/activityFeed.ts`: refund and duplicate sentences and icons; `linkedTransaction` added to the context.
- `src/features/activity/screens/ActivityScreen.tsx`: looks up the other row by `expense_id` / `kept_id`.
- `src/features/transactions/components/TransactionDetailContent.tsx`: refund, duplicate and kept-row cards, plus the new actions.
- `src/features/transactions/screens/TransactionDetailScreen.tsx`:
  - Refund picker and duplicate picker.
  - Unlink and restore actions.
  - Delete guard.
- `src/features/transactions/screens/TransactionsScreen.tsx`: "Refund" tag on list rows.
- `src/features/home/screens/HomeScreen.tsx`:
  - The "N to review" card opens the Review screen.
  - "Refund" tag in Recent.
- `src/features/pending/screens/PendingScreen.tsx`: the inline transfer section is replaced by the shared `ReviewSections` (transfers + duplicates).
- `src/shared/ui/TransactionRow/TransactionRow.tsx`: optional `tag` prop.
- `src/app/navigation/routes.ts` and `RootNavigator.tsx`: new `Review` route.
- Tests updated:
  - `migrations.test.ts`: migration 7 is now the last one, plus 2 new migration 7 tests.
  - `importSuggestion.test.ts`: the fixture's third item moved 1 h later so it is not a duplicate, plus a new duplicate-hold test.
  - `syncSms.transfer.test.ts`: the result shape includes `heldForDuplicate`, plus new duplicate-hold tests.
  - `activityFeed.test.ts`: R3b sentences.

**Deleted (1)**

- `src/features/transfers/components/PossibleTransfersCard.tsx`, replaced by `src/features/review/components/ReviewCard.tsx`.

**New (17)**

- Domain:
  - `src/domain/refunds/refund.rules.ts`
  - `src/domain/duplicates/duplicate.rules.ts`
- Repository:
  - `src/data/repositories/link.repository.ts`: refund and duplicate persistence, one `db.transaction` per change.
- Duplicates feature:
  - `src/features/duplicates/duplicateLabels.ts`
  - `src/features/duplicates/useDuplicatePairs.ts`
  - `src/features/duplicates/components/DuplicatePairCard.tsx`
  - `src/features/duplicates/components/DuplicatePickerSheet.tsx`
- Refunds feature:
  - `src/features/refunds/refundLabels.ts`
  - `src/features/refunds/components/RefundCandidateSheet.tsx`
- Review feature:
  - `src/features/review/components/ReviewSections.tsx`
  - `src/features/review/components/ReviewCard.tsx`
  - `src/features/review/screens/ReviewScreen.tsx`
- Tests:
  - `refund.rules.test.ts`
  - `duplicate.rules.test.ts`
  - `audit.rules.refundDuplicate.test.ts`
  - `transactionsStore.refundsDuplicates.test.ts`
  - `features/duplicates/__tests__/labels.test.ts`

## Migration 7 (idempotent, no values)

```sql
CREATE TABLE IF NOT EXISTS duplicate_pair_dismissals (
    a_id TEXT NOT NULL,
    b_id TEXT NOT NULL,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id < b_id)
  )
```

- It is guarded by `schema_migrations` like 1–6 and runs in one `db.transaction`.
- It adds no column: refunds and duplicates reuse migration 6's `linked_transaction_id` / `link_kind`.
- There is no UPDATE, INSERT, DELETE, DROP or ALTER, and no existing row is rewritten.
- Dismissals are written by the repository with bound parameters:
  - SQL: `INSERT OR IGNORE INTO duplicate_pair_dismissals (a_id, b_id, dismissed_at) VALUES (?, ?, ?)`
  - The ids are ordered first (`orderedPairIds`).
- Tests: it runs once across 3 starts, contains only that statement, and is the last migration.

## Data model

**Refund**
- An income row with `link_kind = 'refund'` and `linked_transaction_id` = the original expense id.
- Its account, date and status are unchanged. Its `category_id` becomes the expense's category.
- The previous category is saved in the `refund_linked` audit metadata.
- **Unlink**:
  - Clears both link fields.
  - Restores the previous category, unless the user changed the category after linking. In that case the category is kept.
  - Pending refunds can be linked too ("keeps its own status").
- Only a pending or approved income that is not linked and not a transfer can be linked.
- Only a pending or approved expense that is not linked, not rejected and not a transfer can receive a refund.
- The expense row has no back-link. "Refunded" is computed from the live refunds (pending or approved) that point at it.

**Duplicate**
- The hidden row becomes `status = 'rejected'`, `link_kind = 'duplicate'`, `linked_transaction_id` = the kept id.
- It keeps its `source_reference_hash`, so re-sync never recreates it (tested end to end).
- The kept row is not changed.
- **Undo** follows the R3a pattern. `duplicate_marked` metadata stores `{kept_id, duplicate_id, previous}`, where `previous` is the TransferRowSnapshot shape: `type, status, categoryId, approvedAt, transferAccountId, linkedTransactionId, linkKind`.
- **"Not a duplicate"** reads the newest matching `duplicate_marked` event and restores those fields exactly, with `updatedAt` = now. Tests check deep equality against the original row.
- Marking an approved row as rejected is a system rule outside `canTransition`, the same as the R3a twin.

**Audit (one row per change, in the same `db.transaction`)**

| Event | Metadata |
|---|---|
| `refund_linked` | `{refund_id, expense_id, previous_category_id, category_id}` |
| `refund_unlinked` | `{refund_id, expense_id}` |
| `duplicate_marked` | `{kept_id, duplicate_id, previous{…enum/id/time}}` |
| `duplicate_restored` | `{kept_id, duplicate_id}` |

- Metadata never contains merchant text, SMS text or amounts. The sanitizer whitelist is tested with injected junk.
- Dismissals write no audit row.

## Totals rules — still the single helper

- `countsTowardIncomeExpense` returns false for a transfer, a `transfer_twin` or a `duplicate`, and true for a linked refund.
- `incomeExpenseTotals` (Home, Transactions Inflow/Spent/Net and day nets all go through it):
  - A linked refund is **not income**.
  - It reduces `expenseMinor` in whatever rows/period the caller passes, which is decided by the **refund's own date**.
  - A period with only a refund can show negative spend (cross-month test).
- `spendContributionMinor(t)` gives +amount for an expense, −amount for a linked refund and 0 otherwise. R4's per-category sums must use it.
- **Balances are unchanged:** `calculateBalance` still adds the refund income. A hidden duplicate is rejected, so it is out of balances and lists. This is tested (balance +50.00 after marking a 50.00 expense).

## Ranker and pairing rules

**`rankRefundCandidates(refund, txs)`**
- Candidates must be:
  - Expenses that are pending or approved and not linked, rejected or transfer.
  - With `amount − already refunded (excluding this refund)` ≥ the refund amount.
  - Occurred 0–90 days **before** the refund (inclusive).
- Ranking: same `normalizeMerchant` key → same account → closest date → id.
- Capped at 30 (`REFUND_CANDIDATE_LIMIT`).
- Tests: ranking order, the exact 90-day boundary, after-refund excluded, too-small / mostly-refunded excluded, status and link exclusions, and the cap.

**`validateRefundLink`**
- Possible errors: `same-row`, `not-a-refund-candidate`, `not-refundable`, `over-refund`.
- Over-refund means the sum of live refunds would exceed the expense amount. The UI shows a clear dialog.

**`findDuplicatePairs(txs, dismissals, windowMinutes = 10)`**
- A pair is:
  - Same account, same type (income or expense only) and same `amount_minor`.
  - `|Δt| ≤ window` (inclusive).
  - Both rows pending or approved, neither linked or a transfer.
  - Not dismissed (in either id order).
- Each row is in at most one pair: closest first, then the earlier first row, then ids. Output is newest pair first.
- Tests: window boundary in/out, custom window, 1 paisa off, different account, different type, three and four rows, tie, dismissed (and re-pairing with a third row), and every excluded status/link.

**Other rules**
- `defaultKeepId` keeps the approved row, otherwise the earlier one.
- `duplicatePickerOptions` (manual "Mark as duplicate of…") lists rows with the same account, type and amount within ±3 days, excluding itself and hidden rows, closest first.
- `useDuplicatePairs` also ignores rows on soft-deleted accounts (same as transfers).

**T4 — sync hold**
- After inserting, `autoApproveAfterSync` holds any eligible new item that is in a transfer pair OR a duplicate pair (with a new or an existing row).
- `syncSms` returns `heldForDuplicate`. The R2b import uses the same rule.

## UI

**Income detail**
- "Link to original expense" is shown for a pending/approved unlinked income.
- It opens a BottomSheet of ranked candidates. Each row shows merchant, "date · ₹amount" and "₹X left to refund".
- Tapping a row links it, followed by the snackbar "Linked as a refund". A refused link opens a dialog with the reason.

**Linked refund detail**
- A "Refund" card: "Not counted as income — it reduces what you spent…".
- A link "Refund for <merchant> · <date> ›" that pushes the expense.
- Type chip "Refund · reduces spending" and type "Refund".
- An "Unlink refund" action.

**Expense detail**
- A "Refunded ₹X" card listing each refund ("₹amount · date ›", tap → refund).
- **Delete guard:** deleting an expense that has linked refunds is blocked with "Unlink refunds first". A refund never points at a deleted expense.

**Lists (Home Recent, Transactions)**
- Linked refunds show a small "Refund" pill (approved-green tint).
- The amount stays "+₹" in `colors.primary`, the positive token per DESIGN.md (incoming credit).

**Pending**
- `ReviewSections` sits above the account groups: "Looks like a transfer · N" (R3a, unchanged behaviour), then "Possible duplicates · N".
- Each duplicate card shows:
  - The title "₹50.00 out twice on <account>".
  - Both rows as radio rows: "merchant · date/time", "Approved/Pending · Will be kept / Will be hidden". The default keep is preselected; tap a row to keep that one instead.
  - [Mark duplicate] (brand) and [Not duplicates] (ghost).
- Mark shows the snackbar "Marked as a duplicate" with an **Undo** button (restores exactly).
- The account chip narrows both sections.

**Home**
- One card, "N to review — Review ›", where N = transfer pairs + duplicate pairs.
- It opens the new **Review** screen ("To review", 48dp back target) with both sections.

**Hidden duplicate detail (from Activity or the kept row)**
- Chip "Duplicate · hidden".
- Card "Duplicate of <merchant>" with "View the kept item ›".
- The only action is "Not a duplicate". There is no category edit.

**Kept row detail**
- "1 duplicate hidden — View ›" (tap → the hidden row).
- Deleting a kept row warns that its hidden duplicate stays hidden.

**Manual "Mark as duplicate of…"**
- Shown on any pending/approved income/expense detail, but only when the picker would have options.
- The picked row is kept, the current one is hidden, then the screen goes back.

**Activity**
- Sentences, masked by default: "You linked a ₹ •••• refund to <merchant>", "You unlinked a ₹ •••• refund from <merchant>", "You marked <merchant> ₹ •••• as a duplicate", "You restored <merchant> ₹ •••• — not a duplicate".
- Impact lines: "Not income · reduces spending", "Counts as income again", "Hidden · not in totals or balances", "Back exactly as it was".
- The mask is the existing `MASKED_AMOUNT` ("₹ ••••") and the eye reveals amounts.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors, 2 pre-existing warnings |
| `npx jest` | 50 suites, 530 tests, all pass |
| `./gradlew assembleDebug` | OK |
| `./gradlew assembleRelease` | OK |

## Device checks

| Check | Result | Notes |
|---|---|---|
| D1 Refund | NOT RUN | The owner was using the phone (see below). |
| D2 Duplicate | NOT RUN | Same. |
| D3 Real counts | NOT RUN (partial) | The one fixed-label read of Home at launch showed no "to review" card, so the Home card count was 0 at that moment. The Pending "Possible duplicates" count was not read. |
| D4 Activity | NOT RUN | |
| D5 Cleanup | N/A | No QA rows were created. Logcat since the run started: 0 FATAL, 0 "Maximum update depth", 0 ReactNativeJS E. |
| D6 Release | PARTIAL | `assembleRelease` OK. `adb install -r` gave Success (no INSTALL_FAILED_UPDATE_INCOMPATIBLE, data kept). The package is not debuggable. **Not launched**, because a launch would have pulled Tracker over the app the owner was using. `am force-stop com.tracker` was done. |

**What happened**
1. At the start another app was in front. No call was active (`mCallState=0`), so I pressed HOME, then `adb install -r` of the debug APK, `adb reverse tcp:8081`, and `am start` (cold launch OK).
2. Metro was already running from this project.
3. Seconds later, logcat showed `startActivityFromRecents` for Tracker, which the executor did not do.
4. After one Home capture (stored privately, never printed, deleted afterwards) and one tap on Add Record, the guard found a browser in front.
5. I polled only the focused package name, wakefulness and keyguard state for about 9 minutes. The browser stayed in front, the screen was awake and not locked, so the owner was actively using the phone.
6. Following "if something changes on screen that you did not do, stop touching it and report", I made no further taps or dumps.
7. The other app was never inspected: only its package name from the focus line was read.
8. I then re-installed the release APK (no UI) so the owner is not left on a Metro-dependent debug build.

**Safety rules followed**
- Every tap and dump went through a guard that aborts unless BOTH `mCurrentFocus`/`mFocusedApp` contain com.tracker and the keyguard is not showing. It did abort.
- Dumps were filtered to fixed labels or coordinates.
- `/sdcard/u.xml` was removed each time.
- No database access, no screenshots, Sync SMS not tapped, nothing real was changed.

## Leftover synthetic data

- **None created in this run.** The Add Record form was opened and never saved.
- Older leftovers are unchanged: QA Delete Bank 9999 active, QA Wallet 8888 soft-deleted, older QA audit rows.

## Unit-test only (everything — the device part was not run)

All of the following are covered by unit tests only:

- **Refunds**
  - Totals: same month, cross-month, partial, multiple, over-refund rejected with no writes, unlink restores totals and category.
  - Balance unchanged by a link.
  - Ranker ranking and limits.
- **Duplicates**
  - Pairing edges.
  - Mark/restore exact (approved and pending), including totals −50 and balance +50.
  - Dismissal: ordered ids, `INSERT OR IGNORE`, no audit row.
- **Sync hold:** pure, end-to-end `syncSms`, and the R2b import.
- **Migration 7:** idempotent.
- **Audit:** events written in one `db.transaction`; no SMS text, merchant or amounts in the metadata; sanitizer.
- **Activity sentences:** masked and revealed.
- **Labels.**
- **Not tested anywhere:** the UI on a device (pickers, cards, Review screen, Undo snackbar, delete guard).

## Decisions I made

1. **Linkable refunds** are pending OR approved unlinked incomes (the spec says the refund "keeps its status"). The Link action appears in the full detail screen, not in Pending's review sheet.
2. **The refund category becomes the original's at link time.** The previous category is stored in `refund_linked` metadata (ids only). Unlink restores it unless the user changed it since.
3. **Over-refund counts only live refunds** (pending/approved). A rejected refund frees its amount again.
4. **Cross-period refunds can make a period's spend negative.** This is honest math per "reduces spend in the refund's period", with no clamping.
5. **`spendContributionMinor` was added** for R4 per-category sums.
6. **Deleting an expense with linked refunds is blocked** with "Unlink refunds first". This avoids orphan refunds that would keep reducing spend.
7. **Deleting a kept row leaves its hidden duplicate hidden** (same as the R3a twin). The dialog says so.
8. **The duplicate card uses radio rows plus [Mark duplicate] / [Not duplicates]** instead of two "Keep this one" buttons. The default keep is preselected and shown as "Will be kept / Will be hidden".
9. **Mark duplicate shows a snackbar with Undo**, which restores exactly.
10. **The Home card opens a new Review screen** with both sections. Pending shows the same sections at the top through the shared `ReviewSections`. `PossibleTransfersCard` was replaced by `ReviewCard`.
11. **"Mark as duplicate of…" is only offered when there is a matching row** (±3 days), to keep the detail footer short.
12. **Duplicate suggestions ignore rows on soft-deleted accounts** (UI hook). `findDuplicatePairs` keeps the spec signature, without accounts. The sync hold uses all rows.
13. **Migration 7 adds `CHECK (a_id < b_id)`**, and the repository orders the ids.
14. **`autoApproveAfterSync` got an optional trailing `duplicateDismissals` parameter**, keeping existing callers and tests source-compatible. An item in both a transfer pair and a duplicate pair counts as `heldForTransfer`.
15. **A refund's list amount stays "+₹" in the positive green token**, with a "Refund" pill.

## Open / limits

- **Editing a linked row is not guarded:**
  - Changing a refund's type, or lowering an expense amount below what is already refunded, is allowed.
  - The totals helper requires `type === 'income'` for a refund, so a type change makes it count as a plain expense with a stale link.
  - Consider guarding this in a later phase.
- **The device run needs a retry** when the owner is not using the phone: D1–D5 and the D6 launch + logcat.

---

# Follow-up R3b.1 (2026-10-31): code and gates only, no device work

There was no adb tap, no dump and no install in this follow-up. The phone was not free.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors, 2 pre-existing warnings |
| `npx jest` | 53 suites, 544 tests, all pass (+14 vs R3b) |
| `./gradlew assembleDebug` | OK. No native change, so Gradle reported the build up to date. |

**Files:** 12 touched in R3b.1 (3 newly modified, 5 new, and 4 already changed in R3b). The branch total is now 50 source/test files plus this report.

## F1: edit guard for linked rows

**New: `src/domain/links/linkedEdit.rules.ts`** (pure)
- `canEditTransaction(t)` is false for a `transfer_twin` or a `duplicate`.
- `linkedEditError(before, {type, amountMinor}, transactions)` returns `{field: 'type'|'amount', reason, limitMinor?}` or null:

| Row being edited | Change | Result |
|---|---|---|
| Linked refund | type changed away from income | `refund-type` error on Type |
| Linked refund | amount above what is still refundable on its expense (other live refunds count) | `refund-over` error on Amount |
| Expense with live refunds | type changed (to income or transfer) | `expense-type` error on Type |
| Expense with live refunds | amount below the sum already refunded | `expense-below-refunded` error on Amount |
| Hidden row (twin or duplicate) | any edit | `hidden` |

- Rejected refunds do not hold the expense.

**New copy: `linkedEditMessage(error)` in `src/features/refunds/refundLabels.ts`**
- "A linked refund must stay income. Unlink the refund first."
- "Refunds for this expense would be more than what was spent (₹X left to refund)."
- "This expense has linked refunds. Unlink them first."
- "Cannot be less than the ₹X already refunded."
- "This item is hidden and cannot be edited. Restore it first."

**`TransactionForm`**
- New optional `validate(values)` prop, run on submit after zod passes.
- A refusal goes through `setError(field, message)`, shows inline under Type or Amount, and blocks the submit.
- There is now a `FieldError` under the Type row.

**`EditTransactionScreen`**
- Passes `validate={guardLinked}`.
- A hidden twin or duplicate gets a short "cannot be edited" message instead of the form.
- These rows were already not offered Edit on Detail.

**Store**
- `updateTransaction` refuses with no write when the guard fails, and now returns `Promise<boolean>`.
- `markAsTransfer` returns that result, so an expense with refunds cannot become a transfer.

**Detail**
- "Mark as transfer" is hidden for an expense with linked refunds.

**Tests**
- `linkedEdit.rules.test.ts`: 5 tests.
- `TransactionForm.validate.test.tsx`: the message renders inline and the submit is blocked; an allowed edit submits.
- Store tests: refused edits write nothing, allowed edits still pass, a hidden duplicate is not editable.

## F2: Uncategorised rows (user request)

**New: `src/features/categories/components/UncategorisedRow.tsx`**, used by `UncategorisedScreen.tsx`.

- **Top row**:
  - The tappable body shows merchant + amount (`AmountText` with paise), then "date · account label · Pending". Tapping it opens TransactionDetail.
  - The "Uncategorised" chip is a separate pressable. The R2 picker and "Always use…?" flow are unchanged.
- **SMS rows only** (`sourceType === 'sms'`):
  - An "SMS description" label above the stored `sanitizedPreview`, limited to 2 lines; tapping toggles the full text.
  - `OriginalSmsView` with `parseSmsReference(sourceReferenceHash)`, which provides the "View original SMS" link.
  - The original is read live only when tapped and held only in that component's state. It is never written to the store, the database or logs, and it is dropped on hide or unmount.
- **Manual rows** have no SMS section.
- **Tests (`UncategorisedRow.test.tsx`, 5)**:
  - An SMS row shows the description and exactly one link; a manual row shows neither.
  - The description is 2 lines and expands on tap.
  - Body tap opens the item; chip tap opens the picker.
  - Tapping the link calls the live read once; the raw text appears only in the rendered component; `getDatabase` is never called; the store never contains the raw text.

## R3b.1 decisions

1. **The guard lives in the domain and returns reason codes.** UI copy lives in `refundLabels.ts`, so the domain does not import shared formatting.
2. **It is enforced twice:** inline in the Edit form, and in the store as a no-write `false` as defence in depth (this also covers Mark as transfer).
3. **A linked refund's amount is also capped** at what is still refundable. This goes beyond the prompt's type rule but follows the same over-refund rule.
4. **An expense with linked refunds cannot change type at all** (to income or transfer), not only on amount.
5. **Hidden rows show a message screen** if Edit is ever reached. Detail never offers Edit for them.
6. **The Uncategorised row now shows the amount.** This reverses the R2 note "Amounts are not shown" because the user asked for it. The account label uses `accountDisplayLabel`.
7. **The SMS section shows only for `sourceType === 'sms'`.** The link shows only when the hash parses as an SMS reference; the description shows only when a preview is stored.

## Device part (later, only when the orchestrator says the phone is free)

D1–D6 from R3b, plus the F2 check: count the "View original SMS" links on the Uncategorised screen only. Never tap one on a real row and never print row text.
