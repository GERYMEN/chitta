# R5b — Bills & dues

Branch `phase/R5b-bills-dues` (from `phase/R5h-sync-to-pending`). Not committed.
CODE + TESTS + GATES + DEVICE SCRIPT only — no device work, no adb, no
assembleRelease, no branch switch. No new dependency, no new permission, no
network. rules.json untouched. All fixtures synthetic (QA names, XX9999,
refs 000000000xxx).

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors (2 warnings, both pre-existing: MainTabs, StatTile) |
| `npx jest` | 135 suites, 2442 tests, all pass (was 130 / 2392 after R5h) |
| `node scripts/rules/validate_v2.js …/rules.json` | issuers 51, patterns 157, samples 163, negatives 8, ALL OK (rules.json unchanged) |
| `cd android && ./gradlew assembleDebug` | BUILD SUCCESSFUL (no Android change) |

Failing-first method: the domain core was written test-first and confirmed red
before implementing — `bill.rules.test.ts` and `billMatch.rules.test.ts` failed
with "Cannot find module '../bill.rules'" / '../billMatch.rules' before the
modules existed, then passed. Repository / ingestion / activity / store / form
tests were added against the implementation and all pass.

## Migration

**Migration 11** (last migration now 11):
```
ALTER TABLE accounts ADD COLUMN credit_limit_minor INTEGER
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, account_id TEXT, kind TEXT NOT NULL, payee TEXT NOT NULL,
  amount_due_minor INTEGER NOT NULL, min_due_minor INTEGER, statement_date TEXT,
  due_date TEXT, status TEXT NOT NULL, paid_minor INTEGER NOT NULL DEFAULT 0,
  paid_transaction_id TEXT, source TEXT NOT NULL, source_hash TEXT,
  repeat TEXT NOT NULL DEFAULT 'none', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
CREATE INDEX ix_bills_status_due ON bills(status, due_date)
CREATE INDEX ix_bills_source_hash ON bills(source_hash)
```
No existing row rewritten (`credit_limit_minor` starts NULL). Backup/restore
(R4e) covers both: `bills` at version 11, `accounts.credit_limit_minor` at 11;
`backup.tables.test.ts` (schema at every version) green; an old backup without
the table still restores (N-1 v10→11 test).

## Tasks

- **T0** done — migration 11; `bill.repository.ts` (create / update / markPaid /
  reopen / reopenByPaidTransaction / dismiss / undismiss / ingestSmsBill, one
  db.transaction + one audit each); `billsStore.ts` (light store, linkedNumbers
  pattern); account type `pay_later` + `creditLimitMinor`; backup coverage +
  old-backup test.
- **T1** done — `billIngest.ts` turns a bill/statement/future-debit
  non-transaction into an open bill; wired into `syncSms` (sync, re-scan,
  auto-read all run through it); dedupe by salted content hash; same-period
  statement update; account mapping by last-4 + bank (R5d identity). Reader +
  rules engine now carry `dueDate` / `statementDate` / `availableLimitMinor` on
  `SmsNonTransaction`.
- **T2** done — `billMatch.rules.ts` matcher; Review "Bill paid?" suggestions
  (`BillPaidSuggestions`, Confirm links + marks paid, Not this = session
  dismiss); manual Mark paid + Undo (exact prior state); partial payments add
  to paid_minor; deleting the linked transaction reopens the bill
  (`reopenByPaidTransaction` from `deleteTransaction`).
- **T3** done — overdue / due-soon logic (`billUrgency`, `dueBannerModel`,
  useNow); Home `DueBillsBanner` (in-app only, no permission; amount follows the
  redaction rule; overdue tinted red; hidden when nothing qualifies).
- **T4** done — `BillsScreen` (Overdue / Due soon / Later / Paid & dismissed;
  Mark paid / Link payment / Edit (manual) / Dismiss+Undo); `AddBillScreen`
  (manual add/edit, monthly repeat → next month's bill on pay); account detail
  on Accounts shows the account's open bill. ≥48 dp targets; a11y labels;
  radio role/state on the type + account choice lists.
- **T5** done — credit-limit field in the account form (credit_card /
  pay_later); Accounts card shows used / available / limit; `pay_later` added
  everywhere `credit_card` is a liability/card (see list).
- **T6** done — audit events `bill_created / bill_updated / bill_paid /
  bill_reopened / bill_dismissed` (ids, enums, amounts only) + Activity copy,
  amount masked by the existing rule.
- **T7** done — `scripts/device/r5b.sh` (owner-assisted, counts only) + README.
  `bash -n` clean. Not run.

## credit_card sites (D-a grep) — pay_later parity

Production sites treating `credit_card` as a liability/card, and how pay_later
is handled:

| Site | pay_later behaviour |
|---|---|
| `domain/accounts/account.rules.ts` `isLiabilityAccount` | returns true for pay_later → balance sign, outstanding label |
| `domain/bills/bill.rules.ts` `isCreditLimitAccount` / `creditUsage` | credit limit + used/available for pay_later |
| `domain/meaning/meaning.rules.ts` `targetAccountTypes` | card-bill-payment target now `['credit_card','pay_later']`; all-types list includes pay_later |
| `domain/audit/audit.rules.ts` ACCOUNT_KINDS | pay_later accepted |
| `features/accounts/components/accountForm.schema.ts` + `AccountForm.tsx` | pay_later type option + credit-limit field |
| `features/accounts/screens/AccountsScreen.tsx` | grouped under "CREDIT CARDS & PAY LATER", own icon, credit usage, open-bill row |
| `features/meaning/meaningLabels.ts` | picker types include pay_later |
| `features/sms-sync/suggestionGroups.ts`, `screens/SmsSuggestionsScreen.tsx`, `rules/checkBalance.ts` | AccountType maps given a pay_later entry (label "Pay Later" / `['pay_later']`) |
| `features/sms-sync/normalizeAccountKey.ts`, `legacy/normalizeAccountKeyV1.ts`, `parser/readSms.ts`, `rules/*` | SMS reader never emits pay_later (it is a user account type); card SMS stay `credit_card` and map to a pay_later account by the user link — no change needed |

## Tests added / changed

Added: `domain/bills/__tests__/bill.rules.test.ts`, `billMatch.rules.test.ts`;
`data/repositories/__tests__/bill.repository.test.ts`;
`features/sms-sync/__tests__/billIngest.test.ts`;
`features/bills/state/__tests__/billsStore.test.ts`; bill cases in
`activity/__tests__/activityFeed.test.ts`; credit-limit/pay_later cases in
`accountForm.schema.test.ts`; migration-11 case in `migrations.test.ts`.

Changed (why):
- `migrations.test.ts` — ALTER count 14→15 (credit_limit_minor); migration-10
  "is last" relaxed (11 is last now).
- `backup.repository.test.ts` — round-trip now also covers the `bills` table
  (fixture row added); the R5e v9 N-1 test repurposed to the R5b v10 N-1 (bills
  table absent at v10, restores empty).
- `rulesEngine.test.ts` item 8 — the statement non-transaction now carries
  dueDate/statementDate/availableLimit (strict `toEqual` → `toMatchObject` +
  a dueDate assertion).
- `meaning.rules.test.ts`, `meaningLabels.test.ts` — card-payment targets now
  include pay_later (D-a).
- ~17 account fixtures / test helpers — added `creditLimitMinor: null` (new
  required `Account` field).

## Decisions beyond D-a..D-i

1. `due_date` is **nullable** (D-c lists it without "(nullable)"): an SMS bill
   with no parseable due date still becomes an open bill (shown under "Later",
   never overdue/due-soon). Manual bills require a due date (form validation).
2. Added a `repeat` column (`'none' | 'monthly'`) — not in D-c's column list —
   to drive D-h monthly manual bills. SMS bills are always `'none'`.
3. Bills live in a **separate light `billsStore`** (the linkedNumbersStore
   pattern), not the 1565-line transactionsStore, to limit blast radius.
4. SMS bill ingestion is a **side-effect** of `syncSms` (not added to
   `SmsSyncResult`) so the result shape many tests assert is untouched; the UI
   reads `billsStore`.
5. Did **not** hand-edit rules.json: the reader + existing rules already emit
   `bill_due` / `statement` / `mandate_future`, so no generic future-debit
   patterns were added (rules.json byte-identical; validate_v2 unchanged).
6. pay_later parity extended to the R5e card-bill-payment meaning resolver.
7. Review "Not this" dismissal is session-only (no table), like R5g chain
   suggestions.

## Known limits

- The reader's SMS "available limit" is parsed (`availableLimitMinor`) but **not
  stored** on the account (no column — that is R6 balance territory), so only
  the user's manual credit limit is shown. "Limit per last SMS" display is
  deferred.
- Bill matching / due-date parsing is heuristic (reader) plus the template
  `date` field (rules); a bill with no resolvable amount is not created.
- "Not this" on a bill-paid suggestion does not survive an app restart.
- Device script not run (owner tests by script).

## How to run the device script

```
scripts/device/r5b.sh [--skip-install]
```
Owner-assisted, counts only (see `scripts/device/README.md`). It installs the
update (data kept), then prints `>>>` prompts asking you to add the QA Pay Later
account (with a limit), QA-Bill-01 (due tomorrow → Home banner), mark it paid
(banner clears) and Undo (banner returns), and QA-Bill-02 (due yesterday →
Overdue section); it checks the banner, labels and section counts, then asks you
to remove the QA data, and finally checks 0 FATAL/ANR for com.tracker. Never
touches real bills/accounts; no db access; no screenshots; 30 s idle wait;
Tracker-in-front checked before every tap/dump.
