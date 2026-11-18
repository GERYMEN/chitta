#!/usr/bin/env bash
# R5b device pass: Bills & dues (counts only, owner-assisted).
#   scripts/device/r5b.sh                 # build + install update, then test
#   scripts/device/r5b.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker; the script never adds, pays or
# deletes your real bills/accounts — it asks YOU to add synthetic QA rows and
# only checks counts, the banner and fixed labels. QA data only:
#   - QA Pay Later 9999 account (with a credit limit)
#   - QA-Bill-01 (manual, due TOMORROW), QA-Bill-02 (manual, due YESTERDAY)
# Clean them up at the end. Prints counts, SAME/DIFFERENT and fixed labels only.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

# Fixed copy only (no names, no amounts): the due banner always reads
# "N bill(s) due — …". Matching the count word is enough.
BANNER='[0-9]+ bills? due[^"]*'

wait_banner() {   # $1 = want (present|absent), up to ~4 min; owner acts meanwhile
  local want="$1" t=0 seen
  while [ $t -lt 240 ]; do
    [ "$(front)" = tracker ] || { sleep 3; t=$((t+3)); continue; }
    tap 'Home(, tab.*)?' 0.5 >/dev/null 2>&1 || true
    if has "$BANNER"; then seen=present; else seen=absent; fi
    [ "$seen" = "$want" ] && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

pick_device
say "Tracker R5b device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "Bills & dues is reachable from Accounts"
if tap 'Accounts(, tab.*)?' 2; then
  # On-device the label dumps XML-escaped ("Bills &amp; dues") and the row's
  # content-desc is "Bills and dues" — match either, never the bare ampersand.
  has 'Bills (and|&amp;) dues' && pass "entry shown" || fail "no Bills entry on Accounts"
else fail "Accounts tab not found"; fi

begin R3 "owner: Accounts → Add Account → 'QA Pay Later 9999', type Pay Later, set a Credit Limit, Save"
say "  >>> add the QA Pay Later account now (3 min). It must group under CREDIT CARDS & PAY LATER."
t=0; ok=0
while [ $t -lt 180 ]; do [ "$(front)" = tracker ] && { tap 'Accounts(, tab.*)?' 0.5 >/dev/null 2>&1 || true; has 'QA Pay Later 9999' && { ok=1; break; }; }; sleep 3; t=$((t+3)); done
[ $ok -eq 1 ] && pass "QA Pay Later 9999 present" || fail "QA Pay Later 9999 not seen"

begin R4 "owner: open Bills & dues → Add bill → 'QA-Bill-01', amount, Due = TOMORROW, Add"
say "  >>> add QA-Bill-01 due TOMORROW now. The Home due banner should then appear."
if wait_banner present; then pass "Home due banner shown"; else fail "due banner did not appear"; fi

begin R5 "owner: in Bills, Mark paid on QA-Bill-01 — banner clears"
say "  >>> tap Mark paid on QA-Bill-01 (do NOT tap Undo yet)."
if wait_banner absent; then pass "banner gone after paid"; else fail "banner still present"; fi

begin R6 "owner: tap Undo in the snackbar — banner returns"
say "  >>> tap Undo now."
if wait_banner present; then pass "banner back after Undo"; else fail "banner did not return"; fi

begin R7 "owner: add 'QA-Bill-02' due YESTERDAY → Overdue section"
say "  >>> add QA-Bill-02 due YESTERDAY, then open Bills & dues."
t=0; ok=0
while [ $t -lt 180 ]; do [ "$(front)" = tracker ] && has 'Overdue \([0-9]+\)' && { ok=1; break; }; sleep 3; t=$((t+3)); done
[ $ok -eq 1 ] && pass "Overdue section shown" || fail "no Overdue section"

begin R8 "Bills screen sections (counts only)"
if has 'Overdue \([0-9]+\)' || has 'Due soon \([0-9]+\)'; then
  say "  sections: $(has 'Overdue \([0-9]+\)' && echo -n 'overdue ' )$(has 'Due soon \([0-9]+\)' && echo -n 'due-soon')"
  pass
else fail "no bill sections visible"; fi

begin R9 "owner: clean up — Dismiss/delete QA-Bill-01 & QA-Bill-02, remove QA Pay Later 9999"
say "  >>> remove the QA bills and the QA Pay Later account now (3 min)."
t=0; gone=0
while [ $t -lt 180 ]; do
  [ "$(front)" = tracker ] || { sleep 3; t=$((t+3)); continue; }
  tap 'Accounts(, tab.*)?' 0.5 >/dev/null 2>&1 || true
  has 'QA Pay Later 9999' || { gone=1; break; }
  sleep 3; t=$((t+3))
done
[ $gone -eq 1 ] && pass "QA Pay Later 9999 removed" || fail "QA Pay Later 9999 still present — remove it"

begin R10 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
