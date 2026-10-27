# Phase 16: Device verification of Phases 14 and 15

Executor: Claude subagent. Nothing was committed to git. No code was changed.

## Setup

- I built with `./gradlew assembleDebug` and installed with `adb install -r`. Both succeeded.
- Metro was already running. I ran `adb reverse tcp:8081 tcp:8081` before launching the app.
- The phone was on USB the whole run (serial 00015365L001524). It never disconnected.

## Results

| # | check | result |
|---|---|---|
| 1 | Record the Home and Accounts totals | PASS. Both were saved to scratch files without being printed, and those files were deleted at the end. Only deltas are reported below. |
| 2 | Add "QA Delete Bank 9999" (Bank, last four 9999, opening 1000), then add and approve the expense QA-Merchant-06 for 100.00 | PASS. The Accounts total went up by 1000.00 when the account was added. After approval, the card read "Approved Ledger Balance ₹900.00" and the Accounts total was +900.00 against the baseline. |
| 3 | Remove the account, with a confirm dialog | PASS. The dialog appeared ("Remove account?" with Cancel and Remove). After Remove, the Accounts total dropped by exactly 900.00 and the Home total was back to its baseline (delta 0.00). The account was gone from the main list, and "Deleted accounts (N)" listed "Deleted account ••9999 (QA Delete Bank 9999)" with a Restore button. |
| 4 | The transaction is kept and labelled | PASS. QA-Merchant-06 was still in Transactions. Its detail screen showed "Deleted account ••9999 (QA Delete Bank 9999)" in both the meta line and the Account row. Spent still included the 100.00: deleting the transaction in step 9 lowered SPENT by exactly 100.00. |
| 5 | The Add Record picker leaves the removed account out | PASS. I scrolled the whole picker and "QA Delete Bank 9999" appeared 0 times. |
| 6 | Edit on QA-Merchant-06 | PASS. The "Edit Transaction" form opened without crashing. It showed the deleted account option as selected (checked=true) with the note "This account was removed. The record stays on it unless you pick another account." The active list did not contain the account. I left with Back and saved nothing, and the detail screen was unchanged. |
| 7 | Sync SMS | PASS. The app opened the existing "New Accounts Found" screen and the process stayed alive. Logcat had 0 FATAL, 0 "Maximum update depth" and 0 ReactNativeJS errors. No suggestion mentioned 9999. Nothing was read beyond counts, and Back returned to Home. |
| 8 | Restore | PASS. "Deleted accounts" went from (2) to (1). The account was back in the main list, the Accounts and Home totals each rose by 900.00, and the Add Record picker listed it again. The transaction detail label went back to "QA Delete Bank 9999 ••••9999". |
| 9 | Cleanup | PASS. QA-Merchant-06 was deleted through the "Delete transaction?" confirm and appears 0 times in Transactions. The account stays RESTORED with a balance of ₹1,000.00, so Accounts and Home are each +1000.00 against the baseline. |
| 10 | Read the current settings in the Home settings sheet | PASS. Original values: **Auto-approve OFF (manual), threshold 95%**. The name field showed "QA User", which was already the value at the start of this run. |
| 11 | Layout and switch behaviour | PASS. The Save button stayed at bounds [72,2464][1188,2632] with the switch OFF and ON, so it did not move. With the switch OFF, the slider reported enabled=false, a swipe on its thumb left the value at 95%, and the text "Turn on Auto-approve to use the threshold" was shown. With the switch ON, a swipe changed the value from 95 to 87. See finding F2 for a small remaining height change. |
| 12 | Restore the owner's settings | PASS. I moved the slider back to exactly 95 and switched it OFF. I closed the sheet with Back and did not tap Save. When I reopened the sheet it showed OFF, 95%, and the name "QA User", the same as the originals. |
| 13 | Force-stop, relaunch and check logcat | PASS. After relaunch the Home total was unchanged, the settings were still OFF and 95%, the QA account still showed ₹1,000.00, and "Deleted accounts (1)" was unchanged. Logcat over the whole run had 0 FATAL EXCEPTION, 0 AndroidRuntime lines for com.tracker, 0 "Maximum update depth" and 0 ReactNativeJS errors. The app was force-stopped at the end. |

## Findings (not fixed, because they are minor and not functional bugs)

- **F1 (copy):** the remove dialog for one transaction reads "Its 1 transaction stay in your history". It should say "stays" when there is one transaction. The text is built in `AccountsScreen.tsx` (the remove-confirm message).
- **F2 (layout, minor):** the Save button does not move, but the sheet's top edge grows by 60px when the switch is turned ON.
  - The switch moved from y=1667 to y=1607, and the threshold block grew from 360 to 420px.
  - The cause is that the ON helper text ("SMS transactions with confidence ≥ N% …") wraps to 2 lines, while the OFF text takes 1 line.
  - The old jump was about 324px. A fix would be to give that helper `Text` a 2-line `minHeight`.
- **Observation:** "Deleted accounts" already contained 1 account that was not created in this run, so the section showed (2) while the QA account was removed. That account was not touched, opened or printed.

## Leftover synthetic data

- The account "QA Delete Bank 9999" (Bank, last four 9999) is still active with an opening balance of 1000. It adds +1000.00 to the Home and Accounts totals. This was left in place on purpose, as the prompt asked. The owner can remove it with "Remove account".
- QA-Merchant-06 was deleted.
- The 2 "QA-Merchant-05" pending records from Phase 12 were not touched.

## Device safety

- **Foreground check:** `dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` ran before every tap and every dump, and both lines had to show com.tracker.
- **Phone call during the run:** partway through, the Dialer came to the front because of an active phone call (call state was off-hook).
  - I did not inspect the Dialer, and I did not press HOME over the call.
  - I waited, polling only the call-state number, until the phone had been idle for about 3 minutes. Tracker then returned to the front by itself.
  - One Save tap was blocked by the check and resent afterwards.
- **Dumps:** every dump was filtered to one element: my own synthetic labels, testIDs or counts. Totals were extracted to scratch files without being printed, and only deltas were printed. `/sdcard/u.xml` was removed after each dump.
- **Data not printed:** no SMS bodies, senders, real merchants, real account names or real amounts.
- **Owner's accounts:** none were removed, restored or edited.
- **Forbidden actions:** none. No tracker.db, sqlite3 or run-as access, no uninstall, no clear-data and no screenshots.
- **Leak scan of this report:** it contains only synthetic QA names, UI labels, testIDs, bounds, deltas and counts.
