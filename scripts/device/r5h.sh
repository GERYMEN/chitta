#!/usr/bin/env bash
# R5h device pass: every SMS sync lands in Pending (counts only).
#   scripts/device/r5h.sh                 # build + install update, then test
#   scripts/device/r5h.sh --skip-install  # test the app already installed
#   scripts/device/r5h.sh --rescan        # also re-read messages (exact count check)
#   scripts/device/r5h.sh --assisted      # owner approves one item + taps Undo; script checks counts
# Safety: see lib.sh. Touches only Tracker; approves/edits nothing; prints
# counts, SAME/DIFFERENT and fixed labels only.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1; RESCAN=0; ASSIST=0
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; --rescan) RESCAN=1 ;; --assisted) ASSIST=1 ;; *) echo "unknown: $a"; exit 64 ;; esac; done
MONEY='[-−+]?₹ ?[0-9][0-9,]*(\.[0-9]+)?'

pick_device
say "Tracker R5h device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: leave the phone alone until SUMMARY"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "Pending count before"
tap 'Home(, tab.*)?' || true
P_BEFORE=$(tab_badge); say "  Pending before: $P_BEFORE"; pass

begin R3 "Transactions total before (hashed, never shown)"
if tap 'Transactions(, tab.*)?' 2; then H_BEFORE=$(hashes "$MONEY"); pass "captured"; else fail "Transactions tab not found"; fi

begin R4 "tap Sync SMS on Home and wait for it to finish"
tap 'Home(, tab.*)?' || true
if tap 'Sync SMS' 3; then
  t=0; done=0
  while [ $t -lt 300 ]; do
    if has 'Sync SMS' && ! has 'Cancel( sync)?|Cancelling.*|Stop'; then done=1; break; fi
    sleep 5; t=$((t+5))
  done
  [ $done -eq 1 ] && pass "finished in ~${t}s" || fail "sync not finished after 300s"
else fail "Sync SMS button not found"; fi

begin R5 "Pending count after: rises by the new items, never falls"
P_AFTER=$(tab_badge); DELTA=$((P_AFTER - P_BEFORE))
say "  Pending after: $P_AFTER (change ${DELTA})"
[ "$DELTA" -ge 0 ] && pass || fail "Pending went down — something was approved"

begin R6 "Transactions total unchanged (no silent approval)"
if [ -n "${H_BEFORE:-}" ] && tap 'Transactions(, tab.*)?' 2; then
  H_AFTER=$(hashes "$MONEY")
  [ "$H_AFTER" = "$H_BEFORE" ] && pass "SAME" || fail "DIFFERENT"
else skip "no before value"; fi

begin R7 "Settings shows the new approval help text"
tap 'Home(, tab.*)?' || true
if tap '.*Edit profile and approval settings' 2; then
  found=0
  for _ in 1 2 3 4 5 6; do
    if has 'Synced items always wait in Pending[^"]*'; then found=1; break; fi
    swipe_up
  done
  [ $found -eq 1 ] && pass "shown" || fail "text not found in Settings"
  back_if_tracker
else fail "Settings opener not found"; fi

if [ $RESCAN -eq 1 ]; then
  begin R9 "re-read messages: Pending rises by exactly the Activity 'M new' count"
  tap 'Home(, tab.*)?' || true
  R_BEFORE=$(tab_badge)
  if tap '.*Edit profile and approval settings' 2 && { for _ in 1 2 3 4 5 6; do has 'Re-read messages with the new reader' && break; swipe_up; done; tap 'Re-read messages with the new reader' 3; }; then
    t=0; while [ $t -lt 600 ] && has 'Cancel( sync)?|Cancelling.*'; do sleep 5; t=$((t+5)); done
    back_if_tracker
    tap 'Activity(, tab.*)?' 2 || true
    M=$(grab_first 'You re-read your messages with the new reader: [0-9]+ new[^"]*' | grep -oE '[0-9]+ new' | grep -oE '[0-9]+')
    tap 'Home(, tab.*)?' || true
    R_AFTER=$(tab_badge)
    say "  re-read: ${M:-?} new · Pending ${R_BEFORE} -> ${R_AFTER}"
    if [ -n "$M" ] && [ $((R_AFTER - R_BEFORE)) -eq "$M" ]; then pass "exact"; else fail "Pending change $((R_AFTER - R_BEFORE)) vs ${M:-unknown} new"; fi
    if tap 'Transactions(, tab.*)?' 2; then [ "$(hashes "$MONEY")" = "${H_BEFORE:-x}" ] && pass "Transactions total SAME" || fail "Transactions total DIFFERENT"; fi
  else fail "re-read entry not found"; fi
fi

if [ $ASSIST -eq 1 ]; then
  begin R10 "approve + Undo · owner: in Pending approve ONE item, then tap Undo in the message (3 min)"
  tap 'Home(, tab.*)?' || true
  A0=$(tab_badge); tap 'Transactions(, tab.*)?' 2 || true; HA0=$(hashes "$MONEY")
  tap 'Pending(, tab.*)?' 2 || true
  say "  waiting for the approve (Pending $A0)…"
  t=0; A1=$A0
  while [ $t -lt 180 ]; do sleep 3; t=$((t+3)); [ "$(front)" = tracker ] || continue; A1=$(tab_badge); [ "$A1" -lt "$A0" ] && break; done
  if [ "$A1" -eq $((A0 - 1)) ]; then pass "approve: Pending $A0 -> $A1"; else fail "approve not seen (Pending $A0 -> $A1)"; fi
  say "  waiting for Undo…"
  t=0; A2=$A1
  while [ $t -lt 180 ]; do sleep 3; t=$((t+3)); [ "$(front)" = tracker ] || continue; A2=$(tab_badge); [ "$A2" -eq "$A0" ] && break; done
  [ "$A2" -eq "$A0" ] && pass "Undo: Pending back to $A2" || fail "Undo not seen (Pending $A2, expected $A0)"
  if tap 'Transactions(, tab.*)?' 2; then [ "$(hashes "$MONEY")" = "$HA0" ] && pass "Transactions total SAME after Undo" || fail "Transactions total DIFFERENT after Undo"; fi
fi

begin R8 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
