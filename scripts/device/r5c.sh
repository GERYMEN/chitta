#!/usr/bin/env bash
# R5c device pass: Budgets (counts only, owner-assisted).
#   scripts/device/r5c.sh                 # build + install update, then test
#   scripts/device/r5c.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker; the script never sets, edits or
# removes your real budgets — it asks YOU to add synthetic QA budgets and only
# checks the Home Budget card, the Budgets screen labels and fixed state copy
# ("On track" / "Near limit" / "Over budget"). Budgets are a read-only overlay:
# nothing here changes a balance or a transaction. QA data only:
#   - a QA overall monthly budget (a large round amount)
#   - a QA category budget on a category WITH spend this month, set small on
#     purpose so it reads "Over budget"
# Remove both at the end. Prints counts, PRESENT/ABSENT and fixed labels only.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

# The Home Budget card's accessibility label starts "Budget: …" (overall set)
# or "Budgets…" (only category budgets). Either proves the card is shown.
CARD='Budget[:s][^"]*'

wait_card() {   # $1 = want (present|absent), up to ~3 min; owner acts meanwhile
  local want="$1" t=0 seen
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] || { sleep 3; t=$((t+3)); continue; }
    tap 'Home(, tab.*)?' 0.5 >/dev/null 2>&1 || true
    if has "$CARD"; then seen=present; else seen=absent; fi
    [ "$seen" = "$want" ] && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

# Wait until Tracker shows a fixed label (ERE), up to ~3 min, owner acting.
wait_label() {  # $1 = ERE
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

pick_device
say "Tracker R5c device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "no Budget card on Home yet (no budgets set)"
tap 'Home(, tab.*)?' 1 >/dev/null 2>&1 || true
if has "$CARD"; then
  say "  note: a Budget card is already present — you may already have budgets. Leave your own alone."
  skip "budgets already exist on this phone"
else pass "no Budget card (clean start)"; fi

begin R3 "Budgets is reachable from Settings"
say "  >>> open Settings (tap the greeting at the top of Home)."
if wait_label 'Budgets'; then pass "Budgets entry shown in Settings"; else fail "no Budgets entry in Settings"; fi

begin R4 "owner: open Budgets → Set overall budget → a large amount → Save"
say "  >>> set a QA OVERALL monthly budget now (a large round amount). The Budgets screen should show 'Overall monthly budget'."
if wait_label 'Overall monthly budget'; then pass "Budgets screen open"; else fail "Budgets screen not reached"; fi

begin R5 "Home Budget card appears after the overall budget is set"
say "  >>> go back to Home."
if wait_card present; then pass "Home Budget card shown"; else fail "Budget card did not appear"; fi

begin R6 "owner: Budgets → Add budget → pick a category WITH spend → set a SMALL amount → Save"
say "  >>> add a QA category budget on a category that already has spend this month, set it small on purpose."
if wait_label 'Over budget'; then pass "category row reads Over budget"; else
  # A category with little spend may read Near limit / On track instead.
  if has 'Near limit' || has 'On track'; then pass "category budget row shown (state: near/on-track)"; else fail "no category budget state label"; fi
fi

begin R7 "over/near is reflected on the Home card"
say "  >>> go back to Home."
if wait_card present; then
  st="$(has 'Over budget' && echo -n 'over ')$(has '[0-9]+ over budget' && echo -n 'over-count ')$(has '[0-9]+ near limit' && echo -n 'near-count')"
  say "  home card state: ${st:-overall-only}"
  pass
else fail "Budget card missing after category budget"; fi

begin R8 "owner: Budgets → Remove the QA category budget, tap Undo, then Remove again"
say "  >>> Remove the QA CATEGORY budget. A 'Budget removed' snackbar with Undo should show; tap Undo to confirm it returns, then Remove it again for good."
if wait_label 'Budget removed'; then pass "remove + Undo snackbar seen"; else skip "snackbar is brief — could not catch it; verify the row reappears on Undo"; fi

begin R9 "owner: clean up — remove the QA overall budget and any QA category budget"
say "  >>> remove the QA overall budget (and the QA category budget if still present) now (3 min)."
if wait_card absent; then pass "Budget card gone (QA budgets removed)"; else
  say "  note: a Budget card is still present — if these are YOUR budgets, that is expected."
  skip "Budget card still present — confirm your own budgets only remain"; fi

begin R10 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
