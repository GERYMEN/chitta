# R2 — Smart categories (+ T0 Activity amount privacy): report

Executor: Claude subagent. Date: 2026-10-29. Not committed.

## Summary

- **Gates:** all pass.
  - tsc is clean.
  - eslint has 0 errors (the same 3 warnings that existed before R2).
  - jest passes: 36 suites, 368 tests (319 before R2, so +49).
  - `assembleDebug` is OK.
- **Device:** D1–D6 PASS over USB on serial 00015365L001524. Only synthetic QA data was created or changed. Two device steps were not fully done, and one leftover remains; details are in "Device checks" and "Leftover synthetic data on device".
- **BUGS.md B1:** not touched, as instructed.

## Files changed (51)

Modified (34):
- `src/app/App.tsx`: mounts `SnackbarHost`.
- `src/app/navigation/routes.ts` and `RootNavigator.tsx`: new `Categories` and `Uncategorised` stack screens.
- `src/data/db/migrations.ts`: migration 5.
- `src/data/db/connection.ts`: the base category seed now runs *before* the numbered migrations (see the decisions section).
- `src/data/mappers/category.mapper.ts`: maps `archived_at` and `color`.
- `src/data/repositories/category.repository.ts`: `getById`, `create`, `update` and `archive`. Each writes its audit row in the same `db.transaction`.
- `src/data/repositories/transaction.repository.ts`: new `setCategories`, a bulk category change in one `db.transaction` that writes one `edited` audit row per item.
- `src/domain/audit/audit.types.ts` and `audit.rules.ts`: new event types `rule_saved`, `rule_deleted`, `category_created`, `category_updated` and `category_archived`, with whitelisted metadata.
- `src/domain/categories/category.types.ts`: `archivedAt` and `color` on `Category`, plus a new `MerchantRule` type.
- `src/features/activity/activityFeed.ts`: `showAmounts` masking and sentences for the new event types.
- `src/features/activity/screens/ActivityScreen.tsx`: eye toggle in the header.
- `src/features/home/screens/HomeScreen.tsx`: Uncategorised card, custom category visuals, and the "Categories" settings route.
- `src/features/transactions/screens/TransactionsScreen.tsx`: Uncategorised card in the header, an "Archived" section in the category filter, and custom visuals.
- `src/features/pending/components/PendingTransactionCard.tsx`: shows the "(archived)" label and an amber chip for Uncategorised.
- `src/features/profile/components/ProfileSettingsSheet.tsx`: new "Categories" row.
- `src/features/sms-sync/smsSyncLogic.ts`: `resolveCategoryIdForSms` rewritten.
- `src/features/sms-sync/syncSms.ts`: passes the merchant rules in and counts `uncategorised`.
- `src/features/sms-sync/syncToast.ts`: adds ", N uncategorised" when N > 0.
- `src/features/transactions/components/TransactionForm.tsx`: the picker uses `pickableCategories`, so archived categories are hidden and the item's current category is kept.
- `src/features/transactions/components/TransactionDetailContent.tsx`: the Category row can be tapped (when `onChangeCategory` is passed) and shows the "(archived)" label.
- `src/features/transactions/screens/TransactionDetailScreen.tsx`: category picker sheet, followed by the remember flow.
- `src/features/transactions/screens/EditTransactionScreen.tsx`: the remember flow runs after a save that changed the category.
- `src/features/transactions/state/transactionsStore.ts`:
  - new `merchantRules` state;
  - new actions `saveMerchantRule`, `deleteMerchantRule`, `ruleTargets`, `applyCategoryChanges`, `undoCategoryChanges`, `addCategory`, `updateCategory` and `archiveCategory`.
- `src/shared/constants/categoryVisuals.ts`: Uncategorised visual, `CATEGORY_COLOR_SWATCHES`, and `getCategoryVisual(id, category?)`.
- `src/shared/ui/index.ts`: exports Snackbar.
- `src/test/fakeDb.ts`:
  - supports `INSERT OR IGNORE` and `ON CONFLICT … DO UPDATE`;
  - supports DELETE and SELECT by any column;
  - adds the `merchant_rules` primary key.
- `src/test/fixtures/categories.fixture.ts` and the tests that needed the new `Category` fields: `mappers.test`, `smsSyncLogic.test`, `syncSms.audit.test`, `activityFeed.test` and `migrations.test`.

New (17):
- `src/domain/merchants/normalizeMerchant.ts`
- `src/domain/categories/category.rules.ts`
- `src/data/repositories/merchantRule.repository.ts`
- `src/features/categories/rememberCategory.ts`
- `src/features/categories/components/CategoryPickerSheet.tsx`
- `src/features/categories/components/CategoryFormSheet.tsx`
- `src/features/categories/components/UncategorisedCard.tsx`
- `src/features/categories/screens/CategoriesScreen.tsx`
- `src/features/categories/screens/UncategorisedScreen.tsx`
- `src/shared/ui/Snackbar/Snackbar.tsx`
- `src/shared/ui/Snackbar/snackbarStore.ts`
- `src/shared/ui/Snackbar/index.ts`
- Tests (5):
  - `normalizeMerchant.test.ts`
  - `category.rules.test.ts`
  - `transactionsStore.categories.test.ts`
  - `rememberCategory.test.ts`
  - `snackbarStore.test.ts`

## Migration 5 SQL

```sql
CREATE TABLE IF NOT EXISTS merchant_rules (
    merchant_key TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
ALTER TABLE categories ADD COLUMN archived_at TEXT
ALTER TABLE categories ADD COLUMN color TEXT
INSERT OR IGNORE INTO categories (id, name, parent_id, type, icon, is_system) VALUES ('cat-uncategorised', 'Uncategorised', NULL, 'both', 'help-circle-outline', 1)
```

How it runs:
- It goes through the existing `schema_migrations` guard, in its own transaction.
- No old migration was edited.
- `is_system` already exists in the base `CREATE TABLE categories` on every install, so it is not re-added.
- `color` is an extra column. It stores the theme colour key of a custom category; the hex value is never stored.

What it does not touch:
- No `transactions` statement exists in migration 5, so the owner's existing rows keep their categories. A test asserts this.

Seed order fix (in `connection.ts`):
- The base 6-category seed only runs when the table is empty.
- If it ran after migration 5, a fresh install would see 1 row (Uncategorised) and never get the 6 base categories.
- The seed now runs first. A test covers the fresh-install order.

## normalizeMerchant rules (`src/domain/merchants/normalizeMerchant.ts`)

1. Lowercase and trim.
2. Remove UPI handles: `@…` up to the next whitespace (`qacafe@okhdfcbank` → `qacafe`).
3. Remove apostrophes (`joe's` → `joes`). Every other non-alphanumeric character becomes a space.
4. Collapse whitespace.
5. Repeat until nothing changes:
   - drop a trailing reference tail (`ref`, `reference`, `txn`, `utr` or `rrn`, optionally followed by `no`/`id`/`number` and an id);
   - drop trailing tokens that contain 3 or more digits;
   - never drop the first token.

Short numbers (1–2 digits) are kept, so `QA-Merchant-07` and `QA-Merchant-08` stay distinct (`qa merchant 07` and `qa merchant 08`). The result is an empty key for empty or symbol-only input; rules are never saved for an empty key. The function is pure and idempotent.

## Rule / apply / undo flow (`rememberCategory.ts`)

**When it runs.** After any category change on one item:
- the Edit form save;
- the Detail Category row (tap → picker sheet);
- quick-assign.

The change itself is the normal `updateTransaction`, audited as `edited` with fields `['categoryId']`.

**`rememberDecision`:**
- No prompt if:
  - the category did not change;
  - the new category is Uncategorised;
  - the merchant key is empty.
- If the rule already points to this category, it skips "Always?" and goes straight to the apply offer.
- Otherwise it shows a Dialog: "Always use <Category> for <merchant>?" with [Just this one] and [Always].

**On Always:**
- `merchant_rules` is upserted (re-pointing a rule keeps its `created_at`).
- A `rule_saved` audit row is written in the same transaction:
  - metadata is `{kind, categoryId}` only;
  - it also carries the `transaction_id` of the triggering item, so Activity can say "You set QA-Merchant-08 to always use Food & Dining".

**Apply offer:** "Apply to N other <merchant> items?" with [Not now] and [Apply to N].
- N counts other **pending and approved** items with the same merchant key whose category is **different** from the target.
- Self, rejected items and items already in the target category are excluded.

**Apply:**
- `applyCategoryChanges` re-reads the live categories, then calls `transactionRepository.setCategories`.
- That is one `db.transaction` with one `edited` audit row per item (`['categoryId']`).
- The store is updated in place.

**Undo:**
- A snackbar shows for 5 s: "Moved N items to X" with an UNDO action.
- `undoCategoryChanges(invertChanges(applied))` restores each item's exact previous category id.
- The undo is one more transaction, audited as `edited` per item.
- The undo can run only once, and a new snackbar replaces the old one and its timer.

**SMS (T3).** `resolveCategoryIdForSms(categories, type, merchant, rules)`:
1. The normalized merchant rule wins, if its category exists, is not archived and fits the type.
2. Otherwise the item goes to `cat-uncategorised`.
3. It returns null only if neither exists.

There are no Shopping or Salary & Wages defaults any more. `SmsSyncResult.uncategorised` counts the new items that landed in Uncategorised.

**Uncategorised (T4):**
- `UncategorisedCard` shows "N uncategorised — Categorise ›", where N counts pending + approved items. It renders nothing when N is 0.
- The card appears on Home under the stat tiles and in the Transactions list header.
- It opens the `Uncategorised` screen. Each row shows merchant, date and "· Pending", plus an "Uncategorised ▾" chip that opens the picker (Uncategorised itself is hidden in that picker). No amounts are shown.
- Assigning a category uses the same remember flow.

## Category management (T5)

**Entry:** Home greeting → settings sheet → "Categories" row, under "Activity".

**Screen sections:**
- "New category" button.
- "Your categories": custom categories that are not archived. Tapping one opens the edit sheet.
- "System": a lock icon and "System categories cannot be renamed or archived."
- "Archived": shown only when non-empty, labelled "X (archived)".
- "Merchant rules": each rule shows its merchant key and "Always <Category>", with a 48dp remove button that asks for confirmation and is audited as `rule_deleted`.

**Create sheet (`CategoryFormSheet`):**
- Name: required, at most 30 characters, case-insensitive unique.
- Type: Expense, Income or Both. The type cannot be changed after creation.
- Icon: one of a fixed set of 16 MaterialCommunityIcons.
- Colour: one of a fixed set of 6 keys (green, lime, amber, slate, grey, red), each mapped to existing theme tokens.

**Editing:** rename, icon and colour, plus "Archive category" with a confirm dialog.

**Archiving:**
- Only `archived_at` is set; nothing is ever hard-deleted.
- Archived categories are hidden from the Add/Edit form, the Detail picker and the quick-assign picker.
- Exception: an item already in an archived category keeps it listed in its own Edit form, so it is never silently cleared.
- Items keep the label "X (archived)" in Detail, Pending cards and the filter chip.
- The Transactions *filter* still lists archived categories under an "Archived" heading, so their items stay findable.

**Guards:** system categories cannot be renamed or archived, in both the UI and the repository (which throws).

**Audit:** `category_created`, `category_updated` (`fields`: name/icon/colour) and `category_archived`, each written with `{kind, categoryId}` in the same transaction as the change. A no-op edit writes nothing.

## T0 — Activity amount privacy

- `describeActivity(event, context, { showAmounts })` defaults to `showAmounts: false`.
- Masked mode:
  - every amount in the sentence and the impact line becomes `₹ ••••`, with no sign (for example "Balance ₹ ••••" and "No longer in balance (was ₹ ••••)");
  - merchant names stay visible, including those of deleted items.
- The header eye button:
  - is 48×48 dp (144 px on this device);
  - uses `eye-outline` / `eye-off-outline` from react-native-vector-icons;
  - has `accessibilityLabel` "Show amounts" or "Hide amounts".
- State is a plain `useState`. It resets to hidden on every focus (`useFocusEffect`) and is never persisted.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (MainTabs, StatTile, PendingScreen; all existed before R2) |
| `npx jest` | 36 suites, 368 tests pass |
| `./gradlew assembleDebug` | OK (exit 0) |

T6 test coverage:

| Area | What the tests check |
|---|---|
| normalizeMerchant | case/space, UPI handles, punctuation, ref/utr/txn tails, id tokens, short numbers kept, first token kept, idempotent, empty input |
| Rule precedence in `resolveCategoryIdForSms` | rule beats Uncategorised; an archived, missing or wrong-type rule falls through; never Shopping/Salary |
| syncSms | a rule files the item and the rest go to Uncategorised; the `uncategorised` count is correct |
| Apply-to-past + undo (store, fake DB) | correct targets; one transaction; one `edited` audit per item; Undo restores exact ids, including a mixed `{Uncategorised, Shopping}` set |
| Remember flow | Always → rule → "Apply to 1" → snackbar → Undo calls; "Just this one"; no prompt for Uncategorised or no change; skip when the rule already matches |
| Rule save/delete audit | `rule_saved` has `{categoryId}` only and no merchant text; written in the same transaction |
| Archive keeps labels | `archived_at` set; no UPDATE or DELETE on transactions; label "(archived)" |
| Pickers exclude archived | including the keep-current and type rules |
| System categories | cannot be archived or renamed |
| Migration 5 | idempotent over 3 runs; the Uncategorised seed SQL runs once, as `INSERT OR IGNORE`; no transactions statements; fresh-install seed order |
| T0 masking | default masked, explicit masked, revealed; no amount digits leak |
| Snackbar | 5 s auto-hide; action runs once; replacement timer |

## Device checks (USB 00015365L001524, Metro + adb reverse, `adb install -r`)

How the device was handled:
- **Foreground guard:** before every tap, dump, key event and text input, `dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` had to show `com.tracker` on both lines and `isKeyguardShowing` had to be false. A failed guard aborted the chain.
- **Dumps:** every dump was grep-filtered to QA-… strings, fixed UI labels or counts. `/sdcard/u.xml` was removed after each dump and was verified absent at the end.
- **Off-limits:** no screenshots, no db/sqlite/run-as access, no uninstall or clear-data, and no settings changes.

| Check | Result | Evidence (QA data and labels only) |
|---|---|---|
| D1 | PASS | Activity opened with "Show amounts". Every visible amount was masked: 30 × "₹ ••••", 0 unmasked. The QA-Merchant-07 rows read "You added/approved/deleted QA-Merchant-07 ₹ ••••", "Balance ₹ ••••" and "No longer in balance (was ₹ ••••)". The eye toggled the label to "Hide amounts" and the rows to "₹50.00". The eye bounds are 144×144 px (48dp). After going back and reopening, the label was "Show amounts" again, with 0 unmasked amounts. |
| D2 | PASS | Added two expenses, QA-Merchant-08 10.00 and 20.00, on QA Delete Bank 9999, both in Uncategorised (so D4 has a QA row). Edited the 10.00 item to Food & Dining → "Always use Food & Dining for QA-Merchant-08?" → Always → "Apply to 1 other QA-Merchant-08 item?" → Apply. The snackbar read "Moved 1 item to Food & Dining" and both QA cards showed Food & Dining. Undo at about 3 s put the 20.00 item back to Uncategorised (10.00 stayed Food). Redo: from the 10.00 item's Detail picker, changed to Shopping ("Just this one"), then back to Food & Dining. The rule already matched, so the "Always?" step was skipped → "Apply to 1 other" → Apply. Both items ended in Food & Dining. Activity shows the rule_saved sentence and the edited rows. |
| D3 | PASS | Settings sheet → Categories → New category: "QA Category" (Expense, paw icon, amber), created under "Your categories". Assigned it to the 20.00 QA-Merchant-08 item from the Detail picker; "Always use QA Category…?" → Just this one. Archived it (confirm dialog). It moved to the "ARCHIVED" section as "QA Category (archived)", and the Pending card for the item read "QA Category (archived)". The Add Record expense picker offered Food & Dining, Shopping and Uncategorised, but not QA Category. |
| D4 | PASS | See below. |
| D5 | PASS (counts only) | See below. |
| D6 | PASS | See below. |

D4 detail (counts only, plus QA rows):
- Home card at first launch, before any QA action: "1 uncategorised". Real item(s), not inspected.
- During D2, after Undo: "2 uncategorised" (+1 QA).
- Quick-assign listed one QA-Merchant-08 row. No real rows were read or assigned.
- The Transactions header card was also seen, reading "2 uncategorised" after D5.

D5 detail (Sync SMS tapped exactly once):
- Pending went from 2 waiting to 6 waiting, so 4 new pending items.
- Uncategorised went from 1 to 2, so 1 of the new items landed in Uncategorised. The other 3 were presumably filed by merchant rules that already existed (see the observations below).
- Sync opened "New Accounts Found". That screen was not dumped; I pressed BACK.
- No crash.

D6 detail (cleanup):
- Pending items have no Delete action, so I approved both QA-Merchant-08 items from their Review sheets (amounts ₹20 and ₹10 confirmed in each sheet first). Then I deleted both from Detail, after searching Transactions for "QA-Merchant-08": the search went from "Showing 2 of 57" to "Showing 0 of 55". I cleared the search afterwards.
- Removed the QA rule from Categories → Merchant rules: there is now 0 "Remove rule for qa merchant 08".
- Force-stopped and relaunched: Home showed "4 waiting" and "2 uncategorised"; QA Category was still archived; the QA rule was still gone.
- Logcat (23,041 lines since it was cleared at the start of the device run):
  - 0 FATAL in `com.tracker`. The 1 FATAL present belongs to another app's process.
  - 0 "Maximum update depth".
  - 0 ReactNativeJS errors.
  - The Metro log has 0 app errors; its only ERROR line is a devtools connection timeout.
- `com.tracker` force-stopped at the end.

### Incidents and environment events

**Phone locked at start (`isKeyguardShowing=true`).** I polled passively, with no interaction, and it unlocked within 5 s.

**Brief guard failures during screen transitions.** Each time the chain aborted; I re-checked focus and continued only once both lines showed `com.tracker`.

**Incoming call during D5 prep.** Dialer was in front with `mCallState=2`. Nothing was tapped or inspected while I waited. After the call ended, I pressed HOME and relaunched Tracker, per the rule.

**Red box after the call.** Tracker showed a red box: the bundle failed to load because `adb reverse` was lost when the USB connection reset during the call. I only checked class names and the first labels of the native red box (a stack trace, no user data). I restored `adb reverse`, then force-stopped and relaunched.

**Another app in front at the end.** The owner was probably using the phone. I stopped the UI chain and did not press HOME. The remaining steps (logcat counts and force-stop) needed no UI.

**Keyboard suggestion appended text.** A Save tap made while the keyboard was up hit a suggestion and added " by" to the QA merchant field. I fixed the field to exactly "QA-Merchant-08" before saving. From then on, the keyboard was hidden with BACK only when `mInputShown=true`. One BACK while a bottom sheet was open closed that sheet (the QA Category form); I reopened it.

**Unexplained re-mask.** Once in Activity, the amounts I had revealed went back to masked without any navigation I made. I could not reproduce it: three dumps after a fresh reveal stayed "Hide amounts". This direction is the safe one (more private, never less).

### Observations for the orchestrator (counts only, nothing inspected)

- **Merchant rules not created by me.** When I first opened Categories, at least one merchant rule ("Always F&B") already existed. After my QA rule was removed, 7 rule rows remain.
- **Pre-existing Uncategorised item.** Home showed "1 uncategorised" before any QA action.
- **Likely cause.** The run spanned several hours of device time (logcat timestamps reach 23:21 local), and the owner was using the phone (a call, another app in front). Owner use of the new build is the likely explanation for both.
- **Not touched.** None of these rules or items were read beyond counts, and none were touched.

## Leftover synthetic data on device

**QA Category.** Archived and kept by design: there is no hard delete, and archive is the only removal path in R2. It is still listed under "Archived" in Categories.

**Audit rows** (they stay in `audit_events` by design and are visible in Activity):
- **QA-Merchant-08:** created ×2; edited (Edit save, apply, undo, redo path, QA Category assign); rule_saved; rule_deleted; approved ×2; deleted ×2.
- **QA Category:** category_created and category_archived.

**Unchanged from R1:**
- QA Delete Bank 9999 is still ACTIVE.
- QA-Merchant-07 has 4 audit rows.

**QA-Merchant-05 items.** R1 left 2 pending QA-Merchant-05 items. "2 waiting" at the start of this run suggests they may no longer be pending, but I did not inspect the Pending list beyond QA-Merchant-08.

**Transactions search.** Cleared; filters reset on restart anyway.

**Owner data.** No real transaction's category, account or setting was changed, and no real quick-assign row was touched. The only owner-visible effect of this run is Sync SMS (D5), which created 4 new pending items, as the prompt allowed.

## Decisions made

1. **Uncategorised is a single type-neutral row** (`cat-uncategorised`, type `both`, `is_system=1`). One id serves expense and income, so the nudge, the rules and the filter have one thing to look for. It is offered in the Add/Edit form but hidden in the quick-assign picker.
2. **Apply count excludes items already in the target category**, as well as self and rejected items. Applying would not change them, and counting them would make "Apply to N" misleading.
3. **When the rule already points to the chosen category, "Always?" is skipped** and only the apply offer is shown. No prompt is shown for Uncategorised or an unchanged category.
4. **The `rule_saved` audit carries `transaction_id` of the triggering item**, so Activity can name the merchant. Its metadata is `{categoryId}` only, as specified.
5. **Two event types were added that the prompt did not list.** `rule_deleted` covers the merchant-rules remove UI (needed for D6 cleanup). Undo of an apply is audited as `edited` per item.
6. **New `categories.color` column** in migration 5. It stores a theme colour key; the type of a category is fixed after creation.
7. **The Transactions *filter* keeps archived categories** under an "Archived" heading so old items stay findable. All *assignment* pickers exclude them.
8. **Archive is the only removal path for categories.** There is no hard delete, even for unused ones. Restore was not built.
9. **Activity amounts reset to hidden on every focus**, including returning from Detail, not just on a fresh open.
10. **The undo control is a new shared `Snackbar`** (store + host, 5 s, one action), because ToastAndroid cannot carry an Undo action.
11. **The base category seed was moved ahead of the numbered migrations.** Without this, fresh installs would miss the 6 base categories.

## Not verified / open

- **`category_updated` (rename/icon/colour) on device:** unit-tested only.
- **Restore of an archived category:** does not exist.
- **Uncategorised screen back arrow:** one tap on it (a 22dp icon with hitSlop, the same pattern as other headers) did not register; system BACK worked. The same small-target pattern exists on other headers.
- **Quick-assign assignment on device:** not exercised. Only QA rows could be assigned, and the QA item was assigned through Detail instead. The flow is shared code and is unit-tested.
- **Logcat coverage:** the buffer was cleared at the start of the device run, and 23k lines remained at the end. Rotation may have dropped early lines.
