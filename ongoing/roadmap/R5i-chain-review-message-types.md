# R5i — Chain review + message types (proposal G3 + G1)

Branch `phase/R5i-chain-review-message-types` (from `phase/R5b-bills-dues`).
Executor = Claude subagent. CODE + TESTS + GATES + device script only (no device
run). Not committed.

## What was built

### G3 — persist chain suggestions + surface them in Review (the real work)

Before R5i the rules-engine chaining outcomes (duplicate / refund_link /
transfer_twin / incomplete, R5g item 21) lived only in a session-only zustand
store and vanished on restart, and nothing surfaced them in Review.

**T0 — migration 12 + repository + persisted store**
- Migration **12** `chain_suggestions` (ids + enums only):
  `id TEXT PK, kind TEXT NOT NULL, child_id TEXT NOT NULL, parent_id TEXT,
  parent_override TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL`, index `ix_chain_suggestions_status_child
  (status, child_id)`. `CREATE TABLE IF NOT EXISTS` only — rewrites nothing.
- `parent_override` is a JSON of the `RuleChainOverride` **enum/boolean fields
  only** (`deleted` / `link` / `incomplete`), sanitised before write
  (`sanitizeChainOverride` in `domain/chains/chainSuggestion.types.ts`). Never
  free text, SMS body or a sender number.
- `data/repositories/chainSuggestion.repository.ts`: `listOpen`, `replaceOpen`
  (one OPEN row per child — a newer suggestion deletes the child's open row and
  re-inserts), `setStatusByChild` / `setStatusById` (status move keeps the row
  for history), `listAll` / `listByChild`. Every write is in one
  `db.transaction` with its audit row (D-i).
- `useChainSuggestions` (in `rules/chaining.ts`) is now **repository-backed**:
  the in-memory `suggestions` list is the OPEN rows (for the synchronous
  selectors + the de-dupe); `refresh()` hydrates it on launch / after a
  restore; `add` / `remove` (the kept R5g call sites) + `accept` / `supersede`
  / `dismiss` / `reopen` persist. API surface for the old readers
  (`useDuplicatePairs`, `PendingTransactionCard`, `transactionsStore`) is
  unchanged.
- Backup (R4e): `chain_suggestions` added to `BACKUP_TABLES` at version 12; an
  old backup without the table still restores (table empty).
- Launch hydrate in `app/App.tsx`; restore hydrate in `reloadAfterRestore.ts`.

**T1 — wire syncSms** `resolveChains()` now `await`s `chains.remove(parentId)`
(completion → status `superseded`, row kept, no accept/dismiss audit) and
`chains.add(outcomes)` (persist open rows). Hold behaviour unchanged.

**T2 — Review "Linked by rules" section** (`ReviewSections.tsx` +
`features/chains/components/ChainSuggestionCard.tsx` +
`features/chains/chainReview.ts`):
- Each row: the child (masked merchant / account / date / amount via the
  existing masked rule) + the proposed relation + actions.
- Accept reuses the existing store action and **re-checks at tap time**:
  refund_link → `linkRefund`, transfer_twin → `confirmTransferPair`, duplicate
  → `markDuplicate`. On a stale/superseded pair (`ok === false` /
  `linkRefund !== null`) the row is marked `superseded` and the snackbar says
  "This pair changed — not recorded" (existing copy). incomplete → no Accept,
  shows "Waiting for the matching alert", Dismiss only.
- Dismiss → status `dismissed` with a 5 s Undo (shared Snackbar) that reopens
  the row. Buttons are ≥ 48 dp with a11y labels.

**T5 — audit + Activity** New audit types `chain_suggested` / `chain_accepted`
/ `chain_dismissed` (ids + enum kind only). Sanitised in `audit.rules.ts`;
copy + icons in `activityFeed.ts`.

### G1 — message-type hardening (verify only; statements→bills & multi-record already shipped in R5b/earlier)

**T3** `failed` and `collect_request` SMS: locked with tests as **dropped** —
never a transaction, never a bill, and never shown in "Messages not understood"
(they ARE understood, so `notUnderstood` is null). No UI. Surfacing collect
requests as reminders is a possible future owner option, not built here.

**T4** Multi-record (one SMS → 2 records via a template `reparse`): verified
with a synthetic ATM-withdrawal + fee test that the template emits **2
transaction records** with distinct per-record reference + content hashes and
correct amounts (`200000` + `2360`). An ATM-withdrawal-plus-fee route already
exists in the rules DATA (`T-ICICI-0003` reparse + `T-ICICI-0004`), so no
rules.json change was needed. (Note: in the *combined* reader this particular
SMS is held as an N1 reader/template disagreement; the 2-record mechanism is
verified at the template-read level, which is what sync consumes when the
reader agrees or finds nothing.)

**T6** Device script `scripts/device/r5i.sh` (uses `lib.sh`, same safety model:
counts only, Tracker-in-front before every tap/dump, 30 s idle, owner-assisted
taps, `am force-stop` for the restart proof, no db access, no screenshots).
Covers: install -r keeps data, open Review from Home, a QA suggestion appears
in "Linked by rules", Dismiss + Undo, restart → suggestion still there
(persistence proof), Accept → row gone, 0 FATAL/ANR. `bash -n` clean; not run.
README updated.

## Chain kinds surfaced + de-dupe policy (D-d)

The "Linked by rules" section shows:
- **refund_link** and **incomplete** always (no existing Review UI);
- **duplicate** / **transfer_twin** only when the child is NOT already in the
  transfer / duplicate sections (every id in `useTransferPairs` /
  `useDuplicatePairs` is excluded). A duplicate chain suggestion already feeds
  `findDuplicatePairs`, so it normally appears as a DuplicatePairCard and is
  excluded here — no double-listing.

## Migration

Number **12**, table `chain_suggestions`, columns as above.

## Tests added / changed

Added:
- `data/repositories/__tests__/chainSuggestion.repository.test.ts` (real SQLite)
- `features/sms-sync/rules/__tests__/chainSuggestionsStore.persist.test.ts`
- `features/chains/__tests__/chainReview.test.ts`
- `features/review/__tests__/ReviewSections.chain.test.tsx`
- `features/sms-sync/__tests__/messageTypes.g1.test.ts` (G1 + D-h)
- `features/activity/__tests__/activityFeed.chain.test.ts`

Changed:
- `data/db/__tests__/migrations.test.ts`: migration 11 no longer "the last";
  new migration-12 assertions.
- `data/repositories/__tests__/backup.repository.test.ts`: the N-1 restore test
  now targets v11→12 (chain_suggestions), plus a current-version round-trip.
- `test/fixtures/backupRows.fixture.ts`: a `chain_suggestions` fixture row.
- `features/sms-sync/rules/__tests__/chaining.test.ts`: dropped the unused
  `parentOverride`/`createdAt` from a `chainDuplicatePairs` literal
  (signature loosened to `Pick<...>`).
- `chaining.ts`: `ChainSuggestion` gains `id`; `chainDuplicatePairs` /
  `isWaitingForMatchingAlert` take a `Pick<>` (so test literals need no `id`).

## Decisions beyond D-a..D-i

- Completion of an `incomplete` parent (the former `remove`) maps to status
  `superseded` (no accept/dismiss audit); accept re-check failure also uses
  `superseded`. No new status enum value.
- Chain suggestion writes are best-effort from the store (`.catch`) so a sync
  run and the synchronous selectors never fail if persistence is unavailable;
  the in-memory projection stays correct and T0 tests cover real persistence.
- Dismiss Undo re-points the exact persisted row back to `open` (no new row).

## Known limits

- The device script needs a real chained SMS pair, which only the owner can
  create (no SMS injection); R2 times out otherwise.
- D-h's combined-reader path holds the ATM+fee as an N1 disagreement; the
  2-record output is verified at the template-read level (the mechanism sync
  consumes). A fully-agreeing 2-record issuer would flow both as pending rows.

## Gates

tsc clean · eslint 0 errors (2 pre-existing warnings) · jest 142 suites /
2475 tests pass · validate_v2 ALL OK (51 issuers, 157 patterns, 163 samples,
8 negatives) · `cd android && ./gradlew assembleDebug` BUILD SUCCESSFUL.

## How to run the device script

```
scripts/device/r5i.sh [--skip-install]
```
Owner-assisted; see `scripts/device/README.md` → "R5i".
