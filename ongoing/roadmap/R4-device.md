# R4 device pass (combined R3b + R4 + B1–B6) — summary

Written by the orchestrator from the device executor's two hand-backs
(the executor was paused twice by the owner before it could write this
file). Synthetic QA data only; real values were only ever compared
(SAME/DIFFERENT or QA-only deltas), never printed.

Build: release APK of phase/R4-insights, rebuilt with the B6 fix;
install -r kept data (first install time unchanged).

| Check | Result |
|---|---|
| D1 refund link (QA-Merchant-10) | PASS — top candidate; Home income −100, expense −100; balance unchanged; "Refunded ₹100.00" |
| F1 edit guard | PASS — amount below refunded blocked; refund type change blocked |
| D1b unlink | PASS — deltas back to 0 |
| D2 duplicates (QA-Merchant-11) | PASS — mark: expense −50, bank +50; restore: 0 |
| D3 real counts | 0 possible duplicates, 0 transfer suggestions |
| D4 Activity masking | PASS — 13 masked QA sentences |
| F2 Uncategorised | counted 15 rows / 15 "View original SMS" links (none tapped) |
| Period chips | PASS — captions change per period |
| Where it went | PASS — +200 / +50 deltas; tap category → filtered list |
| Merchant chip | PASS — "1 visit · ₹200 this month"; filter chip removable |
| Insights + Trends | PASS — 1M 3 bars; 1Y 13 bars, no overlap |
| B1 TODAY header | PASS |
| B2 back buttons | PASS — 48×48dp on 6 screens |
| B3 Activity reveal | PASS — stays revealed ~1.5 min; masked after leave + return |
| B4 history wording | PASS — added/approved lines read as expense; mark line "You moved" |
| B5 tiles follow period | PASS (records start 14 Oct 2026, so 1M = 1Y as expected) |
| B6 Not a duplicate re-suggested | PASS after fix — pair not suggested again |
| Final logcat / force-stop | NOT RUN — owner unplugged the phone |

Owner activity seen during the run (not the executor): the QA-Merchant-11
pair was marked duplicate again; Uncategorised went 15 → 11.

Cleanup: all 7 QA transactions deleted; QA Delete Bank 9999 back to
₹1,000 then "Remove" tapped (removal not confirmed on screen). Left: QA
Wallet 8888 active (₹0). Merchant filter chip is 36dp visually but its
hitSlop (6+6) gives a 48dp touch target — no change.
