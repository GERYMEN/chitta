# R10 — Personal IOUs

Branch `phase/R10-personal-ious` (stack tip + migration 15). Code, tests, gates and a device script only; NOT committed, NO device run.

## Migration 15 (additive)
- `people(id PK, name NOT NULL, created_at, updated_at)`.
- `iou_shares(id PK, person_id NOT NULL, direction NOT NULL 'lent'|'borrowed', source_transaction_id NULL, amount_minor NOT NULL, note NULL, created_at, settled_at NULL, repayment_transaction_id NULL)`; indexes on `person_id` and `settled_at`. `CREATE ... IF NOT EXISTS`, nothing rewritten.
- Both tables in `BACKUP_TABLES` with `sinceVersion 15` (people before iou_shares). An older backup restores with both empty (tested at v14 and, via the existing chain, v12/v13). The catalogue-vs-real-schema test passes at every version.

## Parallel ledger — the single insights change
The IOU ledger is a parallel layer. Splitting a 1000 expense does NOT change that expense: spend stays 1000. The ONLY insights change: a credit linked as an IOU repayment (`linkKind='iou_repayment'`) is excluded from income. Done once, in `incomeContributionMinor` (via new `isIouRepayment`), so Home, Transactions totals, trend, merchant history and budgets (spend side untouched) all follow. The credit stays an approved row, still in lists, still in the account balance. It adds nothing to spend. "Shares reduce my spend" is NOT done (double-count prone) — possible future option.

## LinkKind
`'iou_repayment'` added to `LinkKind`. Linking reuses the R3 persistence helper (`updateTransactionTx`, same transaction as the share update + audit); no new link machinery. `linkedTransactionId` = the split expense (null for a manual share).

## Flows
- **Split (lent)**: approved, unlinked expense detail → "Split" sheet. Rows of free-text person name + amount; tap a chip to reuse an existing person (typing a name that matches an existing person case-insensitively also reuses it; no duplicate people). Validation: at least one share; every share has a name; each amount a positive whole number of paise; the SUM of shares (plus shares already recorded for that expense) must be <= the expense amount. Saves new people + `iou_shares` (direction 'lent', source = the expense) + audit in one db.transaction. The expense detail shows "Split: N people owe you ₹X" (or "paid you back" when all settled).
- **Repayment**: unsettled lent share → "Record repayment": (a) "Settle without a transaction", or (b) link an approved, unlinked incoming credit (candidates: exact amount first, then newest, max 20). (b) sets `repayment_transaction_id`, the credit's `linkKind='iou_repayment'` + source id, and `settled_at`. 5 s Undo snackbar restores the share and unlinks the credit exactly. Audited.
- **Partial repayment**: NOT supported — "settle in full" only (the simpler option allowed by D-d). A credit of any amount can settle the share; the user judges. Documented in the sheet copy.
- **Borrowed (manual)**: People screen "Add an IOU" → "You owe someone" (default) or "Someone owes you" (lent without an expense): person + amount + optional note. "Mark paid" either plain or links an outgoing expense; that expense is recorded on the share only and stays ordinary spend (nothing excluded or relinked).
- **Delete share**: confirm dialog + 5 s Undo. Deleting a settled lent share also unlinks its repayment credit in the same transaction (it counts as income again); Undo re-links it if still free.
- **People screen**: people with at least one active share, each with NET (unsettled lent minus unsettled borrowed): "owes you ₹X" / "you owe ₹X" / "settled up"; header shows You get / You owe. Person screen lists shares; settled shares older than 30 days hide behind "Show settled (N)". Entry points: Home tile and Settings > "People & IOUs" (so manual add is reachable with no shares).
- **Home tile**: "IOUs — You get ₹X / You owe ₹Y" (unsettled lent / borrowed), shown only with at least one unsettled share, below the Budget card, tap → People. All amounts and names go through the redaction-aware formatter / `redactText` (Private mode masks them).

## Pure math (`src/domain/iou/iou.rules.ts`)
`personNet`, `totals`, `activeShares(shares, now)` (settled < 30 days ago visible; exactly 30 days still visible), `validateSplit`, `validateManualAmount`, `splitTotalForExpense`, `canLinkAsRepayment`, `linkRepaymentPatch`/`unlinkRepaymentPatch`. No clock inside.

## Audit
`iou_person_added`, `iou_share_added`, `iou_repayment_recorded`, `iou_share_deleted` (D-i) plus `iou_repayment_undone` (beyond D-i, so Undo is audited too). Metadata: ids / enum direction / amounts only — never a person name or note (sanitizer whitelist + planted-field test). Activity copy added with masked amounts.

## Tests added
- `domain/iou/__tests__/iou.rules.test.ts` (12): net, totals, 30-day boundary, split validation, repayment helpers.
- `transaction.rules.test.ts` (+2) and `insights.rules.test.ts` (+2): repayment excluded from income, spend unchanged (confirmed failing without the change: 3 failures).
- `data/db/__tests__/migrations.test.ts` (+2; v14 test no longer asserts "last"), `backup.repository.test.ts` (+2 incl. v14→15 empty restore; v13 test pinned), `backupRows.fixture.ts` (people + iou_shares).
- `audit.rules.iou.test.ts` (2), `activityFeed.test.ts` (+1).
- `features/iou/state/__tests__/iouStore.test.ts` (9, real SQLite): split persistence/audit/no-name-in-audit/expense amount unchanged, person reuse, validation writes nothing, settle with credit + Undo, plain settle, not-linkable/missing/reused, borrowed flow, delete unlinks + Undo relinks, restart refresh.
- `features/iou/__tests__/`: labels + masking (3), render (6: tile hidden/shown/masked, People 30-day rule, Person show-settled, SplitSheet mounts), repaymentCandidates (2).

Gates: tsc clean; eslint 0 errors (2 pre-existing warnings); jest 174 suites / 2767 tests; validate_v2 ALL OK (no rules.json change); assembleDebug OK.

## Decisions beyond D-a..D-i
- Added `iou_repayment_undone` audit type.
- Settle in full only (no partial); no amount match enforced between credit and share.
- Delete share (+ Undo) provided, and it unlinks/relinks the repayment credit.
- Manual entry also allows direction 'lent' (someone owes you, no expense).
- Person matching by case-insensitive trimmed name to avoid duplicate people; no rename/merge UI.
- Added Settings > "People & IOUs" entry (Home tile alone is hidden when empty).
- Borrowed repayment link stored on the share only; the linked expense is not modified.

## Known limits
- Deleting or editing a split expense does not touch its shares (they keep the source id; amount cap not re-checked on edit).
- Editing a repayment credit's type/amount is not guarded (an `iou_repayment` row edited to expense just counts as spend).
- Deleting a repayment credit leaves the settled share with a dangling `repayment_transaction_id` (harmless; shown as settled).
- No people rename/merge, no partial repayment, no sharing/contacts/sync (by design).
- Pre-existing, not touched: `budget_*` audit metadata is not in the sanitizer whitelist (returns null).

## Device script
`scripts/device/r10.sh [--skip-install]` (bash -n clean, NOT run). Owner-assisted, counts/fixed labels only; see the R10 section in `scripts/device/README.md`.
