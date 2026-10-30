# Known bugs (fix later)

| ID | Found | Where | Bug | Status |
|---|---|---|---|---|
| B1 | 2026-10-28 (R1) | src/features/transactions/screens/TransactionsScreen.tsx:36 | Date section headers use a fixed fixture "today" (1 Oct 2026) instead of the device clock, so TODAY / YESTERDAY labels are wrong. Pre-existing. | open — user: fix later |
| B2 | 2026-10-29 (R2) | Screen headers with back arrow (e.g. Uncategorised quick-assign; same pattern on other headers) | Back arrow touch target ~22dp, below 48dp minimum; a tap missed on device (system Back works). | open |
| B3 | 2026-10-29 (R2) | Activity screen | Once, revealed amounts flipped back to masked without navigation; not reproducible. Safe direction (hides). Likely focus event re-firing. | open, low |
| B4 | 2026-10-30 (R3a) | Activity sentence helper | Sentences are built from the current row, so the original "added" event of an expense later marked as a transfer now reads "You moved …". History should describe the row as it was at event time. | open, low |
