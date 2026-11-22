#!/usr/bin/env bash
# R9b device pass: App lock (BiometricPrompt, device-credential fallback) and the
# relabelled "Private mode" row. Counts of fixed labels only.
#   scripts/device/r9b.sh                 # build + install update, then test
#   scripts/device/r9b.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker. The script flips NOTHING: it never
# turns App lock or Private mode on or off, never types a PIN, never taps the
# biometric prompt. The biometric / PIN prompt is a system window that adb
# cannot (and must not) drive, so the real lock and unlock are MANUAL steps for
# the owner (R5). The "no screen lock set up" message needs a phone without a
# lock, so it is listed as manual too (R6). No amounts/names printed, no
# screenshots, no db access.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

PRIVATE='Private mode\..*'
OLD_HIDE='Hide amounts\..*'
APPLOCK='App lock\..*'

wait_label() {  # $1 = ERE, up to ~3 min, owner acting
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

pick_device
say "Tracker R9b device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "Home opens with the existing data intact (App lock is OFF by default)"
tap 'Home(, tab.*)?' 1.5 >/dev/null 2>&1 || true
if has 'Recent Transactions' || has 'Pending Approval'; then pass "Home reachable"; else fail "Home not shown"; fi

begin R3 "Settings lists App lock and the relabelled Private mode row"
say "  >>> open Settings (tap the greeting at the top of Home)."
if wait_label "$PRIVATE"; then
  OK=1
  has "$APPLOCK" || { OK=0; say "  missing: App lock switch"; }
  has "$OLD_HIDE" && { OK=0; say "  old 'Hide amounts' label still present"; }
  [ $OK -eq 1 ] && pass "App lock + Private mode present, old label gone" || fail "a row is missing or stale"
else fail "Settings not open / no Private mode switch"; fi

begin R4 "App lock row shows its current state"
if has 'App lock\. (On|Off).*'; then pass "state exposed"; else fail "App lock state label missing"; fi

begin R5 "App lock lock/unlock (MANUAL — script does not test it)"
skip "owner: (1) turn App lock ON; (2) press Home, reopen Tracker: the lock screen appears and the fingerprint/face or screen-lock prompt opens; (3) cancel the prompt: still locked, tap Unlock: prompt returns; (4) unlock: app opens where you were; (5) set 'Lock again' to After 1 min: leave 30 s and return = no lock, leave >1 min = locked; (6) force-stop and reopen: locked; (7) turn App lock OFF again"

begin R6 "No screen lock set up (MANUAL — script does not test it)"
skip "owner (only if you have a spare phone with no screen lock): turning App lock ON shows 'Set up a screen lock first' and the switch stays OFF"

begin R7 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
