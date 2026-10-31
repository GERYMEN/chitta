# roadmap — STATE

Plan: ROADMAP.md (R1–R12). Executor = Claude subagent. Device-safety rules:
ongoing/realtime-persistence/STATE.md decisions log (unchanged) + abort on
failed foreground check (competitor-research lesson).

| Phase | Name | Status |
|---|---|---|
| R2 | Smart categories (+ Activity amount privacy T0) | DONE, committed + pushed f658ae8 (with R2b) — R2-smart-categories.md. 51 files, migration 5 (merchant_rules, categories.archived_at/is_system/color, seed type-neutral 'cat-uncategorised'; base seed now runs before numbered migrations). normalizeMerchant (keeps 1–2 digit tokens, drops ≥3-digit ids), rule prompt Just this one/Always + Apply to N + 5 s Undo (new shared Snackbar), SMS → rule else Uncategorised, Uncategorised card + quick-assign, category management (create/rename/archive, no hard delete), Merchant rules UI (delete), Activity amounts masked + eye (re-hidden on every focus). New audit types rule_saved/rule_deleted/category_*. 368 tests, gates clean, D1–D6 PASS, leak-clean. Sync tapped once: +4 pending, 1 Uncategorised. Observed 7 merchant rules + 1 uncategorised item not created by executor (owner likely used build during run) — untouched. Unit-only: category_updated, quick-assign assign. Bugs B2 (22dp back arrow), B3 (Activity re-mask once) logged. Leftover: QA Category archived, QA audit rows, QA Delete Bank 9999 active. |
| R2b | New accounts found clarity + Pending refresh/auto-approve (user request before R3a) | DONE, committed + pushed f658ae8 (with R2) — R2b-new-accounts-pending.md. 25 files. In-memory waiting items per sync run (nav carries run id only; restart → empty state). Cards: proposed name, N waiting, date range, in/out, expandable rows w/ sanitizedPreview + View original SMS. Add (one db.transaction: account + decision + pending + audit, then auto-approve rule) / Link to existing (same kind, no last4) / Ignore (permanent 'ignored' decision; no un-ignore UI yet). Added/linked decisions route future SMS (exact match still wins). Pending grouped by account, Refresh + pull-to-refresh, Auto-approve (N) w/ confirm, actor user, hidden in manual. B2 fixed on this screen only. 415 tests, gates clean. Device D1 (2 cards/6 waiting), D2, D3, D5 PASS; D4 N/A — owner mode is ON (prompt assumed OFF), button showed "(0)" disabled with threshold note (threshold >90). Unit-only: Add/Link/Ignore, snackbar View, auto-approve tap, manual-mode hidden, View original SMS. Leak-clean. |
| R1 | Trust foundation | DONE, committed + pushed e73dc3c — R1-trust-foundation.md. 29 files, migration 4 (audit account_id + indexes), audit writer on all money-changing actions (+ 'created' type for manual add), Activity screen from settings sheet, real Transactions filters (type/account/category/search merchant+notes/Reset), Pending dead Delete removed (B). 319 tests, gates clean, D1–D6 PASS, leak-clean. Unit-test only: settings_changed, detected, auto_approved, account create/remove/restore audit, category picker tap, feed paging. Open: (a) 'deleted' audit keeps merchant name — user to choose keep vs amount+type only; (b) pre-existing bug TransactionsScreen.tsx:36 fixed fixture "today" (1 Oct 2026) → TODAY/YESTERDAY headers wrong. Leftover: 4 QA-Merchant-07 audit rows, QA Delete Bank 9999 active, 2 pending QA-Merchant-05. |
| R3a | Transfers (own accounts) | DONE, committed ee28691 on phase/R3a-transfers (pushed) — R3a-transfers.md. 52 files, migration 6 (transfer_account_id, linked_transaction_id, link_kind, cat-transfer seed, transfer_pair_dismissals). Transfer = one row from→to; SMS pair keeps credit twin rejected + transfer_twin; undo data in transfer_paired audit metadata; paired items held from auto-approve (sync + R2b Add). Manual transfers saved approved. 484 tests, gates clean, D1–D6 PASS, leak-clean. Unit-only: confirm/undo/dismiss pair, twin detail, sync hold, edit transfer, income mark-as-transfer, card bill math, fresh-install migration. Observed: 1 real pair confirmed as transfer during run, not by executor (owner likely tapped). Bug B4 logged. Leftover: QA Wallet 8888 soft-deleted, QA audit rows, QA Delete Bank 9999 active. |
| R3b | Refund link + mark duplicate | CODE DONE, committed on phase/R3b-refund-duplicate (pushed) at user request with DEVICE CHECKS STILL PENDING — R3b-refund-duplicate.md. 42 files, migration 7 (duplicate_pair_dismissals, CHECK a_id<b_id). Refund = income linked to expense, reduces spend in refund's period, not income; partial/multiple ≤ expense; ranker 90 days. Duplicates ±10 min same account/type/amount; hidden row rejected+link_kind duplicate; restore exact; Undo snackbar. Home ReviewCard 'N to review' + Review screen (transfers + duplicates). 530 tests, gates clean, release built. Device D1–D4 NOT RUN: owner was using phone (browser in front ~9 min), executor stopped per rules; Add Record opened, not saved. Release reinstalled, not launched. R3b.1 follow-up (12 files): F1 edit guard (domain linkedEdit.rules + form inline errors + store refuses; refund amount capped at refundable; expense with refunds type-locked; hidden rows not editable); F2 Uncategorised rows show amount, account, SMS description (sanitizedPreview) + View original SMS via OriginalSmsView (live read only, SMS rows only), row body opens detail. 544 tests, gates clean, leak-clean. Device D1–D6 + F2 link count still pending (waiting for user 'phone free'). |
| R4 | Insights | planned |
| R5 | Budgets | planned |
| R6 | Balance reconciliation | planned |
| R7 | SMS coverage | planned |
| R8 | Reminders | planned |
| R9 | Security & data safety | planned |
| R10 | Personal IOUs | planned |
| R11 | Tags & receipts | planned |
| R12 | Dark theme | planned |

## Decisions log

- 2026-10-28: User wants every feature from the competitor tour, built step
  by step in phases; plan first.
- 2026-10-28: Pending Delete = B (remove dead code; folded into R1).
- 2026-10-28: R3 split into stages R3a (transfers) and R3b (refund link +
  mark duplicate), each its own phase.
- 2026-10-28: R4 charts = plain RN Views, no dependency. User may adopt a
  chart library later → build charts behind a small `ChartBars`-style
  component interface so the renderer can be swapped without touching
  screens.
- 2026-10-28: Activity keeps merchant names (incl. deleted items) for a
  clear history. Amounts private: masked by default, eye icon reveals;
  default hidden each time the screen opens. Built as R2 T0.
- 2026-10-28: Bug B1 (fixed fixture "today" in TransactionsScreen) logged
  in BUGS.md — user: fix later.
- 2026-10-30: R2 + R2b committed + pushed together (f658ae8) on user OK.
- 2026-10-30: R3a design: transfer = one row (account_id=from, transfer_account_id=to, cat-transfer); SMS pair keeps credit twin as rejected+link_kind transfer_twin for dedup; Undo transfer restores both; paired items skip auto-approve.
- 2026-10-30: Release APK (debug-keystore signed, install -r, data kept) installed on phone after R3a; launch OK, 0 crashes.
- 2026-10-30: Branch per phase from R3a: phase/R3a-transfers off main (f658ae8); each later phase branches from the previous phase branch.
- 2026-10-30: Leak-scan regex lists real names — never write it into repo files; pass it in the dispatch message only (removed from R3a prompt before commit).
- 2026-10-30: R3b refunds reduce spend in the refund's own period; duplicate keeps one row, hides the other as rejected+link_kind duplicate (R3a twin pattern).
- 2026-10-31: User request folded into R3b (follow-up R3b.1): Uncategorised rows show SMS description (sanitizedPreview) + View original SMS for verification; plus F1 edit guard for linked rows. Device run waits for user "phone free".
- 2026-10-31: User: commit + push R3b now without device checks, move to R4; phone tests later (R3b D1–D6 + F2 to run together with R4 device checks when user says phone is free).
