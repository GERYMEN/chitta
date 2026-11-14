# R5 device pass (R5 + R5d + R5g): PARTIAL, stopped because the owner was using the phone

Date: 2026-11-14 (device clock 12:00 to 13:31). Device: the owner's phone over wireless
debugging (192.168.1.20:34385). Build: debug-signed 0.10.0-beta (versionCode 3) from the
orchestrator scratchpad. Counts only. No database access, no screenshots, no logcat bodies.
No real SMS, row, merchant, name or amount was opened or printed. Money totals were only
compared inside a single shell process (SAME/DIFFERENT).

Owner OKs: RESCAN=yes, AUTOREAD_TOGGLE=no.

## Why it stopped

- Before the first action the phone was idle for 2 minutes. A second 2-minute idle wait
  was needed before the install, because another app came to the front.
- During the first re-scan's toast wait, another app came to the front at about 520 s.
  The script's guarded taps then aborted.
- From then on the owner kept switching between Tracker and other apps:
  - two more 2-minute idle waits succeeded;
  - the last 10-minute watch never saw 2 idle minutes in a row (Tracker and other apps
    alternated), so the run stopped there.
- The owner also scrolled Home in Tracker. One guarded tap at the greeting position
  landed on the scrolled Home ("Where it went" area). No navigation happened.
- The run was not force-stopped, because the owner was using Tracker.

## Checks

| Check | Result |
|---|---|
| D1 Install + launch | PASS. `install -r` succeeded; data kept (firstInstallTime unchanged, 2026-11-10 11:59:35); `am start` ok; same PID through the run; 0 FATAL / 0 ANR for com.tracker. |
| D2 About row | PASS. "SMS rules v4 · 49 banks". |
| D3 Reader hint | ABSENT. No "Tracker reads bank SMS better now" on Home. 0.10.0-beta was already installed on 2026-11-10 (user 0 firstInstallTime = that day), so there were probably no v1 items left. |
| D4 Before counts | Pending: 0 waiting (All 0; Auto-approve (0) shown). "N not understood" link: absent (0). Settings "Messages not understood: 0". |
| D5 Auto-read registration | PASS. Device resolver table: com.tracker/.SmsReceivedReceiver for android.provider.Telephony.SMS_RECEIVED. Installed APK manifest: receiver permission android.permission.BROADCAST_SMS, exported=true. RECEIVE_SMS requested, granted=false (READ_SMS granted=true). Settings row "Read new SMS automatically. Off. Turn on". Toggle: skipped (no owner OK). |
| D6 Re-scan 1 | DONE, partly recorded. No large-scan dialog. Toast not captured (accessibility-event listener got no toast line). Newest sms_rescan Activity line: "You re-read your messages with the new reader: 0 new" / "Scanned 43 SMS · existing items unchanged" (0 not understood, 0 auto-approved, 0 to check: the zero parts are left out of the sentence). Via rule / via reader / held per money kind: not shown in the app UI, so not readable without db access. Pending after: 0 waiting, 0 "two readers disagree" cards = held for disagreement 0. Not-understood link after: absent (0). Transactions settled count before: 30. Money total SAME/DIFFERENT: NOT CAPTURED (the owner took the phone before the after-read). |
| D7 Re-scan 2 | NOT RUN. Two attempts aborted before the Re-read tap: first a guard failure, then the rescan row was not found on Home, which the owner had scrolled. Settled count read again before the second attempt: 30 (unchanged). |
| D8 Manual Add Record (QA-Merchant-30, ₹1) | NOT RUN (owner using phone). Nothing created. |
| D9 Linked numbers per account | NOT RUN (owner using phone). |
| D10 Finish | FATAL 0 / ANR 0 for com.tracker since install (12:04 to 13:31, 17,609 log lines scanned, counts only). Force-stop NOT done: the owner was using Tracker. |

## Cleanup

- Nothing was created by this run: no QA account, no QA transaction.
- Leftovers from the stopped R4c pass (QA-Merchant-20/21, QA Wallet 8888) and QA Delete
  Bank 9999 were NOT checked or removed.
- No settings were changed. No uiautomator process and no /sdcard/u.xml were left on the
  phone.

## Unexpected

- The app's user-0 firstInstallTime is now 2026-11-10 11:59:35. The earlier date belongs to
  user 11 (Private space, not installed). So between the R4c pass and today, the app was
  reinstalled fresh for the owner (uninstall + install).
- Only 43 SMS are in the re-scan window (sync start is recent). Pending is 0 and
  not-understood is 0, so the disagreement and money-kind checks were trivially zero.
- Toast capture with `uiautomator events` did not work. The Activity line is the
  reliable source for the counts.

## Still to run (needs the phone idle)

D6 money SAME/DIFFERENT, D7 second re-scan (created must be 0), D8 QA-Merchant-30 add +
delete, D9 linked-number counts, QA leftover cleanup, force-stop.

## Completion run (orchestrator, USB, 2026-11-14 afternoon)

Owner asked for USB, a 30 s idle wait (instead of 2 min) and live status per test. Run inline by the
orchestrator with a guarded helper: Tracker-in-front check before every tap and dump, dumps filtered
on the device, only fixed UI labels, counts and count-only phrases printed.

| Check | Result |
|---|---|
| D6 money SAME/DIFFERENT | Not needed: re-scan 1 created 0 items, so no balance could change. |
| D7 Re-scan 2 | PASS. Activity: 2 re-read entries; newest "0 new", "Scanned 44 SMS · existing items unchanged" (one SMS arrived since run 1; not a transaction). |
| D8 Manual Add Record | PASS. QA account "QA Delete Bank 9999" created; ₹1 expense "QA-Merchant-30" (Uncategorised) saved; found once in Transactions, 0 in Pending (Pending empty). The final Save tap was done by the owner, because adb swipes stopped scrolling the form after the phone woke from sleep. |
| D9 Linked numbers | 8 accounts, 3 linked card/account numbers in total (counted by hashing labels; none printed). |
| QA leftovers | None. QA-Merchant-20/21, QA Wallet 8888 and QA Delete Bank 9999 were absent before this run (fresh install on 2026-11-10). |
| Cleanup | QA-Merchant-30 deleted ("Delete transaction?" confirmed). QA Delete Bank 9999 removed ("Remove account?" confirmed). Transactions search cleared. |
| D10 Finish | FATAL 0, ANR 0 for com.tracker since 12:04. Force-stopped; launcher in front. |

Findings:
- Add Record: account options have no accessibility role/state (the selected account cannot be told apart by TalkBack or automation; the removed-account option does have radio role). Small a11y fix for a later phase.
- The first Save without a category stayed on the form ("Category is required" by design).
- The phone's screen timeout (about 30 s) slept the screen twice mid-run. Device runs need a longer timeout.
