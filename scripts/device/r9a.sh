#!/usr/bin/env bash
# R9a device pass: Security (no-dependency half) — Private mode, Hide in
# recents / block screenshots, Export transactions (CSV). Counts only.
#   scripts/device/r9a.sh                 # build + install update, then test
#   scripts/device/r9a.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker. The only settings it flips are the
# Private mode switch (turned ON, then back to the state it found) — it never
# touches the other switch. Export CSV: the script opens the system save sheet
# and CANCELS it (nothing is written; no owner data leaves the app). No
# amounts/names printed, no screenshots, no db access.
# FLAG_SECURE is only observable by attempting a screenshot; this script never
# does. Owner check (manual): turn the switch on, press the recents button
# (the Tracker card must be blank) and try a screenshot (blocked / "can't take
# screenshot due to security policy"), then turn it off again.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

HIDE='Private mode\..*'
MASK='₹ ••••'
SECURE='Hide in recents and block screenshots\..*'
EXPORT='Export transactions \(CSV\)'

wait_label() {  # $1 = ERE, up to ~3 min, owner acting
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}
open_settings() {
  say "  >>> open Settings (tap the greeting at the top of Home)."
  wait_label "$HIDE"
}

pick_device
say "Tracker R9a device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "Home opens with the existing data intact"
tap 'Home(, tab.*)?' 1.5 >/dev/null 2>&1 || true
if has 'Recent Transactions' || has 'Pending Approval'; then pass "Home reachable"; else fail "Home not shown"; fi
BEFORE_MASK=$(count "$MASK")

begin R3 "Settings lists the Private mode + Hide in recents switches and the CSV export"
if open_settings; then
  OK=1
  has "$SECURE" || { OK=0; say "  missing: secure-screen switch"; }
  has "$EXPORT" || { OK=0; say "  missing: Export transactions (CSV)"; }
  [ $OK -eq 1 ] && pass "all three entries present" || fail "an entry is missing"
else fail "Settings not open / no Private mode switch"; fi

begin R4 "Private mode ON masks amounts (switch state restored at the end)"
WAS_ON=0; has 'Private mode\. On' && WAS_ON=1
if [ $WAS_ON -eq 1 ]; then
  skip "Private mode already ON on this phone — left as is; R5 checks OFF shows amounts only if you turn it off"
elif tap "$HIDE" 1.5 >/dev/null 2>&1 && has 'Private mode\. On'; then
  back_if_tracker; sleep 1
  tap 'Home(, tab.*)?' 1.5 >/dev/null 2>&1 || true
  AFTER=$(count "$MASK")
  say "  masked amounts: before $BEFORE_MASK · after $AFTER"
  if [ "$AFTER" -gt 0 ]; then pass "amounts masked"; else fail "no masked amounts after turning ON"; fi
else fail "could not turn Private mode ON"; fi

begin R5 "Private mode survives a restart, then OFF shows amounts again"
if [ $WAS_ON -eq 1 ]; then skip "not toggled by this run"; else
  guard; "${A[@]}" shell am force-stop "$APP_ID"; log "force-stop"; sleep 2
  "${A[@]}" shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1; sleep 6; guard
  tap 'Home(, tab.*)?' 1.5 >/dev/null 2>&1 || true
  if [ "$(count "$MASK")" -gt 0 ]; then say "  after restart: still masked"; else say "  after restart: NOT masked"; fail "setting lost on restart"; fi
  say "  >>> open Settings and turn Private mode OFF (the script will check)."
  if wait_label 'Private mode\. Off.*'; then
    back_if_tracker; sleep 1
    tap 'Home(, tab.*)?' 1.5 >/dev/null 2>&1 || true
    if [ "$(count "$MASK")" -le "$BEFORE_MASK" ]; then pass "OFF: amounts shown again"; else fail "still masked after OFF"; fi
  else fail "Private mode not turned OFF"; fi
fi

begin R6 "Export transactions (CSV) opens the system save sheet — cancelled, nothing written"
say "  >>> open Settings if it is not open."
if wait_label "$EXPORT"; then
  tap "$EXPORT" 3 >/dev/null 2>&1 || true
  F=$(front)
  CF=$("${A[@]}" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')
  if [ "$F" = other ] && [[ "$CF" == *documentsui* ]]; then
    say "  system save sheet in front"
    "${A[@]}" shell input keyevent 4; sleep 2     # cancel only the sheet we opened (DocumentsUI)
    if [ "$(front)" = tracker ]; then pass "sheet opened and was cancelled"; else fail "Tracker not back in front after cancel"; fi
  else fail "no system save sheet appeared (front: $F)"; fi
else fail "no Export entry"; fi

begin R7 "FLAG_SECURE (manual) — script does not test it"
skip "owner: switch on, check recents is blank and a screenshot is blocked, switch off"

begin R8 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
