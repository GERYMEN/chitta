# Acceptance criteria (Given / When / Then)

Verify on device using count-only evidence and synthetic data
(see device-safety-rules.md). Unit-test the pure functions.

## D1 Scan window
- Given "Last 90 days" chosen on day X, when sync runs on day X+30, then no SMS older
  than X−90 is read.
- Given "From install" on a fresh install, when Sync SMS is tapped, then the app shows
  the "new bank SMS" message, not an empty dead end, and does not crash.
- Given the window widened from 30d to Whole inbox, when backfill completes, then older
  transactions are added and a following re-sync reports created=0.
- Given the window narrowed, then no existing transaction is deleted.

## D2 Scan
- Given a running scan, when the process is killed (`adb shell am kill com.tracker`) and
  the app relaunches and syncs, then final counts equal an uninterrupted run and a second
  sync reports created=0.
- Given 2,000+ candidate SMS, then progress updates at least once per chunk and the UI
  stays responsive.

## D3–D6 Suggestions
- Given synthetic SMS in every last-four format for one account, when normalized, then
  exactly one key results.
- Given 1 transactional SMS for a key → no suggestion; 2 → suggestion; promos only → never.
- Given shown suggestions, when the user presses back and syncs again, then the same
  suggestions reappear.
- Given an ignored key, when new SMS for it arrive and sync runs, then no suggestion
  appears and no transactions are imported for it.
- Given an ignored account is un-hidden, when sync runs and it is approved, then its
  history imports with no duplicates.
- Given a manual account linked to a suggestion, then matching SMS route to it and no
  new account is created.
- Given three suggestions approved in one session, then exactly one full rescan runs.

## D7 Balance anchor
- Given an SMS account with no parsed balance and a skipped prompt, then it shows
  "Set balance" and is excluded from total balance (never ₹0 or negative).
- Given anchor X at time T, approving a transaction before T leaves balance unchanged;
  approving one after T changes it by its exact paise amount.

## D8 Bulk approve
- Given 142 high, 28 medium, 12 low pending, when bulk approve is confirmed, then exactly
  142 are approved and 40 remain pending.
- The warning shows tier counts and balance-affecting vs history-only counts, and no
  accuracy percentage.
- Given bulk approve killed mid-run, when re-run, then every eligible item is approved
  exactly once.

## D9 Periods
- Given any cold start, when Home opens, then the period is 1M and totals equal the SQL
  sum for the 1st of this month → now, in integer paise.
- Given 3M selected, then the range starts on the 1st of the month two months back.
- Changing the period never changes any account balance.
- Given a period starting before `sms_scan_from`, then "Data available from <date>" shows.

## D10 Soft delete
- Given account ••1859 with transactions is deleted, then its transactions show
  "Deleted account ••1859 (HDFC)", it is absent from pickers and total balance, its
  transactions still count in period spending, and new SMS for that key are not imported.
- Given the deleted account is restored, then it reappears in pickers and SMS from the
  gap since deletion are imported exactly once.
- Given a suggestion whose key matches a deleted account, then Restore is offered, not Add.

## D11 Permissions
- Given permission permanently denied, when Sync is tapped, then a settings deep-link
  and manual Add Account are offered; no crash.
- Given permission revoked mid-scan, then committed chunks remain and a typed error
  message shows; no crash.
