# competitor-research — STATE

Goal: collect next-phase requirements by touring Axio (com.daamitt.walnut.app)
and Splitwise (com.Splitwise.SplitwiseMobile) on the owner's phone.
Executor = Claude subagent (see realtime-persistence decisions log).

| # | Task | Report | Status |
|---|---|---|---|
| 01 | axio-splitwise-tour | 01-axio-splitwise-tour.md | DONE — 15 Axio + 10 Splitwise screens, view-only. Report leak-clean (features/layout only, placeholders). Screenshots deleted by orchestrator after review. Incident: phone locked mid-Splitwise; one chained tap + 3 swipes + screenshot hit the keyguard (focus check printed but script did not stop); that screenshot deleted unopened, no PIN entered. Splitwise Friends/Activity captured before lock; final HOME not sent. Output: P0 merchant→category memory, transfers/refunds/duplicates, category breakdown, real Transactions filters; P1 budgets, missed-SMS flow, audit timeline, SMS-vs-tracked balance, recurring reminders, app lock; P2 IOUs, tags/receipts, weekly summary, export/backup, merchant history, dark theme. NEXT: user picks scope for next phase. |

## Decisions log

- 2026-10-28: User explicitly approved (this task only) opening Axio and
  Splitwise over adb in view-only mode and taking screenshots, stored only in
  the session scratchpad, never in repo, deleted after review. The standing
  "only com.tracker" rule still applies to every other task.
- Lesson: device scripts must ABORT on a failed foreground check, not just
  print it. Chain one action per command, or `|| exit` on the check.
