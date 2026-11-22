#!/usr/bin/env bash
# R12 device pass: dark theme. Structure only: the Theme control (System / Light /
# Dark) is present and selectable, the choice survives a relaunch, and a few
# screens open in dark with no crash. Per-screen CONTRAST is a MANUAL, visual
# step for the owner (the script cannot judge colour).
#   scripts/device/r12.sh                 # build + install update, then test
#   scripts/device/r12.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker. Changes only the Theme choice (the
# script leaves it on System at the end). No amounts/names printed, no
# screenshots, no db access.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

wait_label() {  # $1 = ERE, up to ~3 min, owner acting
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

selected() {  # $1 = System|Light|Dark: true when that radio is exposed (label present)
  has "Theme $1"
}

pick_device
say "Tracker R12 device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

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

begin R3 "Settings shows the Theme control with System, Light and Dark"
say "  >>> open Settings (tap the greeting at the top of Home)."
if wait_label 'Theme System'; then
  OK=1
  for m in System Light Dark; do selected "$m" || { OK=0; say "  missing: Theme $m"; }; done
  [ $OK -eq 1 ] && pass "3 options present" || fail "an option is missing"
else fail "Settings not open / no Theme control"; fi

begin R4 "choose Dark: the app flips (owner confirms the look)"
tap 'Theme Dark' 2 >/dev/null 2>&1 && pass "tapped Dark" || fail "could not tap Dark"
skip "owner: the Settings sheet is now dark (dark surfaces, light text, light status-bar icons)"

begin R5 "dark: Home, Transactions, Insights and a bottom sheet open without a crash"
say "  >>> in Dark: open Home, Transactions, Insights (Home > See all), Budgets, Bills, Accounts and one Add/Edit sheet. Return here when done."
sleep 20
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR so far" || fail "$N FATAL/ANR lines"

begin R6 "relaunch keeps the choice (owner force-stops and reopens)"
say "  >>> force-stop Tracker from Android settings, reopen it, open Settings."
if wait_label 'Theme System'; then
  pass "Settings reachable after relaunch"
  skip "owner: the app opened dark and Dark is still the chosen option"
else fail "Settings not open"; fi

begin R7 "Light and System also apply live"
tap 'Theme Light' 2 >/dev/null 2>&1 && pass "tapped Light" || fail "could not tap Light"
tap 'Theme System' 2 >/dev/null 2>&1 && pass "tapped System (restored)" || fail "could not tap System"
skip "owner: with System, switch the phone's dark mode on/off in quick settings: Tracker follows without a restart"

begin R8 "per-screen contrast (MANUAL, visual)"
skip "owner: in Dark, walk every screen and the sheets/dialogs/snackbar/slider/switch: no text unreadable, no white flash, no invisible icon, charts and the donut legible, green/amber/red status chips readable, Private mode masks still work, tour overlay and App lock screen readable"

begin R9 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
