#!/usr/bin/env bash
# R8a device pass: Recurring detection + Home "Upcoming" card (counts only).
#   scripts/device/r8a.sh                 # build + install update, then test
#   scripts/device/r8a.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker. Read-only: it never taps
# "Not recurring", never edits or approves anything, creates no QA rows (a
# dated >= 3-row monthly history cannot be made reliably over adb; the
# detector itself is covered by unit tests). The device pass only checks that
# the card is absent when there is no recurring history, that the Upcoming
# screen opens when the card is shown, and that nothing crashes. Only fixed
# labels are counted; no amounts/merchant names printed, no screenshots, no db.
# The Home card's accessibility label starts "Upcoming: ".
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

CARD='Upcoming: [^"]*'
pick_device
say "Tracker R8a device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "Home opens with the existing data intact"
tap 'Home(, tab.*)?' 1.5 >/dev/null 2>&1 || true
if has 'Recent Transactions' || has 'Pending Approval'; then pass "Home reachable (install kept the data)"; else fail "Home not shown"; fi

begin R3 "Upcoming card is absent without recurring history, else shown once"
N_CARD=$(count "$CARD")
if [ "$N_CARD" -eq 0 ]; then
  pass "no Upcoming card (no recurring payment due soon)"
else
  say "  Upcoming card shown: $N_CARD (your history has a due-soon recurring payment)"
  [ "$N_CARD" -eq 1 ] && pass "exactly one card" || fail "more than one Upcoming card"
fi

begin R4 "Upcoming screen opens from the card (if shown)"
if [ "$N_CARD" -eq 0 ]; then skip "card not shown — nothing to open"; else
  tap "$CARD" 1.5 >/dev/null 2>&1 || true
  if has 'Upcoming' && has 'Estimated from your past payments.*'; then
    say "  rows with Not recurring action: $(count 'Not recurring.*')"
    pass "Upcoming screen shown (read-only; Not recurring not tapped)"
    back_if_tracker
  else fail "Upcoming screen not shown"; fi
fi

begin R5 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
