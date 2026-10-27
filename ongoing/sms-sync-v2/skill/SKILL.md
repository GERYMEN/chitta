---
name: tracker-sms-sync
description: Agreed design and implementation rules for the Tracker React Native Android app (package com.tracker) covering SMS sync, account suggestions from SMS, ignore/hide/restore of suggested accounts, balance anchor, user-selectable SMS scan window, bulk approve with confidence warning, period filters (1M/3M/6M/9M/1Y), and soft-deleted accounts. Use this skill whenever implementing, reviewing, planning, testing, or writing orchestrator/executor phase prompts for any of these Tracker features, or when touching the Tracker sync pipeline, accounts repository, balance calculation, Home/Transactions period totals, or Suggestions screen — even if the user only says "Tracker", "Sync SMS", "suggestions", "deleted account", or "month filter".
---

# Tracker — SMS Sync, Account Suggestions & Period Tracking

This skill is the single source of truth for decisions already made with the product
owner (Siraj). Build on them; do not re-litigate them. When something is not covered,
or listed under Open questions, ask instead of deciding silently.

Read `references/device-safety-rules.md` BEFORE any step that touches the physical
device. Read `references/schema.md` before writing migrations or repositories. Use
`references/acceptance-criteria.md` to verify and to write test plans.

## Project context (fixed — do not change)

- React Native, Android only. Package `com.tracker`.
  Root: `/Users/mohammedsiraj/Downloads/projects/experiment/Tracker`.
- Persistence: `@op-engineering/op-sqlite` only. Use async `execute`/`transaction`,
  never `executeSync` in app code. `react-native-sqlite-storage` must never come back.
- Removed on purpose: reanimated, worklets, @gorhom/bottom-sheet, gesture-handler.
  Use the hand-rolled `src/shared/ui/BottomSheet` (`visible`/`onClose` API).
- Money is integer paise (`amountMinor`). No floating point for money anywhere,
  including SQL aggregates (`SUM` of integers only).
- Reuse domain rules, never duplicate them: `confidenceTier`, `canFastApprove`,
  `canTransition`, `affectsBalance` (transactions); `calculateBalance`,
  `isLiabilityAccount` (accounts). Balance is always derived, never stored or edited.
- Native `SmsReader` module + `READ_SMS` already exist (Phase 4). Dedup is by
  deterministic `sourceReferenceHash` (SMS row id + date) — keep it deterministic.
- App never stores raw SMS bodies; only its own `sanitizedPreview`.

## Decisions (agreed)

### D1. Scan window is user-selectable
Options: **Last 30 days, Last 90 days, From install, Whole inbox**.
- Resolve the choice to an absolute timestamp once and store it as
  `app_settings.sms_scan_from`. Never recompute "90 days" per sync (window would slide).
- "From install" = first-launch timestamp in `app_settings`. First sync finds nothing;
  show "We'll detect accounts as new bank SMS arrive" — not an empty dead end.
- Widening later (e.g. 30d → Whole) runs a **backfill** of only the missing older range.
- Narrowing never deletes existing transactions.

### D2. Chunked, resumable, incremental scan
- Native side pre-filters to bank-like senders / transactional patterns so personal
  chats never cross to JS. Read in chunks (~200) ordered by `(date, _id)`.
- Each chunk's inserts (`INSERT OR IGNORE` on `sourceReferenceHash`) and the cursor
  advance commit in ONE `db.transaction`. A `sms_sync_runs` row with
  `status='running'` resumes from its cursor after process death.
- After the first completed run, normal syncs are incremental (only SMS newer than
  the cursor). Show progress ("Scanned N").
- Why: a whole inbox can be tens of thousands of SMS; one bridge call freezes or
  OOMs low-end devices, and a kill mid-scan must not leave partial, unrecoverable state.

### D3. Persist decisions, cache only aggregates
- `account_suggestion_decisions` stores explicit user choices:
  `added | linked | ignored | deleted`, keyed by normalized
  `(bank_canonical, account_kind, last_four)`.
- `account_suggestion_candidates` caches **aggregates only** (count, first/last seen)
  so incremental syncs can still show undecided suggestions. Never store SMS content.
- **No row = undecided.** Back press, "Later", leaving the app → write nothing; the
  suggestion reappears next sync. Only explicit taps write decisions.

### D4. Normalized, versioned account key
- Pure `normalizeAccountKey()`: bank alias map (sender IDs like `HDFCBK` → `hdfc`),
  last-four extraction across formats (`XX1859`, `*1859`, `a/c ending 1859`,
  `XXXXXXXX1859`), kind enum. Store components + `normalizer_version`; a version bump
  ships a migration re-canonicalizing stored keys.
- Bank is part of the key (same last four at two banks are different accounts).
- No last four (UPI-only SMS) → `last_four=''` → "HDFC (unidentified account)".
  Manual link only; never auto-merge with a known-last-four account.
- `''` sentinel, not NULL — SQLite treats NULLs in a primary key as distinct.

### D5. Suggestion rules
- Suggest only with **≥ 2 transactional SMS** (debit/credit with an amount) in the
  window; promos/OTP never count. Threshold is one constant.
- Sync resolves each SMS key in order: `added`/`linked` decision → that account;
  `ignored`/`deleted` → drop; exact Phase 7 match (type + last four) → that account;
  else → candidate.
- Actions on the Suggestions screen: **Add**, **Link to existing** (same-bank manual
  accounts), **Ignore**, **Later**. No auto-merge, ever.
- Show "last activity" per suggestion; no activity for 12+ months → collapsed
  "Older accounts" group.
- If a suggestion's key belongs to a soft-deleted account → offer **Restore**, not Add.
- Approvals are batched: user decides all, then ONE full rescan imports history for
  every newly added/linked account (idempotent by hash).

### D6. Hidden accounts (undo for Ignore)
- A "Hidden accounts" list shows `ignored` and `deleted` keys. Un-ignore deletes the
  decision row and triggers a backfill rescan; deterministic hashes regenerate history
  without duplicates. Show "N new since hidden" as a passive count.

### D7. Balance anchor (replaces opening balance for SMS accounts)
- Balance = `balance_anchor_minor` + approved net of transactions dated **after**
  `balance_anchor_at`. Transactions before the anchor are history-only: visible,
  editable, categorizable, no balance effect (label them "before balance date").
- Prefill the anchor from the latest SMS with a parsed available balance (anchor time =
  that SMS's date); otherwise ask the user. Credit cards: anchor = outstanding,
  through `isLiabilityAccount`.
- Anchor NULL → show **"Set balance"**, exclude from totals with a note. Never show
  ₹0 or a negative number caused by a missing anchor.
- This changes `calculateBalance` — extend it there (with tests); do not fork it.

### D8. Bulk approve with confidence warning
- Bulk approve acts ONLY on items passing `canFastApprove`. Medium/low stay pending.
- Warning shows real counts by `confidenceTier`, and how many approvals affect
  balances (post-anchor) vs history-only (pre-anchor). Example copy:
  "182 transactions found: 142 high confidence, 28 medium, 12 low. SMS parsing can
  misread amounts or income/expense type. Only the 142 high-confidence items will be
  approved; the rest stay in Pending. You can edit any transaction later."
- NEVER display an accuracy percentage — there is no measured parser accuracy.
- Run in chunked transactions; idempotent on re-run. Stamp `bulk_batch_id` and write
  an `AuditEvent` with counts. Batch undo is an open question (needs `canTransition`).

### D9. Period tracking
- Periods: **1M (default), 3M, 6M, 9M, 1Y, calendar-year picker** (see Open questions).
- Calendar semantics: 1M = 1st of current month → now; 3M = current + 2 previous full
  months. One pure `periodRange(period, now, timezone)` at local midnight, unit-tested
  at month ends, leap years, year boundaries.
- Period drives income/expense totals, category breakdown, transaction list. It does
  NOT drive balance (always "as of now" from the anchor) — make that visible in the UI.
- Pending excluded from totals; shown as a separate count.
- Default 1M on every cold start: keep selection in screen state, never persist it.
- Aggregate in SQL (`SUM(amount_minor)` over an indexed `occurred_at` range),
  paginate lists. Stop hydrating all transactions into Zustand; it holds the current
  period's view only.
- If the period starts before `sms_scan_from`, show "Data available from <date>".

### D10. Soft-deleted accounts keep their transactions
- `accounts.deleted_at` (NULL = active). Transactions stay and display as
  **"Deleted account ••1859 (HDFC)"**; no last four → "Deleted account (<name>)".
- Excluded from total balance and from Add Record/Edit pickers. Their transactions
  still count in period spending totals and remain editable.
- Deleting writes decision `deleted` → new SMS for that key are not imported.
- Restore clears `deleted_at`, removes the decision, backfills the gap since deletion.
- Centralize filtering: repository exposes `listActiveAccounts()` and
  `listAllAccounts()`. No raw `SELECT * FROM accounts` in screens or hooks.
- Superseded: the earlier hard-delete `deleteAccountWithTransactions` design. Do not build it.

### D11. Permissions and the no-SMS path
- Track granted / denied / permanently denied (`shouldShowRequestPermissionRationale`
  false after denial → deep-link to app settings). Revocation mid-scan surfaces as a
  typed error; committed chunks stay.
- Manual Add Account stays first-class (cash, accounts whose SMS go elsewhere, denied users).

## Build order

1. `normalizeAccountKey` + tests (everything depends on a stable key).
2. Migrations: decisions, candidates, sync runs, anchor columns, `deleted_at`, indexes.
3. Chunked resumable scan + native pre-filter + incremental cursor + scan-window setting/backfill.
4. Balance anchor in `calculateBalance` + "Set balance" UI states.
5. Suggestion rules: threshold, decision resolution, Add/Link/Ignore/Later, batched rescan.
6. Permission states + manual path (parallel with 3–5).
7. Period filter: `periodRange`, SQL aggregates, store refactor, partial-data notice.
8. Bulk approve with confidence warning.
9. Soft delete + label + Hidden accounts + Restore.

## Open questions (ask; do not decide)

- Period set confirmed as 1M/3M/6M/9M/1Y + year picker? Does 1Y mean last 12 months
  or current calendar year?
- Default selection on the scan-window chooser (assumed: Last 90 days)?
- Batch undo for bulk approve (requires approved → pending in `canTransition`)?
- Should an ignored account ever re-surface past a volume threshold? (Default: never.)

## Verification gates (every phase)

- `npx tsc --noEmit`, `npx eslint .`, `npx jest`, `cd android && ./gradlew assembleDebug`
  (JAVA_HOME / ANDROID_HOME as in `references/device-safety-rules.md`).
- On-device checks follow the device safety rules: count-only for SMS, app isolation,
  no direct database access.
- Report evidence honestly: built / installed / launched / journey-verified.

## When writing an executor phase prompt

Include: which decisions (D#) the phase implements, files to touch, the previous
phase's output file to read first, the gates above, the full device safety rules
verbatim, and the relevant acceptance criteria from `references/acceptance-criteria.md`.
