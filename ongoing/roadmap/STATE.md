# roadmap — STATE

Plan: ROADMAP.md (R1–R12). Executor = Claude subagent. Device-safety rules:
ongoing/realtime-persistence/STATE.md decisions log (unchanged) + abort on
failed foreground check (competitor-research lesson).

| Phase | Name | Status |
|---|---|---|
| R1 | Trust foundation | DONE (awaiting user review → commit) — R1-trust-foundation.md. 29 files, migration 4 (audit account_id + indexes), audit writer on all money-changing actions (+ 'created' type for manual add), Activity screen from settings sheet, real Transactions filters (type/account/category/search merchant+notes/Reset), Pending dead Delete removed (B). 319 tests, gates clean, D1–D6 PASS, leak-clean. Unit-test only: settings_changed, detected, auto_approved, account create/remove/restore audit, category picker tap, feed paging. Open: (a) 'deleted' audit keeps merchant name — user to choose keep vs amount+type only; (b) pre-existing bug TransactionsScreen.tsx:36 fixed fixture "today" (1 Oct 2026) → TODAY/YESTERDAY headers wrong. Leftover: 4 QA-Merchant-07 audit rows, QA Delete Bank 9999 active, 2 pending QA-Merchant-05. |
| R2 | Smart categories | planned |
| R3a | Transfers (own accounts) | planned |
| R3b | Refund link + mark duplicate | planned |
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
