# Proposal — new version with gap (for owner review)

Status: **DRAFT, waiting for owner review and approval.** Nothing here changes
the roadmap until the owner approves each item (Approve / Change / Drop).
Date: 2026-11-15.

## 1. What was compared

| | Tracker (this app) | finManagement |
|---|---|---|
| What it is | Working Android app (React Native + Kotlin + SQLite), sideload beta 0.10.0 | Blueprint: specs (FEATURES, ARCHITECTURE, WORKFLOW, ALGORITHMS, RULES_SCHEMA) + a Node reference engine with tests. No UI, no Android, in-memory store |
| Data source | Bank SMS (inbox + auto-read), manual Add Record | Bank SMS only (manual entry described) |
| Rules | Same `rules.json` (49 issuers, 157 templates, 163 samples) | Same `rules.json` |
| Principle | Detect → Pending → Approve → Record; holds block auto-approve; since R5h nothing is approved silently | Same Detect → Review → Approve → Record with holds |
| Network | Offline only | Offline; only optional over-the-air rules download described |

So finManagement is mostly the **design source** Tracker already follows. The
gaps are the parts finManagement specifies (or implements in its engine) that
Tracker has not built yet.

## 2. Feature comparison

Legend: ✅ built · 🟡 partly · ⬜ planned in a Tracker phase · ❌ missing · — not in scope

| Area | Feature | finManagement | Tracker | Gap? |
|---|---|---|---|---|
| Reading | Sender filter, OTP blacklist, templates → generic reader | ✅ engine | ✅ R5 / R5g | no |
| Reading | Message types: failed txn, collect request, promo, statement, balance-only | ✅ engine | 🟡 statements/bill-due typed but not stored; failed/collect handling to verify | **G1** |
| Reading | One SMS → several records (e.g. ATM withdrawal + fee) | ✅ engine | to verify in code | **G1** |
| Reading | "Last read N days ago" banner (background reliability) | described | ❌ | **G9** |
| Reading | Over-the-air rules update | described | — (hook only) | keep out (offline) |
| Reading | Check-balance missed-call numbers | data (2 entries) | 🟡 hidden until verified | keep deferred |
| Accounts | Types bank / card / wallet / cash | ✅ | ✅ | no |
| Accounts | **Loan** account type | ✅ | ❌ (EMI only as category) | **G8** (optional) |
| Accounts | New accounts found: Add / Link / Ignore, remembered | ✅ | 🟡 Ignore cannot be undone, no Hidden list | **G7** |
| Accounts | Edit account | described | ❌ (store action only) | **G4** |
| Accounts | Credit limit / available credit | field read | ❌ | **G2** |
| Balance | SMS balance snapshot + user-set anchor → explainable balance | ✅ | ⬜ R6 | in R6 |
| Balance | **Missed-transaction alert** (SMS balance ≠ tracked): add missing / set balance / dismiss | ✅ | ❌ (R6 shows difference only) | **G4** |
| Links | Transfers, money meaning, refunds, duplicates | ✅ | ✅ R3a / R3b / R5e | no |
| Links | Chain suggestions with re-check on accept (stale / superseded) | ✅ | 🟡 R5g holds only; no Review UI, lost on restart | **G3** |
| Bills | Card statement → bill (total, min due, due date) | ✅ | ❌ (parsed, not stored) | **G2** |
| Bills | Utility / insurance / pay-later / recharge bills from billers | ✅ | ❌ | **G2** |
| Bills | Payment matched to bill → "Mark paid" suggestion | ✅ | ❌ | **G2** |
| Bills | Overdue bills | ✅ | ❌ | **G2** |
| Bills | Future-debit notices (mandate, EMI due, recharge due) → reminders | ✅ | ❌ | **G2** |
| Recurring | Subscription detection (≥3 payments, monthly/weekly gap, ±10%) + next due | ✅ | ⬜ R8 (tied to notifications) | **G5** (split R8) |
| Notify | Bill due / new detection / missed transaction notifications | described | ⬜ R8 (needs permission) | in R8b |
| Categories | Merchant rules, keyword map, uncategorised, custom | ✅ | ✅ R2 | no |
| Categories | Restore an archived category | described | ❌ | **G7** |
| Budgets | Monthly + per category | described | ⬜ R5c | in R5c |
| Goals | Savings goals | — | — | optional (owner) |
| Reports | Income vs spend, by category, trend, merchant history | 🟡 | ✅ R4 / R4e | no |
| Reports | Weekly summary | described | ⬜ R8 | in R8b |
| Export | CSV / PDF export | described | ⬜ R9 (CSV) | in R9 |
| Backup | Encrypted backup, salt kept so dedupe survives restore | described | ✅ R4e / R5d | no (add repo test **G7**) |
| Security | App lock, hide amounts | described | ⬜ R9 (lock); amounts masked only in Activity | **G6** |
| IOUs | Split / shared | optional | ⬜ R10 | in R10 |
| Tags / receipts | Tags, receipt photo | fields | ⬜ R11 | in R11 |
| Theme | Dark | — | ⬜ R12 | in R12 |
| Currency | Foreign currency kept out of totals | ✅ | ✅ (not understood) | no |
| Out of charter | Investments, net worth, bank login, payments | — | — | stay out |

## 3. Gaps and what to do

| Gap | What is missing | Proposal | Where |
|---|---|---|---|
| G1 | Failed / collect-request SMS, multi-record SMS (ATM + fee), statements stored | Verify against `rules.json` routes; store statements as bills (G2); record fees as second item | R5i |
| G2 | Bills and dues: card statements, biller bills, mark paid, overdue, future-debit reminders, credit limit | **Widen R5b** from "pay-later + banner" to "Bills & dues" (in-app only, no permission) | R5b |
| G3 | Chain suggestions (refund / transfer twins from templates) have no Review UI and vanish on restart | Persist chain suggestions + show in Review with accept re-check (stale/superseded) | R5i |
| G4 | No edit-account screen; balance difference has no action | **Widen R6**: missed-transaction alert (add missing → pending Add Record / set balance / dismiss) + Edit account | R6 |
| G5 | Recurring detection only planned together with notifications | **Split R8**: R8a detection + "Upcoming" card (no permission); R8b notifications (needs POST_NOTIFICATIONS — owner approval) | R8a / R8b |
| G6 | Amounts can be hidden only in Activity | Add a global "Hide amounts" toggle to R9 with app lock | R9 |
| G7 | Small leftovers: undo Ignore / Hidden accounts, restore archived category, filters reset on restart, Add Record a11y radio, backup crypto repo test, not-understood rows without content hash | One small **polish** phase | R5j |
| G8 | Loan account type (balance of a loan going down with each EMI) | Optional — only if owner wants it; principal/interest split stays out | R13 (optional) |
| G9 | No warning when auto-read silently stopped (best-effort, no wake lock) | "Last read N days ago" banner on Home | R5j |

## 4. Phase proposal (add / keep / change / drop)

| Phase | Decision | Scope | New permission / dependency? |
|---|---|---|---|
| **QA-1** device sweep | **ADD** (first) | Run device scripts for R5h + R5e (and the never-finished R3b, R4b checks) with `scripts/device/` — counts only, owner-assisted steps | none |
| **R5i** chain review + message types | **ADD** | G3 + G1 | none |
| **R5b** Bills & dues | **CHANGE** (widen) — ✅ shipped a89f37d; device debug 2026-11-21 found+fixed AddBill crash (R5b-device.md) | Pay-later accounts + card statements, biller bills, mark-paid match, overdue, future-debit reminders, credit limit; in-app due banner | none |
| **R6** Balance reconciliation | **CHANGE** (widen) | + missed-transaction alert, + Edit account | none (migration) |
| **R5c** Budgets | KEEP | As planned (overall ring + per category, 80 % amber, over red) | none |
| **R8a** Recurring + Upcoming | **ADD** (split from R8) | Subscription detection, next due, Home "Upcoming" card | none |
| **R8b** Notifications | **CHANGE** (rest of R8) | Bill due, missed transaction, weekly summary notifications | POST_NOTIFICATIONS + AlarmManager module — **owner approval** |
| **R9** Security | CHANGE (small) | App lock, FLAG_SECURE, CSV export, + global Hide amounts | biometric — **owner approval** |
| **R5j** Polish | **ADD** | G7 + G9 | none |
| **R7** SMS coverage | **DROP / MERGE** | Paging, scan window, Approve all, Not understood are done (R4b/R5); remaining "missed SMS picker" + permission-state UI move into R5j | — |
| **R10** IOUs | KEEP | As planned | none |
| **R11** Tags & receipts | KEEP | As planned | camera/picker — **owner approval** |
| **R12** Dark theme | KEEP | As planned | none |
| **R13** Loan accounts | OPTIONAL | G8 | none |
| Goals | OPTIONAL (not planned) | Savings goals — neither project has it | none |
| OTA rules download | NOT RECOMMENDED | Breaks offline-only; keep shipping rules in releases | INTERNET use |

## 5. Proposed order

1. QA-1 device sweep (no code)
2. R5i chain review + message types
3. R5b Bills & dues
4. R6 Balance reconciliation + missed-transaction alert
5. R5c Budgets
6. R8a Recurring + Upcoming
7. R5j Polish
8. R9 Security
9. R8b Notifications (only after permission approval)
10. R10 IOUs → R11 Tags & receipts → R12 Dark theme
11. Optional: R13 Loan accounts, Goals

Why this order: finish and verify what is built first (QA-1, R5i), then the
biggest money-accuracy gaps (bills, balance check), then planning features
(budgets, upcoming), then safety and extras.

## 6. Decisions needed from the owner

| # | Question | Default if not changed |
|---|---|---|
| D1 | Widen R5b to full "Bills & dues"? | Yes |
| D2 | Add missed-transaction alert + Edit account to R6? | Yes |
| D3 | Split R8 into R8a (no permission) and R8b (notifications)? | Yes |
| D4 | Drop R7 and move its leftovers into R5j? | Yes |
| D5 | Add R13 Loan accounts? | No (optional) |
| D6 | Add savings Goals? | No |
| D7 | Over-the-air rules download? | No (offline only) |
| D8 | Approve the order in section 5? | Yes |

After approval: ROADMAP.md and STATE.md get the approved phases, and each
phase gets its own prompt under `prompts/` as usual.
