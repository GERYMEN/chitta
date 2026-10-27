# Device safety rules (non-negotiable)

The connected Android phone is the owner's PERSONAL daily-driver device with a real SMS
inbox and real apps. These rules came from real incidents in earlier phases (a run
dumped real SMS content from the Messages app; another leaked a real merchant/amount via
an unfiltered UI dump; another pushed a hand-edited database). Include them verbatim in
every executor prompt that touches the device.

## Environment
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
# Metro: if 8081 is not serving
npx react-native start &   # then:
adb reverse tcp:8081 tcp:8081
```
Do not change SDK / NDK / build-tools version pins.

## Rules
1. **App isolation.** Interact ONLY with `com.tracker` (plus the system permission dialog
   when expected). Before EVERY tap:
   `adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` — BOTH lines must
   contain `com.tracker`. (Do not rely on the first `topResumedActivity` line alone:
   that command prints several lines and once missed WhatsApp in front.)
   If anything else is in front, press back/home to return to Tracker. Never inspect,
   dump, or read the other app.
2. **No personal data in output.** Never log, print, write to file, or quote SMS bodies,
   sender numbers, or merchant names/amounts derived from real SMS. SMS verification is
   COUNT-ONLY (created=N, badge=N, suggestions=N).
3. **Filtered UI dumps.** On Home, Pending, Transactions, Transaction Detail, Accounts,
   Suggestions, Hidden accounts: filter `uiautomator dump` to the one element needed, e.g.
   `adb shell cat /sdcard/u.xml | grep -o 'text="Sync SMS"[^>]*bounds="[^"]*"'`.
   Never print a full dump. Delete `/sdcard/u.xml` afterwards.
4. **No screenshots** unless Tracker is confirmed focused AND text evidence is
   insufficient. Prefer logcat, `pidof`, filtered dumps.
5. **Never touch the database directly.** No reading, writing, pushing, pulling, or
   `sqlite3` / `run-as cat` / `run-as cp` against `tracker.db` or any file in the app's
   data directories — for ANY reason. If app data is empty, recreate what's needed through
   the app's own screens (Add Account, Add Record) with real taps.
6. **Synthetic data only** for anything you type (e.g. "QA Test Bank 0001",
   "QA-Merchant-01").
7. **No uninstall / clear data** unless the phase prompt explicitly approves it. It wipes
   real synced data (regenerable by re-sync, but only with the user's consent).
8. Before finishing, grep your own run log and report for anything resembling a real
   merchant, phone number, or SMS text; redact and say you did.

## Crash checks (report counts only)
`FATAL EXCEPTION`, `AndroidRuntime: FATAL`, `Maximum update depth`, `ReactNativeJS` errors,
process died.
