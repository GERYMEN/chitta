# Tracker roadmap — all competitor features, phase by phase

Source: ongoing/competitor-research/01-axio-splitwise-tour.md (P0/P1/P2 list),
plus unfinished sms-sync-v2 build-order steps (3, 4-UI, 5, 6, 7-UI, 8).
Phases are numbered R1–R12. Order follows dependencies: trust/correctness
first, then categories, then insights built on correct data, then extras.

## Working rules (every phase)

- Orchestrator–executor: orchestrator writes `ongoing/roadmap/prompts/RN-*.txt`,
  a Claude subagent implements, writes `RN-*.md`, orchestrator reviews,
  leak-scans, updates `ongoing/roadmap/STATE.md`.
- Gates: `tsc --noEmit` clean, `eslint` 0 errors, `jest` all pass,
  `./gradlew assembleDebug` OK, then device check over USB.
- Device safety rules from realtime-persistence STATE.md apply unchanged
  (only com.tracker, abort on failed foreground check, filtered dumps,
  synthetic "QA-…" data only, never change owner settings/accounts, no db
  access, no screenshots, no Sync-SMS output beyond counts).
- New DB changes = new numbered migration (current last = 3). Never edit
  old migrations. Money stays integer paise. Raw SMS never stored.
- New native dependency or new Android permission = ask user first.
- After each phase passes: user reviews, then commit + push (gerymen).
- From R3a on: one branch per phase (`phase/<id>-<name>`), each created
  from the previous phase's branch, not from main (user, 2026-10-30).

## Overview

| Phase | Name | Features | Effort | Depends on |
|---|---|---|---|---|
| R1 | Trust foundation | Audit writer + Activity feed (P1-3), real Transactions filters (P0-4), Pending delete decision | M | — |
| R2 | Smart categories | Merchant→category memory, Uncategorised bucket, custom categories (P0-1) | M | R1 (audit) |
| R3 | Correct money | Transfers, link refund, mark duplicate (P0-2) | L | R1, R2 |
| R4 | Insights | Period selector + SQL aggregates, category breakdown, trends, merchant history (P0-3, P2-5, v2 step 7) | M | R2, R3 |
| R5 | Budgets | Monthly budget ring + per-category budgets (P1-1) | M | R4 |
| R6 | Balance reconciliation | SMS-reported balance vs tracked, "Set balance" anchor UI (P1-4, v2 step 4) | M | R1 |
| R7 | SMS coverage | Missed-transaction picker, chunked resumable scan + scan window, permission states, bulk approve + undo (P1-2, v2 steps 3, 5, 6, 8) | L | R1 |
| R8 | Reminders | Notification infra, recurring payment detection + reminders, weekly summary (P1-5, P2-3) | L | R2 |
| R9 | Security & data safety | App lock + hide-in-recents, CSV export, encrypted backup/restore (P1-6, P2-4) | M–L | — |
| R10 | Personal IOUs | You lent / you borrowed ledger, settle, link repayment (P2-1) | L | R3 |
| R11 | Tags & receipts | Tags (auto #UPI/#Card + custom), receipt photo (P2-2) | M | R4 (filters) |
| R12 | Dark theme | DESIGN.md dark tokens, system/light/dark setting (P2-6) | M | — |

Recommended order R1 → R2 → R3 → R4 → R5, then R6–R12 in any order the
user prefers (R6/R7 are most valuable; R9 early if privacy is a concern).

---

## R1 — Trust foundation

**Goal:** every change to money is recorded and visible; list filters work.

Features
1. Audit writer: write `audit_events` (table exists, unused) from store
   paths: detected, auto_approved (with confidence + threshold), approved,
   edited (changed fields, no SMS text), rejected, deleted, account_removed,
   account_restored, settings_changed (approval mode/threshold).
2. Activity feed screen (Splitwise style): sentence + coloured impact line +
   time, grouped by day, newest first. Entry: Home settings sheet row
   "Activity" (no new tab — 4-tab cap). Tap row → transaction detail.
3. Transactions filters: All/Expenses/Income chips actually filter; add
   account + category filter chips (bottom-sheet pickers); search matches
   merchant AND notes. Filter state kept in store, cleared by "Reset".
4. Pending delete: apply user's A/B decision (pending, still open).

Data: migration 4 — index `audit_events(event_at)`, optional `account_id`
column on audit_events for account events.
Code: `src/domain/audit/` (rules + labels), new
`src/data/repositories/audit.repository.ts`, store hooks in transactions/
accounts/settings stores, `src/features/activity/` (new), TransactionsScreen.
Tests: audit written once per action, inside same db transaction as the
change; label helper; filter predicate (pure) combos.
Device: approve/reject/edit synthetic QA items → feed shows each with
correct impact line; filters return expected counts; logcat clean.
Exit: no store action that changes money is missing an audit event.

## R2 — Smart categories

**Goal:** SMS items land in the right category; user corrects once.

Features
1. On category change (pending or approved), prompt "Always use
   <Category> for <merchant>?" → `merchant_rules` (normalized merchant key
   → category_id). `syncSms` applies rule before the default.
2. Stop forcing "Shopping"/"Salary & Wages": unmatched SMS get system
   category "Uncategorised". Home/Transactions show "N uncategorised —
   Categorise ›" opening a quick-assign list (one tap per item, option to
   remember).
3. Custom categories: create/rename/archive (no hard delete when used;
   archive like soft-delete), icon + colour from theme set.
4. Optional: "Apply rule to N past items?" with preview + undo.

Data: migration 5 — `merchant_rules(merchant_key PK, category_id,
created_at)`, categories `is_system`, `archived_at`; seed "Uncategorised".
Code: `normalizeMerchant` pure helper, smsSyncLogic `resolveCategoryIdForSms`
rewrite, category repository CRUD, category management screen (from
settings sheet).
Tests: merchant normalization (case/spaces/UPI handles/suffixes), rule
precedence, archive keeps old transactions labelled.
Device: synthetic QA-Merchant items; set rule; re-sync → counts only.
Exit: zero SMS items silently put into Shopping.

## R3 — Correct money (transfers, refunds, duplicates)

**Goal:** totals reflect real spending, not money moved between own accounts.

Features
1. New transaction kind `transfer` (from_account → to_account): changes both
   balances, excluded from income/expense/insights.
2. Auto-suggest transfer: debit on own account A + credit of same amount
   on own account B within N hours → pending "Looks like a transfer"
   suggestion; user approves (fits Detect → Approve → Record).
3. Link refund: on a credit, "Link to original expense" → nets out of
   spend for that category/month; both rows show the link.
4. Mark duplicate: pick the twin → one becomes `rejected` with reason
   duplicate (audited); suggestion when same amount + account + ±10 min.
5. Manual add supports Transfer tab.

Data: migration 6 — `transactions.transfer_account_id`,
`linked_transaction_id`, `link_kind ('refund'|'duplicate'|'transfer')`.
Code: TransactionType union widen ('transfer'), `calculateBalance`,
Home/Transactions totals, pickers, detail screen actions, smsSyncLogic
pairing (pure).
Tests: balance math both sides; totals exclude transfers; refund netting;
pairing window edge cases; audit events.
Device: two synthetic QA accounts, transfer 500 → both balances move,
Home income/expense unchanged.
Exit: Home totals unchanged by self-transfers. Large phase — may split
into R3a (transfer) / R3b (refund + duplicate).

## R4 — Insights

**Goal:** "Where did my money go" for any period.

Features
1. Period selector 1M/3M/6M/9M/1Y (periodRange exists) on Home +
   Transactions; partial-data notice when period starts before first sync.
2. SQL aggregates (sum/count by category, by month) instead of JS loops;
   store refactor per sms-sync-v2 step 7.
3. "Where it went" card: category bars (₹ + count + % of spend), tap →
   Transactions filtered (uses R1 filters).
4. Trends: month-by-month spend vs income bars (simple Views, no chart lib
   unless user approves react-native-svg).
5. Merchant history chip on detail: "N visits · ₹X this period" → list.

Data: migration 7 — indexes on `(status, occurred_at)`, `(category_id)`.
Tests: aggregates vs JS reference on fixtures; transfer/pending excluded.
Device: synthetic items in two categories → card numbers match deltas.
Exit: insights only count approved, non-transfer items.

## R5 — Budgets

**Goal:** stay under a monthly limit.

Features: overall monthly budget ring on Home spend tile; per-category
"Set budget ›" in breakdown; amber at 80%, red over (DESIGN.md tokens);
"₹X left, N days to go"; budget changes audited.
Data: migration 8 — `budgets(id, category_id NULL=overall, amount_paise,
period 'month', created_at, archived_at)`.
Tests: progress math, month rollover, archived categories.
Device: set synthetic budget on a QA category, add items, see state colours.

## R6 — Balance reconciliation

**Goal:** know when Tracker's balance disagrees with the bank.

Features
1. Parser extracts "Avl bal / Available balance" number → store only
   amount + timestamp on matched account (never SMS text).
2. Accounts card: "Bank SMS: ₹X as of <time>" + "Difference ₹Y" when ≠
   calculated.
3. "Set balance" (balance anchor, already in calculateBalance): one tap
   "Use bank balance" or manual entry; audited; explains effect.
Data: migration 9 — `accounts.sms_balance_paise`, `sms_balance_at`
(anchor columns exist from v2 step 2).
Tests: parser balance formats, anchor math, difference display.
Device: synthetic account + manual anchor only (bank SMS = counts only).

## R7 — SMS coverage

**Goal:** no missed or stuck SMS; fast big inboxes.

Features
1. "Missed a transaction?" (settings sheet): lists recent financial-looking
   SMS the parser rejected — sender + date only until tapped; tap shows text
   in memory (like OriginalSmsView) → pre-fills Add Record as pending.
2. Chunked resumable scan with native pre-filter + incremental cursor;
   scan-window setting (default from install, option backfill N months);
   progress UI (sms-sync-v2 step 3, `sms_sync_runs` exists).
3. Suggestion rules: Add / Link to existing / Ignore / Later with decisions
   table (v2 step 5).
4. Permission states: granted / denied / never-ask-again each with clear
   UI + manual-entry path (v2 step 6).
5. Bulk approve on Pending with low-confidence warning + 5 s Undo
   (v2 step 8), audited.
Tests: chunk/cursor resume, rule resolution, undo restores exact state.
Device: counts only; permission states via app settings toggle only if
user approves (changes owner's permission).

## R8 — Reminders

**Goal:** never miss a recurring due.

Features: local notification infrastructure (asks POST_NOTIFICATIONS in
context, Android 13+); recurring detector (same merchant key, similar
amount, ~monthly/yearly cadence ≥3 occurrences) → "Upcoming" card on Home
with "Remind me?"; reminder list in settings; weekly summary notification
"Spent ₹X, N pending" (opt-in).
Needs approval: new dependency (e.g. @notifee/react-native) or small
Kotlin AlarmManager module; new permission.
Tests: cadence detector on fixtures; scheduling logic pure.

## R9 — Security & data safety

Features
1. App lock: BiometricPrompt / device credential on launch + resume after
   N min; FLAG_SECURE option (hide in recents, block screenshots).
2. CSV export of approved transactions via Android share sheet
   (user-triggered, never includes SMS text).
3. Backup/restore: encrypted file the user saves (SAF picker), restore
   with confirm + schema version check.
Needs approval: Kotlin BiometricPrompt module (no JS dep) or library;
androidx.biometric gradle dep.
Tests: CSV escaping, backup round-trip, version mismatch refusal.

## R10 — Personal IOUs

Features: on an approved expense "Split" → shares owed by named people
(free text, no contacts permission); Home tile "You get ₹X / You owe ₹X";
people list with per-person net and history; "Record repayment" links an
incoming credit (R3 link); settled people hidden after 30 days with
"Show settled"; "you lent / you borrowed" net-effect column.
Data: migration — `people`, `iou_shares(transaction_id, person_id,
amount_paise, settled_at)`.
Personal ledger only — no accounts, no sync, no sharing.

## R11 — Tags & receipts

Features: tags table + chips on detail; auto tags #UPI/#Card/#NEFT from
parser payment method; filter by tag (R1 filters); receipt photo attach
stored in app sandbox, thumbnail on detail, delete with transaction;
excluded from export by default.
Needs approval: image picker/camera dependency + permission (asked only
on use).

## R12 — Dark theme

Features: dark token set per DESIGN.md; setting System / Light / Dark in
settings sheet; every screen + Dialog/BottomSheet/Slider/Switch verified
for contrast; status bar style follows theme.
Tests: token completeness (every light token has dark twin).
Device: check each reachable screen in both modes.

---

## Open decisions for the user

1. Pending screen Delete: A (add Delete) or B (remove dead code).
2. R3: one phase or split into R3a/R3b.
3. Charts (R4): plain Views (no dependency) or add react-native-svg.
4. R8/R9/R11 dependencies and new permissions — approve when we reach them.
5. Order after R5 (default: R6, R7, R9, R8, R10, R11, R12).
