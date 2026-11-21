#!/usr/bin/env bash
# R5i device pass: chain review ("Linked by rules") + persistence (counts only).
#   scripts/device/r5i.sh                 # build + install update, then test
#   scripts/device/r5i.sh --skip-install  # test the app already installed
# Owner-assisted: the script never creates, accepts, dismisses or links a
# suggestion by itself. It asks YOU to create a QA SMS pair and to tap
# Accept / Dismiss / Undo; the script only watches the "Linked by rules"
# section count and the Pending badge, and proves the suggestion survives an
# app restart. Safety: see lib.sh — touches only Tracker, prints counts and
# fixed labels only, stops if Tracker is not in front or the phone is locked.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

pick_device
say "Tracker R5i device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

# The "Linked by rules" section count (0 when the section is absent).
chain_count() {
  local v; v=$(grab_first 'Linked by rules[^"]*')
  printf '%s' "$v" | grep -oE '[0-9]+' | head -1 || true
}

# Open Review from the Home "N to review" card (present only when >0).
open_review() {
  tap 'Home(, tab.*)?' || true
  tap '[0-9]+ to review' 2 || return 1
  has 'To review'
}

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: leave the phone alone until a >>> prompt"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "owner: create a QA chain pair, then Sync SMS so a suggestion appears"
say ">>> Send yourself (or sync) a QA SMS pair the rules chain — e.g. a QA"
say ">>> refund that follows a QA debit, or a duplicate alert — then tap Sync"
say ">>> SMS on Home. QA data only (XX1234 / XX9999, refs 000000000xxx)."
tap 'Home(, tab.*)?' || true
found=0; t=0
while [ $t -lt 300 ]; do
  [ "$(front)" = tracker ] || { sleep 5; t=$((t+5)); continue; }
  has '[0-9]+ to review' && { found=1; break; }
  sleep 5; t=$((t+5))
done
[ $found -eq 1 ] && pass "a 'to review' card appeared" || { fail "no review card after 300s"; summary; exit 1; }

begin R3 "open Review · 'Linked by rules' shows the suggestion"
if open_review; then
  C1=$(chain_count); say "  Linked by rules: ${C1:-0}"
  [ -n "$C1" ] && [ "$C1" -ge 1 ] && pass "section shows ${C1}" || fail "no 'Linked by rules' row"
else fail "could not open Review"; summary; exit 1; fi

begin R4 "Dismiss + Undo · owner: tap Dismiss on the QA row, then Undo in the message"
say ">>> On a QA 'Linked by rules' row tap Dismiss, then tap Undo in the snackbar."
# After Dismiss the count drops; after Undo it returns to C1.
t=0; dropped=0
while [ $t -lt 180 ]; do sleep 3; t=$((t+3)); [ "$(front)" = tracker ] || continue
  c=$(chain_count); [ -n "$c" ] && [ "$c" -lt "$C1" ] && { dropped=1; break; }; [ -z "$c" ] && { dropped=1; break; }
done
[ $dropped -eq 1 ] && say "  dismiss seen" || say "  dismiss not seen"
t=0; back=0
while [ $t -lt 180 ]; do sleep 3; t=$((t+3)); [ "$(front)" = tracker ] || continue
  c=$(chain_count); [ -n "$c" ] && [ "$c" -ge "$C1" ] && { back=1; break; }
done
{ [ $dropped -eq 1 ] && [ $back -eq 1 ]; } && pass "Dismiss then Undo restored the row" || fail "Dismiss/Undo not seen (dropped=$dropped back=$back)"

begin R5 "restart Tracker · the suggestion is still there (persistence proof)"
guard; "${A[@]}" shell am force-stop "$APP_ID"; log "force-stop"; sleep 2
case "$(front)" in
  launcher|tracker) "${A[@]}" shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1; sleep 6 ;;
  *) fail "cannot relaunch over another app"; summary; exit 3 ;;
esac
guard
if open_review; then
  C2=$(chain_count); say "  Linked by rules after restart: ${C2:-0} (was ${C1})"
  [ -n "$C2" ] && [ "$C2" -ge "$C1" ] && pass "survived restart" || fail "suggestion lost on restart"
else fail "could not open Review after restart"; fi

begin R6 "Accept · owner: tap the Accept button on the QA row — the row goes away"
say ">>> On the QA 'Linked by rules' row tap the Accept button (Link as refund /"
say ">>> Confirm transfer / Mark duplicate). The row should disappear."
t=0; gone=0
while [ $t -lt 180 ]; do sleep 3; t=$((t+3)); [ "$(front)" = tracker ] || continue
  c=$(chain_count); { [ -z "$c" ] || [ "$c" -lt "$C2" ]; } && { gone=1; break; }
done
[ $gone -eq 1 ] && pass "accepted — row gone" || fail "accept not seen (count still ${c:-?})"

begin R7 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

say ">>> Clean up any QA rows you created (QA transactions / the linked pair)."
summary
[ $FAIL -eq 0 ]
