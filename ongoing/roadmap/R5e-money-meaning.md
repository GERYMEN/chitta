# R5e — money meaning: card bills, ATM, wallet top-ups, own transfers, EMI, interest, template refunds

Branch `phase/R5e-money-meaning` (from the committed R5g, 7c15a0b). Not committed. No device work, no adb, no
assembleRelease. No new dependency, no new Android permission, no network, no Kotlin change. rules.json untouched.
All fixtures are synthetic (QA names, XX1234 / XX9999 / XX5678, refs 000000000xxx).

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors (2 warnings, both from before this phase: MainTabs, StatTile) |
| `npx jest` | 127 suites, 2333 tests, all pass (was 120 / 2208) |
| `node scripts/rules/validate_v2.js …/rules.json` | issuers 51, patterns 157, samples 163, negatives 8, ALL OK |
| `cd android && ./gradlew assembleDebug` | BUILD SUCCESSFUL |

Method: T0, T2, T4 and T5 tests were written first and failed (T0 19 / 31, T2+T5 15 / 17, storage 4, Approve all 1),
then the code made them pass. T1 code was written just before its table test, so I checked it by mutation
instead (rule branch, ATM branch and 'in:' key off → 4 tests fail; restored → all pass). T6 is a proof: its tests pass
on the R3a totals rules without any change. One full run under load had 3 timeouts in older suites; the re-run and
every later run were green.

## Status per task

| Task | Status |
|---|---|
| T0 reader parity (atm / wallet_load / emi / transfer / interest) | done |
| T1 `resolveMeaningTarget` + table tests | done |
| T2 sync integration (release M5–M7, hold + suggestion M1–M4, rule conversion, R3a pairing both orders, Approve all) | done |
| T3 Pending meaning card, Undo, Settings "Automatic money rules" | done |
| T4 migration 10, backup, delete cascades | done |
| T5 re-scan suggestions on existing rows + Review "Money meaning" | done |
| T6 totals proof | done |

## Files (49 in src + this report)

New (15):
- `src/domain/meaning/meaning.types.ts`, `meaning.rules.ts`: kinds, counterparty key, resolver, one-row conversion +
  exact undo, partner lookup, rule plan.
- `src/data/repositories/meaning.repository.ts`: rules / suggestions, confirm / undo / remove. Each is one
  db.transaction with its audit row.
- `src/features/sms-sync/moneyMeaning.ts`: the sync step (rule converts, else suggestion) and the T5 lookup.
- `src/features/meaning/meaningLabels.ts`, `useMeaningReview.ts`, `components/MeaningCard.tsx`,
  `components/MeaningRulesSection.tsx`.
- Tests: `domain/meaning/__tests__/meaning.rules.test.ts`, `meaning.totals.test.ts`,
  `features/meaning/__tests__/meaningLabels.test.ts`, `MeaningCard.test.tsx`, `useMeaningReview.test.ts`,
  `sms-sync/__tests__/syncSms.r5e.test.ts`, `sms-sync/parser/__tests__/readSms.r5e.test.ts`.

Changed (34):
- Data: `migrations.ts`, `backup.tables.ts`, `account.repository.ts`, `transaction.repository.ts`,
  `suggestion.repository.ts`, `transfer.repository.ts`.
- Audit: `audit.types.ts`, `audit.rules.ts`.
- SMS: `readSms.ts`, `ruleRead.ts`, `combineReaders.ts`, `smsSyncLogic.ts`, `syncSms.ts`, `importSuggestion.ts`.
- Store: `transactionsStore.ts`.
- UI: `PendingTransactionCard.tsx`, `PendingScreen.tsx`, `pendingGroups.ts`, `ReviewSections.tsx`, `ReviewCard.tsx`,
  `ProfileSettingsSheet.tsx`, `TransferAccountPickerSheet.tsx`, `Button.tsx` (optional accessibilityLabel),
  `activityFeed.ts`, `categoryVisuals.ts`.
- Test helpers: `fakeDb.ts`, `backupRows.fixture.ts`.
- Tests adjusted, not weakened: `migrations.test.ts`, `backup.repository.test.ts`, `account.softDelete.test.ts`
  (+1 statement), `syncSms.r5.test.ts` (+`meaningSuggested: 0` in the rescan counts), `pendingGroups.test.ts`,
  `activityFeed.test.ts`, `audit.rules.transfer.test.ts`.

## Meaning table (M1–M8)

| # | Meaning | What happens | Tests |
|---|---|---|---|
| M1 | card_payment | Becomes a transfer from the bank a/c to the credit card. The card's "payment received" credit is the in side: a transfer from the bank. | syncSms.r5e "card payment (unique card) …", "order 1 / 1b / 2"; meaning.rules "card out: …", "card in: …" |
| M2 | atm | Becomes a transfer from the bank to the cash account. | syncSms.r5e "… ATM (no cash account → missing) …", "confirm with automatically next time …"; meaning.rules "atm: …" |
| M3 | wallet_load | Becomes a transfer from the bank to the wallet ('other' account of that institution). The wallet's own alert is the in side. | syncSms.r5e "… wallet (unique) …"; meaning.rules "wallet out/in: …" |
| M4 | transfer | Becomes a transfer to the other own account, matched by counterparty last-4. Without digits the user picks. | syncSms.r5e "… own transfer (unique)"; meaning.rules "transfer: …" |
| M5 | emi | Expense in "EMI & Loans" (`cat-emi`), released from the hold. | syncSms.r5e "auto mode: EMI → …", "a merchant rule still wins …" |
| M6 | interest | Income in "Interest" (`cat-interest`), never held. | syncSms.r5e "auto mode: … interest …"; meaning.totals "EMI … interest counts as income" |
| M7 | refund (template) | Income, released from the hold. The R3b ranker is unchanged. | syncSms.r5e "auto mode: … refund released …" |
| M8 | meaning rule | "Do this automatically next time" (default ON) stores (bank canonical, kind, counterparty key) → account. Later matches convert at insert: still pending in manual mode; auto mode approves only at or above the threshold. | syncSms.r5e "a stored meaning rule converts at insert …" (5 tests), "confirm … Undo … removes that rule"; MeaningCard "unticking …" |

## Resolution rules (T1, `resolveMeaningTarget(candidate, activeAccounts, rules, bankOf)`)

- Targets are only active accounts of the allowed types. The item's own account is never a target.
- A stored rule wins when its target is such an account → `rule`.
- card_payment, out side:
  - credit cards with `last_four` equal to the counterparty last-4;
  - else, for a 3-digit counterparty mask, the R5d suffix rule (same bank, last_four ends with the digits);
  - else, with no digits, the credit cards of the same bank canonical.
- atm: the active 'cash' accounts.
- wallet_load, out side: 'other' accounts whose name resolves to the wallet's institution (all 'other' accounts when the
  wallet is not named).
- transfer, and the in side of card / wallet credits: accounts with the counterparty last-4. Without digits → ambiguous
  (the user picks); no other account → missing.
- Exactly one hit → `unique`, more → `ambiguous`, none → `missing`. emi / interest / refund have no target, so the
  resolver is not called for them.
- Counterparty key: last-4, else 3-digit mask, else wallet id, else `''`. In-side keys carry an `in:` prefix.
- The UI re-resolves every open suggestion live, so "Add account" → back resolves the target.

## Conversion (R3a model) and pairing

- The item becomes ONE transfer row and keeps merchant, hash and preview:
  - an expense on A: `account_id` = A, `transfer_account_id` = target;
  - an income on A: `account_id` = target, `transfer_account_id` = A;
  - category `cat-transfer`.
- If the counterpart SMS is in a suggested R3a pair with the target, the EXPENSE becomes the transfer and the income its
  rejected `transfer_twin`, so the move is never counted twice.
- Confirming either side resolves the other side's suggestion as `paired`. "It's a transfer" on the pair closes both
  suggestions as `paired`, and its Undo reopens them. Tested in both orders.
- A user confirm approves the row; an approved row keeps its approvedAt.
- A rule conversion keeps the status. It never runs on an N1 disagreement, never touches an approved counterpart, and
  never runs when the item pairs with a different account. In those cases the item stays a suggestion with reason
  `rule`.
- Audit `transfer_marked` holds ids, enums and timestamps only:
  `{transaction_id, twin_id, meaning, rule, previous{transfer, twin}, rule_id, rule_created, previous_rule_target}`.
  Undo writes `transfer_unmarked`, restores both rows exactly, reopens the suggestions, and deletes the rule the confirm
  created (or points it back to its previous target). Settings Remove writes
  `meaning_rule_removed {meaning, bankCanonical}`.

## Migration 10

```
CREATE TABLE IF NOT EXISTS money_meaning_rules (id TEXT PRIMARY KEY, bank_canonical TEXT NOT NULL, kind TEXT NOT NULL,
  counterparty_key TEXT NOT NULL DEFAULT '', target_account_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (bank_canonical, kind, counterparty_key))
CREATE TABLE IF NOT EXISTS money_meaning_suggestions (transaction_id TEXT PRIMARY KEY, kind TEXT NOT NULL,
  target_account_id TEXT, reason TEXT NOT NULL, bank_canonical TEXT NOT NULL DEFAULT '',
  counterparty_key TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT)
INSERT OR IGNORE INTO categories (…) VALUES (?, ?, NULL, ?, ?, 1)   -- cat-emi "EMI & Loans" expense calendar-sync-outline
INSERT OR IGNORE INTO categories (…) VALUES (?, ?, NULL, ?, ?, 1)   -- cat-interest "Interest" income percent-outline
```

- No existing row is rewritten. Migrations 1–9 are untouched.
- Both tables are in BACKUP_TABLES at version 10. The completeness test is green at every version 0..10.
- Older-schema restore equals the real migrations for every version 0..9.
- New N-1 test: a v9 backup restores with empty meaning tables and the EMI / Interest seeds replayed.
- A v10 round trip keeps the rules and suggestions exactly.
- Soft-deleting an account deletes the rules that target it and sends open suggestions to `missing`, in the same
  transaction.
- Deleting a transaction (and Undo of an R2b link) deletes its suggestion.

## UI copy (T3 / T5)

- Pending item card. Chips: "Card bill payment", "Cash withdrawal", "Wallet top-up", "Transfer to own account" (in
  side: "Transfer from own account"). One explainer line under the chip.
- Primary action, one of:
  - "Confirm transfer to <account display label>" (in side: "from"; the a11y label includes the account);
  - "Choose account": the existing picker, filtered to the allowed types, own account excluded;
  - "Add credit card ••9999 account" / "Add Cash account" / "Add Paytm account" / "Add account ••5678": opens
    AddAccount prefilled with type, name and last-4.
- Secondary action: "It's an expense" (in side: "It's income").
- Checkbox "Do this automatically next time" (role checkbox, checked state, default ON).
- Snackbar: "Recorded as a transfer to <label>[ · next time automatically]" with Undo. Dismissing shows "Kept as an
  expense" / "Kept as income".
- Approve all skips items with an open meaning. Its snackbar reads "Approved N · M need a quick check" (singular
  "needs").
- Settings → "Automatic money rules": "Axis · Card bill payment · ••9999 → QA Axis Credit Card ••••9999", plus Remove
  with a confirm dialog.
- Review / Pending top: "Money meaning · N" lists open suggestions on approved rows (T5). The Home "N to review" count
  includes them.
- Every control is at least 48 dp. Last-4 values go through redactLast4 / accountDisplayLabel and amounts through
  AmountText, so REDACTED mode masks them.
- Activity:
  - a confirm reads "You moved ₹ •••• from A to B" with "Confirmed as a transfer" or "Recorded by your automatic rule";
  - an Undo reads "You undid a transfer of ₹ ••••";
  - a rule removal reads "You removed an automatic money rule for <bank> SMS".

## Totals proof (T6, `meaning.totals.test.ts`)

- Income / expense totals and periodTotals are identical with and without the confirmed card bill, ATM withdrawal and
  wallet top-up.
- The donut (spendByCategory → buildPieModel) is identical and never shows cat-transfer.
- Recorded as approved expenses instead, the same three items would have added ₹3,700 of false spend.
- Balances: the bank goes down by the three amounts, the card's amount owed shrinks by the bill, cash and the wallet go
  up, and the four-account sum is unchanged.
- EMI appears as a "cat-emi" slice. Interest adds to income.

## Decisions I made

1. Suggestions store `bank_canonical` + `counterparty_key` (two extra columns beyond the spec). Without them a pending
   item cannot re-resolve after "Add account", and a later confirm cannot build the rule key. These columns hold the same
   data class as the rules.
2. In-side items get meanings too: the card's "payment received" and the wallet's own top-up alert. Their rule keys carry
   an `in:` prefix so they never reuse a bank-side rule.
3. The resolver takes a 4th `bankOf` argument, because domain code must not import sms-sync. emi / interest / refund
   never call it (no target).
4. The "R5d suffix rule on lastDigits" is applied to a 3-digit COUNTERPARTY mask. I added `counterpartyLastDigits`,
   filled from a template's `counterparty_pan` with `min_digits` 3.
5. A user confirm approves the item, like R3a "It's a transfer". A rule conversion keeps the status (spec). A rule never
   converts N1-disagreement rows, approved counterparts, or rows that pair with another account.
6. A merchant rule beats the EMI / Interest category, as it already does for Salary. An archived seed falls back to
   Uncategorised.
7. emi / refund stay in the `RuleHoldReason` type so `heldByMoneyKind` keeps its shape. Their counts are now always 0.
8. Pending Auto-approve (auto mode) also skips open-meaning items. "It's an expense" writes no audit row (no money
   change), matching R3a "Not a transfer".
9. The reader's own refunds still get no moneyHint. Only the template's `money_kind refund` sets it (now released).
10. `latestPairing` now also returns the event time, so Undo on a twin-backed transfer picks the newer of
    `transfer_paired` and `transfer_marked`.

## Anything surprising

- For "EMI of Rs … for your Loan A/c XX0099 has been debited from your A/c XX1234", the reader's v2 key takes the FIRST
  a/c (the loan, 0099). T0 must not move a last-4, so it stays that way; the fixture pins the current behaviour. On a
  real bank whose template reads 1234, this becomes an N1 disagreement (held).
- fakeDb only creates a table when seeded with at least one row. One test seeds the rules table explicitly.
- The ATM fixture of R5 ("federal ATM withdrawal") now gets `moneyHint 'atm'`, so it is held in auto mode with a
  meaning suggestion. No existing test depended on it being auto-approved.

## Not done / limits

- Transaction Detail has no "Undo transfer" for a meaning transfer WITHOUT a twin. Undo is in the confirm snackbar, and
  twin-backed meaning transfers undo from Detail through the existing button.
- A counterpart SMS that arrives AFTER its debit was already converted (no twin then) is not auto-hidden. It gets its
  own meaning suggestion; confirming it would add a second transfer, so the user should pick "It's income". The R3a pair
  finder does not see an existing transfer.
- Foreign-currency SMS, loan principal/interest split, pay-later and budgets are out of scope, as specified.

## DEVICE PLAN (later — counts only, inline over USB, 30 s idle wait, live per-test status)

Never open, print or store a real SMS. Never confirm, dismiss or undo a real row. Never convert a real row without the
owner. Synthetic QA rows and QA accounts only.

1. Install the debug-signed build over the existing one (data kept). Wait 30 s idle. Confirm the foreground is
   com.tracker. Filtered logcat: 0 FATAL.
2. Settings → "Automatic money rules": the count only (expected "None yet").
3. Run "Re-read messages with the new reader". Read only the newest `sms_rescan` Activity line: created and
   meaningSuggested counts.
4. Pending: count the meaning cards per chip (counts only). Review / Home "N to review": count the "Money meaning"
   entries. These must equal meaningSuggested plus the pending held items.
5. Approve all: if a meaning card is visible, open the Approve all dialog and read its title count only, then Cancel.
   Never approve real items.
6. Confirm / Undo / "Do this automatically next time" / Remove rule: these need a meaning suggestion on a QA row.
   Suggestions only come from SMS, and no synthetic SMS can be put on the phone, so leave this NOT RUN unless the owner
   creates a QA row that carries one. On such a row only: confirm, check the snackbar Undo restores it, check the rule
   count goes 1 → 0, then delete the QA rows and QA accounts. Everything else is unit-tested.
7. Second re-scan: created 0 and meaningSuggested 0. Force-stop. Logcat 0 FATAL / 0 ANR.

## Fix pass (R5e-FIX)

Code + tests + gates only; no device work, no commit. Each item: failing synthetic test first, then the fix.
New tests: `src/features/sms-sync/__tests__/syncSms.r5eFix.test.ts` (store / sync),
`src/features/sms-sync/parser/__tests__/readSms.r5eFix.test.ts` (reader),
additions in `src/features/meaning/__tests__/MeaningCard.test.tsx` and `src/features/activity/__tests__/activityFeed.test.ts`.

Gates: tsc clean; eslint 0 errors (2 old warnings); jest 129 suites / 2379 tests pass (R5e had 127 / 2333);
validate_v2 ALL OK (rules.json untouched); assembleDebug OK.

### Findings
- M1 fixed. A stored rule never converts a row that is in an R3b duplicate pair (same-run or chain), an R5g chain
  parent/child (except the exact transfer_twin pair) or an N1 disagreement; the row stays a held meaning suggestion.
  Test: "M1 — duplicate alerts… auto mode: the same card-bill alert twice stays two held suggestions".
- M2 fixed. A meaning conversion finds its counterpart over 72 h (`meaningCounterpart`, opposite type, same amount,
  on the target account, closest, a tie gives none), and a lone counterpart is never converted on its own. Releasing
  holds removes only meaning / cardPayment reasons (`isMeaningHold`), never chain / disagreement.
  Tests: "M2 … (a) same run", "(b) two syncs, manual mode", "(b2) confirming that credit…", "(b) in auto mode",
  "only meaning hold reasons are released…".
- M4 fixed. Undo of an R2b Link first calls `releaseLinkedCounterparts(insertedIds)`: any pre-existing row the link's
  rows hid as a twin is restored from its audit snapshot, then the linked rows are deleted.
  Test: "M4 — … the card credit from an earlier sync comes back exactly".
- M5 fixed. confirmMeaning / rule conversion refuse an expense with live linked refunds (no writes). The card shows
  only "It's an expense" plus a note. Tests: "M5 — confirmMeaning refuses with no writes",
  "M5: an expense with a linked refund offers only \"It's an expense\" and says why".
- M6 fixed. Changing a row's type closes its open suggestion (resolution 'expense'); confirm and rule check that the
  suggestion's side still matches the row. Test: "M6 — editing the type closes the open suggestion; a stale one is refused".
- M7 fixed. When the credit side is confirmed, the partner debit keeps its own approvedAt / status.
  Test: "M7 — the approved debit becomes the transfer with its own approvedAt".
- M8 fixed (shares the M1 guard). Test: "M8 — the debit stays a suggestion and the disagreement credit stays pending".
- P1 fixed. 'interest' only for "interest … credited", "towards / as / for interest" or an Int.Pd tail, and never with
  principal / maturity / matured / closure / closed / free. Reviewer note: it only changed the category, never the
  totals (income stays income). Tests: readSms.r5eFix "P1 …" cases.
- P2 fixed. ATM charges / fees are not 'atm'. Tests: "P2 ATM annual maintenance charges", "P2 ATM txn charges…".
- P3 fixed. Hints read only the transaction clause (cut at the first ", " / " - " / " – " after the amount or verb;
  sentences already cut at "."). Tests: "P3 …" cases.
- P4 fixed. Self-transfer needs word boundaries and excludes self help / employed / service / care / made / drive /
  group. Tests: "P4 …" cases.
- P5 fixed. Advice / promo clauses (pay via EMI, EMI available, 0%, plans, options, "add money to wallet…", "from your
  own account never share OTP") add no hint. Tests: "P5 …" cases.

### Known limits
- K1 fixed. A late counterpart (≤ 72 h) of a meaning transfer becomes its twin, by sync (`lateMeaningTransfer`, pass 3)
  or when the user confirms it; never a second transfer, no second "Confirm transfer". Audit transfer_marked with
  twin_added; its Undo restores only the twin (transfer_unmarked twin_only); Undo transfer then undoes the conversion.
  Tests: "K1 — next sync: the card credit 30 h later is hidden…", "a confirm of the late row (Snackbar Undo) only
  detaches it again".
- K2 fixed. Detail shows "Undo transfer" on a transfer confirmed from a meaning suggestion, even with no twin; same
  audit-snapshot Undo, removes a rule that confirm created. Tests: "K2 — restores the row exactly and removes the rule…",
  "K2: a meaning transfer with no twin shows \"Undo transfer\" on Detail", "K2: a manual transfer … has no \"Undo transfer\"".
- K3 fixed in the reader only. An EMI debit naming a loan a/c and "debited from your a/c" uses the bank a/c last-4.
  `normalizeAccountKey` is unchanged (still returns the loan digits), so no v2/v3 account key changes; PARSER_VERSION and
  ACCOUNT_KEY_NORMALIZER_VERSION unchanged. Tests: "K3 …" cases and "K3 leaves the v2/v3 account key itself unchanged".
  One R5e fixture updated (EMI debit last-4 0099 → 1234).

### New UI copy
- MeaningCard (refund linked): "This expense has a linked refund, so it stays an expense. Unlink the refund first to
  record it as a transfer."
- Detail "Undo transfer?" dialog, no twin: "This item goes back exactly as it was before it was recorded as a transfer
  (status, type, account and category). An automatic rule made by that confirm is removed too."
- Activity: transfer_marked with twin_added: "Matching alert joined this transfer · not income or expense";
  transfer_unmarked with twin_only: "Matching alert restored as it was".

### Decisions
- Counterpart window 72 h (MEANING_COUNTERPART_WINDOW_MS) for meaning partner / late twin; R3a's 24 h pair window unchanged.
- A late twin is attached as a new transfer_marked audit (twin_added) rather than rewriting the first one; latestMark is
  now stack-based (marked push, unmarked pop) so Undo order is exact.
- A late twin attaches to the existing transfer whichever side it is (debit or credit).
- Type change closes an open suggestion with resolution 'expense' (no new resolution enum).
- Chain outcomes block rule conversion, except the exact transfer_twin pair (that is the same money twice).
- M4 restore runs in its own DB transactions before the link Undo; a failure leaves the link in place.
- Hint clause cut at the first comma / dash after the amount; meaning hints never change type, amount, last-4 or key
  (only K3 moves a last-4, in the reader).
- Across separate syncs the R5g chain does not match (the earlier row has no parsed facts), so M2 (b) relies on
  `meaningCounterpart`, not the chain.
