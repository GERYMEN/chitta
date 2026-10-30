# R2b — "New accounts found" clarity + Pending refresh/auto-approve: report

Executor: Claude subagent. Date: 2026-10-30. Builds on the uncommitted R2 working tree. Nothing was reverted and nothing was committed.

## Summary

- **Gates: all pass.**
  - tsc is clean.
  - eslint has 0 errors and 2 warnings. Both warnings were already there; there were 3 before, and the PendingScreen one is now fixed.
  - jest passes: 40 suites, 415 tests (368 before, so +47).
  - `assembleDebug` is OK.
- **Device (USB 00015365L001524):**

  | Check | Result |
  |---|---|
  | D1 | PASS |
  | D2 | PASS |
  | D3 | PASS |
  | D4 | **N/A.** The precondition was false: the owner's approval mode is **ON**. The observed ON-path behaviour is correct. |
  | D5 | PASS |

  - No real suggestion was added, linked or ignored.
  - No setting, account or transaction was changed.
  - The only owner-visible effect is the single Sync SMS tap, which created 0 new pending items.
- **Files changed: 25.** 15 were modified and 10 are new (4 of the new files are tests).

## Files

Modified (15):
- `src/features/sms-sync/smsSyncLogic.ts`
  - `suggestionKeyFor` and `decisionKeyFor`.
  - `SuggestionDecisions`, plus a 4th, optional parameter on `partitionCandidates` (routes and ignored keys).
  - `buildSmsPendingRow` / `buildSmsTransactionInput`. Sync and Add now share one row builder.
  - `SMS_PARSER_VERSION` moved here.
- `src/features/sms-sync/syncSms.ts`
  - Loads the decision rows (`toSuggestionDecisions`).
  - Builds the suggestion session and returns `suggestionRunId`.
  - Uses the shared row builder.
- `src/features/sms-sync/screens/SmsSuggestionsScreen.tsx`: full redesign (see UI).
- `src/data/repositories/account.repository.ts`
  - `buildAccount` and `insertAccountTx`, both run in the caller's transaction.
  - `writeDecisionTx`, `listSuggestionDecisions` and `ignoreSuggestion`.
- `src/data/repositories/transaction.repository.ts`: `buildTransaction` and `insertTransactionTx`. `create` now uses them, with no behaviour change.
- `src/features/transactions/state/transactionsStore.ts`
  - New `importSuggestion` and `ignoreSuggestion` actions.
  - `AutoApproval.actor` (default `'system'`).
- `src/app/navigation/routes.ts`
  - `SmsSuggestions: { runId }`.
  - `AddAccount.suggestion?: { runId, key }`.
  - `Pending: { accountId?, focusKey? }`.
- `src/app/providers/AppProviders.tsx`: `NavigationContainer ref={navigationRef}`.
- `src/features/home/screens/HomeScreen.tsx`: navigates with `{ runId }` only.
- `src/features/accounts/screens/AddAccountScreen.tsx`: a suggestion-sourced Add inserts the card's items, then shows the snackbar.
- `src/features/pending/screens/PendingScreen.tsx`: full redesign (see UI).
- `src/domain/settings/approval.rules.ts`: `thresholdNoteText()`, the single copy of the threshold-note wording.
- `src/features/profile/components/ProfileForm.tsx`: uses `thresholdNoteText()`. The text is unchanged.
- `src/features/activity/activityFeed.ts`: `auto_approved` with actor `user` reads "You auto-approved X at N% match".
- `src/features/activity/__tests__/activityFeed.test.ts`: the fixture now states actor `system` for its system auto-approve row.

New (10):
- `src/features/sms-sync/suggestionGroups.ts`
  - `SuggestionGroup` and `groupUnmatchedCandidates`.
  - `proposedAccountBaseName` and `proposedAccountTitle`.
  - `summarizeGroup`, `suggestionsSummaryLine`, `waitingLabel`, `linkableAccounts` and `formatShortDateRange`.
- `src/features/sms-sync/suggestionSession.ts`: a zustand module-level session cache, keyed by run id.
- `src/features/sms-sync/importSuggestion.ts`
  - `preparePendingRows`.
  - `addSuggestedAccount`, `linkSuggestion` and `ignoreSuggestionGroup`.
  - `importSnackbarMessage` and `showImportSnackbar`.
- `src/data/repositories/suggestion.repository.ts`: `importSuggestion`, a single `db.transaction`.
- `src/app/navigation/navigationRef.ts`: `navigationRef` and `openPendingForAccount`.
- `src/features/pending/pendingGroups.ts`
  - `groupPendingByAccount` and `pendingSectionTitle`.
  - `autoApproveEligible`, `autoApproveButtonState` and `autoApproveConfirmTitle`.
- Tests:
  - `src/features/sms-sync/__tests__/suggestionGroups.test.ts`
  - `src/features/sms-sync/__tests__/importSuggestion.test.ts`
  - `src/features/sms-sync/__tests__/syncSms.session.test.ts`
  - `src/features/pending/__tests__/pendingGroups.test.ts`

There are no migrations, because the decisions table already exists with `added | linked | ignored | deleted`. `account_suggestion_candidates` is untouched (counts only).

## Data flow: sync → suggestion cache → add → pending

1. **Sync SMS** (`syncSms`):
   - Parse the messages and dedup them by `sourceReferenceHash` (unchanged).
   - Run `partitionCandidates(fresh, accounts, deletedKeys, decisions)`, which checks in this order:
     1. Exact type + last-4 match with an **active** account. This rule is unchanged and always wins.
     2. An `added`/`linked` decision for the normalized key. It routes to that account if the account is active. If that account is soft-deleted, the SMS is dropped.
     3. A soft-deleted owner (D10), or an `ignored` key. Either one drops the SMS.
     4. Otherwise the SMS is unmatched.
   - Matched items are inserted as pending, exactly as before.
   - Unmatched items go to `groupUnmatchedCandidates`, which groups them per suggestion key and keeps the parsed candidates.
   - `useSuggestionSession.start(groups)` returns a `runId`.
   - The result carries only `suggestionRunId` and the count-only `suggestions`.
2. **Navigation.** Home navigates to `SmsSuggestions { runId }`. Nav params carry only the id: no SMS data and no candidates.
3. **The session:**
   - It lives in memory only. It is not in nav params, not in SQLite and never logged.
   - A new sync replaces it. Add, Link and Ignore remove the decided card.
   - An app restart drops it; the next sync rebuilds it, and dedup is unchanged.
   - It holds parser output only. `sanitizedPreview` is the only SMS-derived text, and there is no raw body or sender.
4. **Add account:**
   - The card opens the existing `AddAccount` form, prefilled with:
     - the name: `proposedAccountBaseName`, e.g. "HDFC Bank" (the last 4 has its own field);
     - the type;
     - the last 4.
   - The opening balance stays optional, defaulting to 0.
   - It reuses the same zod validation and the same `findDuplicateAccount` guard.
   - On save, `addSuggestedAccount(runId, key, input)` does this:
     - `preparePendingRows` deduplicates against the store hashes and within the card. Each row gets the R2 merchant rule's category, or Uncategorised; an item is skipped only if neither exists, the same as sync.
     - `store.importSuggestion` → `suggestionRepository.importSuggestion` runs **one `db.transaction`**, containing:
       - INSERT account + `account_created` (actor `user`);
       - INSERT OR REPLACE decision `added` (key → new account id);
       - one INSERT per pending row + `detected` (actor `system`, `{confidence}` only).
     - Opt-in auto-approve then runs **exactly as in syncSms**: `shouldAutoApprove(mode, threshold, confidence)` → `store.approve(id, {confidence, threshold})` → `auto_approved` (actor `system`) via `canTransition`.
     - The card is removed from the session.
   - If the session is stale (for example after an app restart), the form falls back to a plain account add.
5. **Link to existing:**
   - Shown only when an **active account of the same kind with no last 4** exists.
   - Opens a bottom-sheet picker, then a confirm dialog.
   - Runs the same single transaction as Add, without the account insert. The decision is `linked` → that account.
   - The linked account itself is not modified.
6. **Ignore:**
   - Opens a confirm dialog. The dialog says it can't be undone in the app yet.
   - Writes decision `ignored`. Nothing is inserted or audited, because no money changes.
   - The key is never imported or suggested again.
7. **Snackbar:**
   - Reads "N transactions added to Pending" (plus ", M auto-approved" when M > 0), with a **VIEW** action.
   - VIEW calls `navigationRef.navigate('Tabs', {screen: 'Pending', params: {accountId, focusKey}})`, so Pending opens filtered to that account.
   - The message uses counts only.

## UI

### New Accounts Found

**Header:**
- The back arrow is now a 48dp Pressable (the B2 pattern, fixed on this screen).
- The summary line reads "N new accounts · M transactions waiting".
- The list is one card per suggested account.

**Each card shows:**
- **Title:** the proposed name, e.g. "HDFC Bank ••1234", "SBI Credit Card ••5368" or "Unknown bank (no last 4)", plus a kind chip.
- **"N transactions waiting"**, the date range (e.g. "3 Oct – 28 Oct 2026"), and "In ₹x.xx · Out ₹y.yy" (totals use `showPaise: true`, like the other totals in the app).
- **A "Show transactions" / "Hide transactions" toggle:** 48dp, with `accessibilityState.expanded`.
- **Rows, when expanded:**
  - date, an in/out arrow, merchant, and an `AmountText` amount (row default: no paise, like Pending cards);
  - the SMS description (`sanitizedPreview`), shown on 2 lines; tap it to expand;
  - a "View original SMS" link (the existing `OriginalSmsView`, reading live by the id parsed from `sourceReferenceHash`; the text is held only in component state).
- **Actions:** Add account (brand), Link to existing (ghost, only when eligible), Ignore (ghost).

**Empty state:** "All new accounts are sorted." If the session is stale, it says to sync again.

### Pending

**Header:**
- Title, plus a 48dp **Refresh** icon button (`accessibilityLabel="Refresh"`). It calls `store.refresh()`, which reloads from the DB. It does not run Sync SMS.
- Pull-to-refresh (`RefreshControl`) does the same.

**List:**
- A `SectionList`, grouped by account.
- Each header reads "`accountDisplayLabel(account)` · N pending". Deleted accounts use the existing helper: "Deleted account ••XXXX (name)".
- Sections are ordered by their newest item, and items are newest first.

**Filters:**
- The existing All / Expenses / Income chips (48dp hit areas) are kept.
- When Pending was opened from the snackbar, there is also an "<account> ✕" chip that clears the account filter.

**Auto-approve, when `approval_mode = auto`:**
- The button reads "Auto-approve (N)". N is the visible pending **SMS** items for which `shouldAutoApprove(mode, threshold, confidence)` is true.
- Tap → Dialog "Approve N transactions at or above T% confidence?" → sequential `store.approve(id, {confidence, threshold, actor: 'user'})`.
  - Approval goes through `canTransition`.
  - Each approval is audited `auto_approved` with actor `user` and `{confidence, threshold}`.
  - A snackbar then reads "Approved N transactions".
- When N = 0, the button is disabled with a hint:
  - "No items at or above T%";
  - or, when T > parser max (90), the settings threshold-note wording.
- In manual mode the button is hidden.

The tab badge and counts are store-driven, so they update after every action and refresh.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors, 2 warnings (MainTabs, StatTile: both pre-existing). The PendingScreen warning was fixed by moving the separator component out of render. |
| `npx jest` | 40 suites, 415 tests pass |
| `./gradlew assembleDebug` | OK (exit 0) |

### T4 tests (+47)

**`suggestionGroups.test.ts`:**
- Grouping per suggestion:
  - counts equal `groupUnmatchedIntoSuggestions`;
  - items are newest first;
  - ties are ordered by newest activity;
  - each group carries its decision key;
  - no `body`/`address` fields are kept.
- Proposed name and title for 6 cases: HDFC bank, SBI credit card, Unknown/no last 4, Union Bank, Bank of India, ICICI UPI.
- Summary: totals, date range, pluralisation.
- `linkableAccounts`.
- `partitionCandidates` with decisions:
  - an exact match beats a route;
  - a route handles no-last-4 SMS;
  - a route to a deleted account drops the SMS;
  - an ignored key drops the SMS;
  - with no decisions, behaviour is unchanged;
  - `toSuggestionDecisions`.

**`importSuggestion.test.ts`** (fake DB):
- `preparePendingRows`: dedup, category (rule, else Uncategorised), no accountId.
- Add in manual mode:
  - one `db.transaction`;
  - account insert + `added` decision + 3 pending inserts;
  - audits `account_created` (user) + `detected` ×3 (system), all in the same transaction;
  - store updated;
  - the card leaves the session.
- Dedup skips an existing hash.
- Auto mode: only items ≥ threshold are approved (`auto_approved`, system, `{confidence: 90, threshold: 90}`), and the snackbar copy is checked.
- A stale run writes nothing.
- Link: no account insert, `linked` decision, `detected` ×3.
- Ignore: `ignored` decision, no inserts, no audit.
- No SMS text (preview, merchant, Debited/Credited) appears in any audit metadata.

**`syncSms.session.test.ts`:**
- Sync keeps the unmatched candidates per suggestion in the session.
- The result has only the run id and counts.
- No DB inserts are made for waiting items.
- No sender or body is kept.
- A re-run produces a new run id, rebuilds the session and keeps dedup.
- An `added` decision imports instead of suggesting.
- An `ignored` decision neither imports nor suggests.

**`pendingGroups.test.ts`:**
- Grouping and section titles, including the deleted-account and Unknown labels.
- The eligible count equals `shouldAutoApprove` at thresholds 70/85/89/90/95/100.
- Manual mode: nothing is eligible.
- Button state:
  - manual → hidden;
  - auto → enabled with N;
  - N = 0 → disabled with "No items at or above 90%";
  - T = 95 → the threshold-note wording.
- `store.approve(..., {actor: 'user'})`:
  - writes `auto_approved` by `user` with `{confidence, threshold}`;
  - a rejected item is not approved (`canTransition`).
- Activity says "You auto-approved …".

## Device checks (USB 00015365L001524, Metro, `adb reverse tcp:8081`, `adb install -r`)

Safety:
- Before every tap, swipe, key event and dump, a guard script checked that both `mCurrentFocus` and `mFocusedApp` contained `com.tracker` and that `isKeyguardShowing` was false. A failed guard would abort the action; no guard failed during the run.
- Each dump was grep-filtered to one label, a testID or a count, and was held only in a shell variable (never written to local disk).
- `/sdcard/u.xml` was removed after each dump and confirmed absent at the end.
- No screenshots, no db/sqlite/run-as access, no uninstall or clear-data.
- No "View original SMS" tap.

| Check | Result | Evidence (counts / allowed labels only) |
|---|---|---|
| D1 | PASS | Sync SMS tapped once. The "New Accounts Found" summary read "2 new accounts · 6 transactions waiting". There were 2 suggestion cards (`suggestion-title` ×2): "Unknown bank UPI (no last 4)" with "4 transactions waiting", and "HDFC UPI (no last 4)" with "2 transactions waiting". 4 + 2 = 6, which matches the summary. Home showed "6 waiting" before and after the sync (0 new matched items). |
| D2 | PASS | Expanded the "2 transactions waiting" card: 2 `suggestion-item` rows. The count was still 2 after scrolling, matching N. 2 "View original SMS" links (not tapped). Collapsed: 0 rows. BACK returned to Home. Add, Link and Ignore were not tapped. Both cards offered "Link to existing", because the owner has same-kind accounts with no last 4. |
| D3 | PASS | The Pending list has 2 section headers, counted by scrolling the whole list and hashing each header (the text was never printed). They read "· 4 pending" and "· 2 pending", which adds up to "6 waiting for approval" / "All 6". No QA-Merchant-05 rows are pending any more (consistent with the R2 observation), so there was no QA section to check. The Refresh button (`content-desc="Refresh"`, 144×144 px = 48dp) was tapped, and the count stayed 6. Pull-to-refresh: the swipe down ran with no crash, and the screen and counts stayed intact. |
| D4 | N/A (precondition false) | The owner's approval mode is currently **ON**, not OFF as the prompt assumed. The owner must have changed it since Phase 17; I changed no settings. The button **is visible**, as designed for ON: "Auto-approve (0)", `enabled="false"`. The hint is the threshold-note wording ("SMS matches currently score up to 90%, so thresholds above 90% won't auto-approve anything yet."), so the threshold is above 90. This is the correct ON-path behaviour. "Hidden when manual" is unit-test only. The button was not tapped, and it is disabled anyway. |
| D5 | PASS | Force-stopped and relaunched: Home showed "Sync SMS" and "6 waiting". In logcat (9,184 lines since the clear at the start of the run): 0 FATAL EXCEPTION (any process), 0 in `com.tracker`, 0 "Maximum update depth", 0 ReactNativeJS errors or warnings. `com.tracker` was force-stopped at the end. |

## Unit-test only (not exercised on device)

- **Add account / Link to existing / Ignore on a card,** including the one-transaction insert, the decision rows, the snackbar and VIEW → Pending filtered to the account. These are not exercised on device because a real suggestion must not be touched. No synthetic SMS can be created on the phone.
- **Auto-approve button tap path** (confirm dialog, user-actor audit) and **hidden in manual mode.**
- **Auto-approve on Add** when mode = auto.
- **Sync routing by an `added`/`linked` decision and dropping by `ignored`.** The device has no such rows: none were created.
- **"View original SMS" from a suggestion row:** the reused component was not tapped (it would show real SMS).

## Decisions I made

1. **Suggestion session = a zustand module-level store** keyed by `runId`. Nav params carry only `runId`. A stale or empty session shows an empty state; Add falls back to a plain account add.
2. **Ignore uses the decisions table.** There was no Ignore implementation yet, so I followed sms-sync-v2 D3/D5:
   - Ignore persists `ignored`, and sync drops that key for good.
   - There is **no un-ignore UI yet** (sms-sync-v2 D6 "Hidden accounts" is still pending). The confirm dialog says so.
   - Ignore writes no audit row, because no money changes.
3. **Add and Link record `added`/`linked` decisions, and sync now routes those keys to the chosen account** (after the unchanged exact match).
   - This is what makes no-last-4 suggestions (both on this device) stop reappearing once added, and what makes Link work without editing the linked account's last 4.
   - A route to a soft-deleted account drops the SMS.
4. **Link to existing was built** (not skipped). It is offered only for active same-kind accounts with no last 4. The choice is a picker sheet followed by a confirm dialog.
5. **The Add prefill name is the base name, without "••1234".** The last 4 has its own field, and `accountDisplayLabel` appends it; otherwise it would appear twice. The card title shows the full proposed name.
6. **The account row, decision and items are written in one `db.transaction`,** with `account_created` + `detected` audits. Auto-approve runs afterwards through `store.approve`, exactly like syncSms (separate transactions, system actor).
7. **Pending "Auto-approve (N)" counts only visible pending SMS items** (respecting the account and type filters), using `shouldAutoApprove`. Manual entries are never auto-approved. The audit is `auto_approved` with actor `user`. Activity words the user variant as "You auto-approved …".
8. **Section headers use the existing `accountDisplayLabel`,** which gives "Name ••••1234" (4 dots) and the deleted label, rather than a new 2-dot format. There is one label helper for the whole app.
9. **Snackbar VIEW goes through a root `navigationRef`,** because the Add screen has already been popped when the action runs. Pending applies the account filter from `{accountId, focusKey}` once per navigation, and the "✕" chip clears it.
10. **Amount display:** card totals use `showPaise: true` (like other totals) and row amounts use the `AmountText` default (like Pending cards).
11. **`thresholdNoteText()`** is now the single source of the threshold-note wording, used by the settings form and the Pending hint.

## Notes / open

- **D4 precondition.** The owner's approval mode is ON (threshold > 90). The orchestrator should confirm this with the owner rather than assume OFF in future prompts.
- **Ignore cannot be undone in-app** until a "Hidden accounts" screen exists (sms-sync-v2 D6).
- **If an added/linked account is later soft-deleted and restored,** restore removes only `deleted` rows, so the old `added`/`linked` row (if `softDelete` did not replace it, i.e. when the name-derived key differs) routes again. If `softDelete` replaced it (same key), the route is gone after restore, and no-last-4 SMS for that key will be suggested again. This is minor and was left as is.
- **B2 (22dp back arrows) is fixed only on New Accounts Found** (48dp Pressable). Other headers are unchanged.
