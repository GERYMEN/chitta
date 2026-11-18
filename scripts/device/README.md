# Device test scripts (physical phone, USB debugging)

Scripted phone checks for Tracker. One script per phase, shared helpers in
`lib.sh`. Physical phone over USB only — no emulator, no Wi-Fi adb.

## Safety rules built into the scripts

- Touch **only** Tracker (`com.tracker`). Before every tap or screen read the
  script checks Tracker is in front; if another app is open, the phone is
  locked or the screen is off, the run **stops** at once.
- Never unlocks the phone, never types a PIN, never presses Home/Back over
  another app.
- Never prints SMS text, names, merchants or amounts. Output is limited to
  fixed UI labels, item counts, `SAME`/`DIFFERENT` and hashed values.
- Never approves, edits, deletes or links your items by itself. Steps that
  need a real item (`--assisted`) wait for **you** to tap; the script only
  watches counts.
- Never uninstalls or clears data. An install that would need that
  (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) stops the run.
- Full step log goes to `ongoing/device-logs/` (git-ignored). The terminal
  shows one line per check.

## Before you start

1. On the phone: Settings → Display → **Screen timeout: 5 min or more**
   (the phone sleeps after ~30 s and the run would stop).
2. Developer options → **USB debugging** on. Plug in the USB cable, unlock the
   phone and accept the "Allow USB debugging" prompt.
3. On the Mac, check the phone is seen:
   ```
   adb devices        # one line ending in "device"
   ```
4. Leave the phone on the home screen or in Tracker. The script waits until
   the phone has been idle for 30 s before it starts.

## Install an update only

```
scripts/install-release-usb.sh                # your phone (debug-signed release)
scripts/install-release-usb.sh --release-key  # tester phones (private release key)
scripts/install-release-usb.sh --no-build     # reinstall the last built APK
scripts/install-release-usb.sh -s SERIAL      # pick a phone when several are attached
```

Builds the release APK, prints the signing certificate fingerprint, installs
with `adb install -r` (data kept) and shows the version before → after.

## R5h — every SMS sync lands in Pending

```
scripts/device/r5h.sh [--skip-install] [--rescan] [--assisted]
```

| Option | Meaning |
|---|---|
| *(none)* | Build + install the update, then run R1–R8 |
| `--skip-install` | Test the app already on the phone |
| `--rescan` | Also re-read messages and check the exact count (R9) |
| `--assisted` | You approve one item and tap Undo; the script checks counts (R10) |

Recommended full run:

```
scripts/device/r5h.sh --rescan --assisted
```

### Checks

| Check | What happens | Pass when |
|---|---|---|
| R0 | Install the update (data kept) | install `Success` |
| R1 | Wait 30 s idle, open Tracker | Tracker in front |
| R2 | Read the Pending badge | — (count recorded) |
| R3 | Read Transactions totals (hashed) | — (recorded) |
| R4 | Tap **Sync SMS** on Home, wait up to 5 min | sync finishes |
| R5 | Pending badge again | Pending did not go down |
| R6 | Transactions totals again | `SAME` (nothing approved silently) |
| R7 | Open Settings (tap the Home greeting), scroll | "Synced items always wait in Pending…" shown |
| R9 | `--rescan`: Settings → Re-read messages with the new reader | Pending rises by exactly the Activity "M new" count; totals `SAME` |
| R10 | `--assisted`: **you** approve one item in Pending, then tap **Undo** in the message | Pending −1, then back; totals `SAME` after Undo |
| R8 | Crash check since the start | 0 FATAL/ANR |

### What you do during the run

- Do not use the phone until the script says otherwise.
- At **R10** (only with `--assisted`): the script opens Pending and prints
  "approve ONE item, then tap Undo". Approve any one item, then tap **Undo**
  in the message at the bottom. You have 3 minutes for each tap.
- If you need the phone, just switch apps — the script stops safely. Run it
  again later with `--skip-install`.

### Reading the result

```
▶ R5 — Pending count after: rises by the new items, never falls
  Pending after: 14 (change 3)
  ✔ PASS R5
...
SUMMARY pass=10 fail=0 skip=0 · log: ongoing/device-logs/r5h-20261115-113000.log
```

- `✖ FAIL … not found` usually means a screen label differs on your phone —
  send the SUMMARY lines; the label gets fixed in the script.
- `✖ ABORT: Tracker not in front` — the run stopped to protect your phone;
  nothing else was touched.

## R5b — Bills & dues

```
scripts/device/r5b.sh [--skip-install]
```

Owner-assisted: the script never adds, pays or deletes bills by itself. It
asks **you** to add synthetic QA rows and only checks counts, the Home due
banner and fixed labels. QA data only — **QA Pay Later 9999** account and
**QA-Bill-01 / QA-Bill-02** manual bills — and you clean them up at R9.

| Check | What happens | Pass when |
|---|---|---|
| R0 | Install the update (data kept) | install `Success` |
| R1 | Wait 30 s idle, open Tracker | Tracker in front |
| R2 | Accounts screen | "Bills & dues" entry shown |
| R3 | **You** add account "QA Pay Later 9999" (type Pay Later, with a Credit Limit) | account appears (grouped under CREDIT CARDS & PAY LATER) |
| R4 | **You** add "QA-Bill-01" due **tomorrow** | Home due banner appears |
| R5 | **You** tap Mark paid on QA-Bill-01 | banner clears |
| R6 | **You** tap Undo in the snackbar | banner returns |
| R7 | **You** add "QA-Bill-02" due **yesterday** | Bills shows an Overdue section |
| R8 | Bills screen sections | at least one section visible |
| R9 | **You** remove the QA bills and the QA Pay Later account | QA Pay Later gone |
| R10 | Crash check since the start | 0 FATAL/ANR |

During the run the script prints `>>>` lines telling you exactly what to add
or tap; you have ~3 minutes for each. Switch apps any time to stop it safely,
then resume with `--skip-install`.

## Writing a script for a new phase

Copy `r5h.sh`, keep `source "$(dirname "$0")/lib.sh"` and use only the
helpers: `pick_device`, `wait_idle`, `launch`, `tap`, `has`, `count`,
`hashes`, `tab_badge`, `grab_first` (count-only regexes only), `swipe_up`,
`back_if_tracker`, `fatal_count`, `begin`/`pass`/`fail`/`skip`/`summary`.
Never add a helper that prints a full screen dump or raw text.
