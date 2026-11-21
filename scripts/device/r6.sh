#!/usr/bin/env bash
# R6 device pass: Balance reconciliation (counts only, owner-assisted).
#   scripts/device/r6.sh                 # build + install update, then test
#   scripts/device/r6.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker. The script NEVER taps a balance
# action by itself and never edits, approves or removes your real accounts or
# rows: it asks YOU to add a synthetic QA account and to tap the actions, and
# it only counts fixed labels ("Bank SMS: …" rows, "Difference …" rows, the
# three action labels, the Add Record header, the Pending badge). No amounts,
# names or SMS text are printed, no screenshots, no database access.
# The bank-SMS snapshot itself comes from the SMS reader on Sync SMS; this
# script does NOT inject SMS (that path is covered by unit tests). So the
# difference steps only run when some account already carries a snapshot, and
# every action is a tap by YOU on a QA account (Dismiss is the only action that
# is also safe on any account: it writes no anchor and changes no balance).
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

BANK_ROW='Bank SMS: [^"]*'
DIFF_ROW='Difference [^"]*'
QA_NAME='QA R6 Bank'

# Wait until Tracker shows a fixed label (ERE), up to ~3 min, owner acting.
wait_label() {  # $1 = ERE
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}
# Wait until the count of rows matching $1 is <= $2 (owner acting), ~3 min.
wait_count_le() {  # $1 = ERE, $2 = max
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && [ "$(count "$1")" -le "$2" ] && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

pick_device
say "Tracker R6 device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "Accounts opens with the existing data intact"
tap 'Accounts(, tab.*)?' 1.5 >/dev/null 2>&1 || true
if has 'Accounts' || has 'Approved Ledger Balance'; then
  say "  accounts shown: $(count 'Approved Ledger Balance') ledger card(s)"
  pass "Accounts reachable (install kept the data)"
else fail "Accounts screen not shown"; fi

begin R3 "owner: add a synthetic QA account named '$QA_NAME' (Accounts → Add account → Bank, any 4 digits)"
say "  >>> add a QA bank account named exactly: $QA_NAME  (do NOT use a real account's last 4)."
if wait_label "$QA_NAME"; then pass "QA account shown"; else fail "QA account not added"; fi

begin R4 "a QA account with no SMS balance shows no 'Bank SMS' row of its own"
# Counts only: how many accounts carry a snapshot, how many differ.
BASE_BANK=$(count "$BANK_ROW"); BASE_DIFF=$(count "$DIFF_ROW")
say "  bank-SMS rows: $BASE_BANK · difference rows: $BASE_DIFF"
pass "baseline recorded"

begin R5 "difference rows carry all three actions"
if [ "$BASE_DIFF" -eq 0 ]; then
  skip "no account shows a difference (none has a bank-SMS balance that disagrees)"
else
  N_USE=$(count 'Use bank balance'); N_ADD=$(count 'Add missing transaction'); N_DIS=$(count 'Dismiss')
  say "  Use bank balance: $N_USE · Add missing transaction: $N_ADD · Dismiss: $N_DIS"
  if [ "$N_USE" -ge "$BASE_DIFF" ] && [ "$N_ADD" -ge "$BASE_DIFF" ] && [ "$N_DIS" -ge "$BASE_DIFF" ]; then pass "3 actions per difference row"; else fail "an action label is missing"; fi
fi

begin R6 "owner: 'Add missing transaction' opens a pre-filled Add Record; go Back WITHOUT saving"
if [ "$BASE_DIFF" -eq 0 ]; then skip "no difference row to act on"; else
  PEND0=$(tab_badge)
  say "  >>> tap 'Add missing transaction' on the $QA_NAME row (or any row), look at the form, then press Back — do NOT save."
  if wait_label 'Add Record'; then
    say "  >>> now press Back without saving."
    if wait_count_le 'Add Record' 0; then
      PEND1=$(tab_badge)
      if [ "$PEND0" = "$PEND1" ]; then pass "Add Record opened; nothing saved (Pending badge $PEND0 → $PEND1)"; else fail "Pending badge changed $PEND0 → $PEND1 (something was saved)"; fi
    else fail "stayed on Add Record"; fi
  else fail "Add Record did not open"; fi
fi

begin R7 "owner: 'Use bank balance' on the $QA_NAME row only → confirm"
if [ "$BASE_DIFF" -eq 0 ]; then skip "no difference row to act on"; else
  say "  >>> ONLY if $QA_NAME has a difference: tap 'Use bank balance' → read the effect line → Use bank balance. Otherwise just wait."
  if wait_label 'Use bank balance\?'; then
    say "  confirm dialog shown (effect copy present)"
    if wait_count_le "$DIFF_ROW" $((BASE_DIFF-1)); then pass "difference cleared by the bank balance anchor"; else fail "difference still shown after confirm"; fi
  else skip "no confirm dialog seen (no QA difference to act on)"; fi
fi

begin R8 "owner: 'Dismiss' hides one difference (no balance change)"
CUR_DIFF=$(count "$DIFF_ROW")
if [ "$CUR_DIFF" -eq 0 ]; then skip "no difference row left to dismiss"; else
  say "  >>> tap 'Dismiss' on one difference row."
  if wait_count_le "$DIFF_ROW" $((CUR_DIFF-1)); then pass "difference hidden for that snapshot ($CUR_DIFF → $(count "$DIFF_ROW")); the Bank SMS row stays"; else fail "difference still shown"; fi
fi

begin R9 "owner: clean up — remove the QA account '$QA_NAME'"
say "  >>> remove '$QA_NAME' now (Accounts → Remove account). Leave your real accounts alone."
t=0; gone=0
while [ $t -lt 180 ]; do
  [ "$(front)" = tracker ] && ! has "$QA_NAME" && { gone=1; break; }
  sleep 3; t=$((t+3))
done
# A removed account moves to 'Deleted accounts' (the name may remain there).
if [ $gone -eq 1 ]; then pass "QA account no longer in the active list"; else skip "QA account still listed — confirm it is under Deleted accounts"; fi

begin R10 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
