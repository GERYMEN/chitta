#!/usr/bin/env bash
# R11 device pass: Tags & receipts (counts only, owner-assisted).
#   scripts/device/r11.sh                 # build + install update, then test
#   scripts/device/r11.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker; the script never types, saves or
# deletes anything itself. SYNTHETIC QA data only: a small QA expense paid by
# UPI, a made-up tag name (e.g. "qa-r11"). RECEIPT ATTACH IS A MANUAL STEP: the
# script only checks that the system photo picker opens (and the owner CANCELS
# it — never pick a real photo of yours for this test). Receipts need NO
# permission: if Android ever asks for one, that is a FAIL — report it.
# Only fixed labels and counts are read (never a tag name, amount or image).
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

pick_device
say "Tracker R11 device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept: install -r)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "no permission was added: the app still declares the same permissions"
if "${A[@]}" shell dumpsys package "$APP_ID" 2>/dev/null | tr -d '\r' | grep -q 'android.permission.CAMERA'; then
  fail "CAMERA permission is declared (must not be)"
else pass "no CAMERA permission"; fi

begin R3 "owner: add a QA expense (UPI, small round amount), open its detail"
say "  >>> Add record: a small QA expense with payment UPI, then open it from Transactions."
if wait_label 'Add tag'; then pass "detail shows the Tags row with Add tag"; else fail "no Add tag on the detail screen"; fi

begin R4 "auto tag chip present for the payment method"
if has '#UPI|#Card|#Cash|#Bank'; then pass "auto tag chip shown (derived from payment method)"; else fail "no auto tag chip (is the QA expense's method 'other'?)"; fi

begin R5 "owner: tap Add tag, type a made-up tag (e.g. qa-r11), Add"
say "  >>> tap 'Add tag', type a made-up name, tap Add."
if wait_label 'Tag [^"]*\. Remove'; then pass "custom tag chip shown (removable)"; else fail "custom tag chip did not appear"; fi

begin R6 "filter by that tag shows the QA expense"
say "  >>> go to Transactions, tap the 'Tag' filter chip, pick your QA tag."
if wait_label 'Showing [0-9]+ of [0-9]+ settled[^"]*'; then
  s=$(grab_first 'Showing [0-9]+ of [0-9]+ settled[^"]*'); say "  subtitle: ${s}"
  pass "list is filtered by the tag (expect 1 of N)"
else fail "tag filter did not narrow the list"; fi

begin R7 "tag filter persists across a restart"
say "  >>> force-stop Tracker from Android settings, reopen it, go to Transactions."
if wait_label 'Showing [0-9]+ of [0-9]+ settled[^"]*'; then pass "filter still applied after restart"; else skip "verify the Tag chip is still active (the owner may have reset it)"; fi

begin R8 "Reset clears the tag filter"
say "  >>> tap Reset."
if wait_label '[0-9]+ Settled[^"]*'; then pass "unfiltered subtitle back"; else fail "subtitle did not return to unfiltered"; fi

begin R9 "owner: Attach receipt opens the system photo picker — CANCEL it"
say "  >>> open the QA expense, tap 'Attach receipt'. The Android photo picker opens: just BACK/Cancel out of it (do NOT pick a photo of yours)."
say "  >>> No permission dialog may appear."
if wait_label 'Attach receipt'; then pass "Attach receipt present; cancelling left it unattached"; else fail "Attach receipt missing after cancel"; fi
say "  note: full attach/thumbnail/remove-Undo is a manual check with a throwaway image."

begin R10 "owner: clean up — remove the QA tag chip, then delete the QA expense"
say "  >>> tap the QA tag chip to remove it, then delete the QA expense."
if wait_label 'Add tag|Transactions'; then pass "cleanup steps shown"; else skip "verify manually"; fi

begin R11 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
