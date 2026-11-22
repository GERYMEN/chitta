#!/usr/bin/env bash
# R5j device pass: Polish (Hidden accounts, Restore category, Add Record
# selectors, persisted filters, "Last read" banner). Counts only.
#   scripts/device/r5j.sh                 # build + install update, then test
#   scripts/device/r5j.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker. QA data only: the one category it
# acts on is named 'QA R5j Cat' (YOU create + archive it; the script taps only
# its "Restore" button). It never taps "Un-ignore" (that would change which of
# YOUR accounts Tracker reads) and never saves an Add Record form. Only fixed
# labels are counted; no amounts/names printed, no screenshots, no db access.
# Filters are transient view state: if a filter is already applied on the
# phone when the run starts, the filter steps SKIP rather than disturb it.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

QA_CAT='QA R5j Cat'
BANNER='Last read [0-9]+ days? ago'

# Wait until Tracker shows a fixed label (ERE), up to ~3 min, owner acting.
wait_label() {  # $1 = ERE
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}
# force-stop Tracker (keeps data) and bring it back to the front.
restart_tracker() {
  guard; "${A[@]}" shell am force-stop "$APP_ID"; log "force-stop"; sleep 2
  case "$(front)" in
    launcher|tracker) "${A[@]}" shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1; sleep 6 ;;
    *) say "✖ cannot relaunch over another app"; summary; exit 3 ;;
  esac
  guard
}

pick_device
say "Tracker R5j device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

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
if has 'Recent Transactions' || has 'Pending Approval'; then pass "Home reachable (install kept the data)"; else fail "Home not shown"; fi

begin R3 "Hidden accounts opens from Settings (read-only; Un-ignore is never tapped)"
say "  >>> open Settings (tap the greeting at the top of Home)."
if wait_label 'Hidden accounts'; then
  tap 'Hidden accounts' 2 >/dev/null 2>&1 || true
  if has 'Nothing hidden' || has 'Un-ignore.*'; then
    say "  hidden accounts listed: $(count 'Un-ignore.*')"
    pass "Hidden accounts screen shown"
    back_if_tracker
  else fail "Hidden accounts screen not shown"; fi
else fail "no Hidden accounts entry in Settings"; fi

begin R4 "owner: create a QA category '$QA_CAT', then archive it (Settings → Categories)"
say "  >>> Categories → New category named exactly: $QA_CAT → Save."
say "  >>> then tap it and Archive it. It will be listed under ARCHIVED."
if wait_label "$QA_CAT \\(archived\\)"; then pass "archived QA category shown"; else fail "archived QA category not seen"; fi

begin R5 "Restore brings the QA category back (script taps only 'Restore $QA_CAT')"
if has "Restore $QA_CAT"; then
  tap "Restore $QA_CAT" 2 >/dev/null 2>&1 || true
  if ! has "$QA_CAT \\(archived\\)" && has "Edit $QA_CAT"; then pass "restored — editable again, no longer archived"; else fail "still archived after Restore"; fi
else fail "no Restore button for the QA category"; fi

begin R6 "Add Record selectors are present (nothing is saved)"
tap 'Home(, tab.*)?' 1 >/dev/null 2>&1 || true
if tap 'Add Record' 2 >/dev/null 2>&1 && has 'Expense' && has 'Income'; then
  say "  kind choices: Expense $(count 'Expense') · Income $(count 'Income') · Transfer $(count 'Transfer')"
  pass "kind + account selectors shown"
  back_if_tracker
else fail "Add Record selectors not found"; fi

begin R7 "a Transactions filter survives a restart"
tap 'Transactions(, tab.*)?' 2 >/dev/null 2>&1 || true
if has 'Reset'; then
  skip "a filter is already applied on this phone — not disturbed"
else
  if tap 'Expenses [0-9]+' 1.5 >/dev/null 2>&1 && has 'Reset'; then
    sleep 2   # the save is a quick background write
    restart_tracker
    tap 'Transactions(, tab.*)?' 2 >/dev/null 2>&1 || true
    if has 'Reset'; then pass "filter restored after force-stop + relaunch"; else fail "filter lost on restart"; fi
  else fail "could not apply the Expenses filter"; fi
fi

begin R8 "Reset clears it, and it stays cleared after a restart"
if has 'Reset'; then
  tap 'Reset' 1.5 >/dev/null 2>&1 || true
  if has 'Reset'; then fail "Reset did not clear the filter"; else
    sleep 2; restart_tracker
    tap 'Transactions(, tab.*)?' 2 >/dev/null 2>&1 || true
    if has 'Reset'; then fail "a cleared filter came back after restart"; else pass "stays cleared"; fi
  fi
else skip "no filter applied by this run"; fi

begin R9 "no 'Last read' banner right after a fresh Sync SMS"
tap 'Home(, tab.*)?' 1 >/dev/null 2>&1 || true
if tap 'Sync SMS' 3; then
  t=0; done=0
  while [ $t -lt 300 ]; do
    if has 'Sync SMS' && ! has 'Cancel( sync)?|Cancelling.*|Stop'; then done=1; break; fi
    sleep 5; t=$((t+5))
  done
  if [ $done -ne 1 ]; then fail "sync not finished after 300s"
  elif [ "$(count "$BANNER")" -eq 0 ]; then pass "banner absent after a completed read"
  else fail "banner still shown after a completed read"; fi
else fail "Sync SMS button not found"; fi

begin R10 "owner: clean up — archive '$QA_CAT' again (Categories → tap it → Archive)"
say "  >>> archive '$QA_CAT' (a category cannot be deleted; archived is harmless). Leave your own categories alone."
if wait_label "$QA_CAT \\(archived\\)"; then pass "QA category archived"; else skip "QA category still active — archive it by hand"; fi

begin R11 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
