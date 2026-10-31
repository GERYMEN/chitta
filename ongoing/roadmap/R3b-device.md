# R3b device pass (release build of 3164a4f): report

Executor: Claude subagent. Date: 2026-10-31. Device USB 00015365L001524. Nothing was committed. Only this file was written in the main project. The worktree source was not edited.

## Summary

- **Build: yes.** `./gradlew assembleRelease` in the worktree `scratchpad/tracker-r3b` at commit 3164a4f gave BUILD SUCCESSFUL in 20 m 14 s.
  - The APK bundle contains the R3b.1 strings (for example "A linked refund must stay income", "View original SMS" and "Link to original expense").
- **Install: OK.** `adb install -r` returned `Success`. There was no INSTALL_FAILED_UPDATE_INCOMPATIBLE.
  - `firstInstallTime` is unchanged (2026-10-25), so the data was kept.
  - `lastUpdateTime` is 2026-10-31 16:00:55. The package is not debuggable.
  - Cold launch with `am start -W` gave Status ok.
- **Checks: D1, F1, D1b, D2, D4, F2, D3 and D5 were NOT RUN.** Two separate reasons:
  1. **The QA fixture is gone.** "QA Delete Bank 9999" does not exist in the app data. The phone has 6 active accounts, none named QA, and there is no "Deleted accounts" section at all. The earlier soft-deleted "QA Wallet 8888" is gone too. So the app data appears to have been reset since R3a (`firstInstallTime` is unchanged, so this was a storage clear, not a reinstall). I started to recreate the QA bank through the app's Add Account screen (the R3a precedent for a missing QA account). It was **never saved**.
  2. **The owner started using the phone.** The executor run was interrupted by an API usage limit while that form was open. On resume, the launcher was in front, which the executor did not cause. I watched only the package name and lock state for 10 minutes:
     - WhatsApp, the launcher, the notification shade and Snapchat came to the front in turn.
     - Tracker did not come back within the 10 minutes, so I stopped.
     - Shortly afterwards Tracker was in front again. A 3-minute idle check then saw the notification shade open, which the executor did not do. So the owner was still using the phone, and no further taps were made.

## Check results

| Check | Result | Notes |
|---|---|---|
| Build | PASS | assembleRelease OK. install -r Success, data kept. Cold launch OK. |
| D1 Refund | NOT RUN | The QA bank is missing (being recreated when interrupted); then the owner was using the phone. |
| F1 Edit guard | NOT RUN | Same. |
| D1b Unlink | NOT RUN | Same. |
| D2 Duplicate | NOT RUN | Same. |
| D3 Real counts | PARTIAL | See below. |
| D4 Activity | NOT RUN | Same. |
| F2 Uncategorised | NOT RUN | The screen was not opened. The Home card showed **15 uncategorised** at launch (count only). The link and row counts were not taken. |
| D5 Cleanup / logcat | PARTIAL | No QA rows were created, so there was nothing to delete. Logcat details are below. Force-stop was not done because Tracker was in front in the owner's hands. |

**D3 (counts only, read once on Home and Pending at launch)**
- The Home "N to review" card was not shown, so the count was **0**.
- "Possible duplicates · N": 0 headers present, so **0**.
- "Looks like a transfer · N": **0**.
- Pending showed "0 waiting".

**D5 logcat (counts only)**
- 16,950 lines in the main, system and crash buffers since the install.
- The buffer had rolled over: the earliest line available is 10-31 16:08:01, and the install was at 16:00:55. So the cold launch and the first minutes are **not covered**.
- In the covered window:
  - FATAL com.tracker = 0.
  - FATAL in another process = 1. This is not Tracker; it was checked with `Process:`.
  - "Maximum update depth" = 0.
  - ReactNativeJS E = 0 for any pid.
- Force-stop + relaunch was not done (see above).

## What ran on the phone

Every tap and dump went through a guard that aborts. The guard requires:
- every `mCurrentFocus`/`mFocusedApp` line to contain com.tracker;
- `isKeyguardShowing=false`;
- `mWakefulness=Awake`.

Handling of dumps:
- Each dump was read in memory only, never written to the Mac.
- `/sdcard/u.xml` was removed after each one.
- Any dump containing a non-Tracker window would have been dropped unread.
- Output was limited to fixed labels, QA strings, counts and coordinates.

Steps, in order:

1. **Before install:** read-only state checks (focus package, keyguard, wakefulness, `wm size`, screen-off timeout 5 min, call state idle).
2. **Install and launch.** Install `-r`, then `am start` from the launcher. The launcher was in front only because the install killed Tracker.
3. **Home:** labels read. The INCOME/EXPENSES values were captured to a private file (mode 600) that was never printed. It was deleted at the end.
4. **Accounts tab:** a scroll-scan looking for QA labels.
   - Result: 6 distinct accounts, 0 QA nodes, 0 accounts ending in 9999, and no "Deleted accounts" header.
5. **Add New Money Source → Add Account form**, typing only synthetic text:
   - Name "QA Delete Bank 9999", type Bank Account, last 4 "9999", opening balance "1000".
   - The balance field had a default "0", so it was cleared and retyped.
   - **"Save Account" was never tapped.**
6. **Interrupted** by the executor's API limit.
7. **On resume:** guard ABORT (launcher in front). Watched the package name and lock state only for 600 s; Tracker did not come back.
8. **Afterwards:**
   - One logcat count, read-only.
   - One grep-filtered dump once Tracker was back in front. It showed the same unsaved Add Account form with QA text only.
   - A 3-minute idle watch saw the notification shade, so I stopped.

What was not done:
- No other app was inspected; only package names from the focus lines were read.
- HOME was never pressed.
- There were no screenshots, no database access, no uninstall and no clear-data.
- No real item was touched, and Sync SMS was not tapped.

## Leftover synthetic data and state

- **No QA data was saved.** No account, transaction or audit row was created by this run, and the private capture file is deleted.
- **Attention: the unsaved Add Account form is still open on the phone** with QA values. If someone taps "Save Account", a synthetic "QA Delete Bank 9999" (opening ₹1,000) is created. The owner can leave the screen with Back to discard it.
- The R3b release build of 3164a4f is installed. Tracker was **not** force-stopped, because it was in front while the owner was using the phone.
- The worktree `scratchpad/tracker-r3b` was left in place for the next attempt (the orchestrator removes it).

## For the retry

- **Recreate the QA fixture.** "QA Delete Bank 9999" must be created via Add Account (Bank Account, last 4 9999, opening 1000). Suggestion: soft-delete it after the checks so its ₹1,000 does not inflate the owner's TOTAL BALANCE now that the data has been reset.
- **Device facts:**
  - Screen 1260×2800, density 480.
  - testIDs show up as resource-ids.
  - The accessibility tree is **flat** (card contents are siblings), so values must be located by document order and geometry, not by parent card.
- **Retry needs:** a free phone for about 30–40 minutes, plus a logcat clear or a background count right after install so the first minutes are covered.
