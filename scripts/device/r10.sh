#!/usr/bin/env bash
# R10 device pass: Personal IOUs (counts only, owner-assisted).
#   scripts/device/r10.sh                 # build + install update, then test
#   scripts/device/r10.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker; the script never types, saves or
# deletes anything itself — it asks YOU to create SYNTHETIC QA data and only
# checks fixed UI labels and counts (never a name or an amount). QA data only:
#   - a QA person (any made-up name, e.g. "QA Person") typed in the Split sheet
#   - a QA expense (a small round amount) to split
# The IOU ledger is a parallel layer: splitting never changes the expense's
# amount; a credit linked as a repayment stops counting as income. Clean up at
# the end (delete the QA shares; unlink/delete the QA credit and expense).
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

# Home tile accessibility label starts "IOUs: You get ..., You owe ...".
TILE='IOUs: You get [^"]*'

wait_label() {  # $1 = ERE, up to ~3 min, owner acting
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}
wait_tile() {   # $1 = present|absent
  local want="$1" t=0 seen
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] || { sleep 3; t=$((t+3)); continue; }
    tap 'Home(, tab.*)?' 0.5 >/dev/null 2>&1 || true
    if has "$TILE"; then seen=present; else seen=absent; fi
    [ "$seen" = "$want" ] && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

pick_device
say "Tracker R10 device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "no IOU tile on Home yet (no unsettled IOUs)"
tap 'Home(, tab.*)?' 1 >/dev/null 2>&1 || true
if has "$TILE"; then
  say "  note: an IOU tile is already present — you may already have IOUs. Leave your own alone."
  skip "IOUs already exist on this phone"
else pass "no IOU tile (clean start)"; fi

begin R3 "People & IOUs is reachable from Settings"
say "  >>> open Settings (tap the greeting at the top of Home)."
if wait_label 'People and IOUs'; then pass "People & IOUs entry shown in Settings"; else fail "no People & IOUs entry in Settings"; fi

begin R4 "owner: add a QA expense, open its detail, tap Split, add a QA person + amount, Save"
say "  >>> add a small QA expense (Add record), open it, tap 'Split', type a made-up name and an amount below the expense, Save."
if wait_label 'Split'; then pass "Split action shown on the approved expense"; else fail "no Split action"; fi
if wait_label 'Split: [0-9]+ people? owes? you[^"]*|Split: [0-9]+ people? owe you[^"]*'; then pass "expense detail shows the split summary"; else fail "no split summary on the expense"; fi

begin R5 "Home 'You get' tile appears"
say "  >>> go back to Home."
if wait_tile present; then pass "IOU tile shown"; else fail "IOU tile did not appear"; fi

begin R6 "People screen has a row for the QA person"
say "  >>> tap the IOU tile (or Settings > People & IOUs)."
if wait_label 'People & IOUs'; then
  n=$(count '[^"]*owes you [^"]*'); say "  rows owing you: $n"
  [ "${n:-0}" -ge 1 ] && pass "People row present" || fail "no person row owing you"
else fail "People screen not reached"; fi

begin R7 "owner: open the QA person, tap Record repayment, Settle without a transaction"
say "  >>> tap the QA person, 'Record repayment', then 'Settle without a transaction'. A 'Repayment recorded' snackbar with Undo shows for 5 s."
if wait_label 'Repayment recorded'; then pass "repayment + Undo snackbar seen"; else skip "snackbar is brief — verify the share shows 'Settled'"; fi

begin R8 "Home tile updates after the repayment"
say "  >>> go back to Home."
if wait_tile absent; then pass "IOU tile gone (nothing unsettled)"; else
  say "  note: the tile is still shown — if you have your own IOUs that is expected."
  skip "tile still present — confirm only your own IOUs remain"; fi

begin R9 "owner: clean up — delete the QA share(s), then delete the QA expense"
say "  >>> People > QA person > Delete (confirm). Then delete the QA expense from its detail."
if wait_tile absent; then pass "no IOU tile (QA shares removed)"; else skip "tile still present — confirm your own IOUs only remain"; fi

begin R10 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
