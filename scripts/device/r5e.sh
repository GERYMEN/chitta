#!/usr/bin/env bash
# R5e device pass: Money meaning (card payment / ATM / wallet top-up / EMI as
# transfers). Counts only, owner-assisted.
#   scripts/device/r5e.sh                 # build + install update, then test
#   scripts/device/r5e.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker; the script never types, saves,
# confirms or deletes anything itself — it asks YOU to act and only checks fixed
# UI labels and counts (never a name or an amount). QA/synthetic data only.
#
# NOTE: money-meaning suggestions come from a real bank SMS (a card-bill
# payment, ATM withdrawal, wallet top-up or EMI debit). adb cannot inject SMS,
# so steps that need a suggestion are owner-assisted and SKIP cleanly when no
# such item is present. To exercise R5e fully, have one such SMS in the inbox
# (or a prior sync that produced a Money-meaning card in Review) before running.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

wait_label() {  # $1 = ERE, up to ~3 min, owner acting meanwhile
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

T0=$(phone_time)

begin R0 "install the update (data kept: install -r)"
if [ "$INSTALL" = 1 ]; then
  APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$APK" ] || { fail "APK not built: run assembleRelease -PtrackerDebugSigning first"; summary; exit 2; }
  out=$("${A[@]}" install -r "$APK" 2>&1 | tail -1); say "  $out"
  case "$out" in *Success*) pass ;; *) fail "install failed"; summary; exit 2 ;; esac
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: unlock, leave Tracker in front"
launch; wait_idle || { summary; exit 2; }
has 'Home' || launch
pass

begin R2 "open Review · owner: tap the Review card (\"to review\"), then wait"
say "  >>> on Home, tap the Review card; if there is no Review card, leave Tracker open."
if wait_label 'Money meaning|Card bill payment|Cash withdrawal|Wallet top-up|EMI'; then
  say "  meaning suggestions present: $(count 'Money meaning|Card bill payment|Cash withdrawal|Wallet top-up|EMI')"
  pass
else
  skip "no Money-meaning card in Review (needs a card-payment/ATM/wallet/EMI SMS)"
fi

begin R3 "owner: on a Money-meaning card, Confirm the transfer with 'Do this automatically next time' ON"
say "  >>> tap Confirm on ONE meaning card (keep 'Do this automatically next time' checked)."
if wait_label 'Undo transfer'; then
  say "  conversion done — 'Undo transfer' offered (it became a transfer; excluded from spend)"
  pass
else
  skip "no conversion observed (no meaning card to confirm, or step not taken)"
fi

begin R4 "owner: tap 'Undo transfer' in the snackbar (revert the QA conversion)"
say "  >>> tap Undo transfer so nothing of yours is left changed."
if wait_label 'Undo|Money meaning|Card bill payment|to review'; then
  pass
else
  skip "Undo not observed"
fi

begin R5 "meaning rules are manageable in Settings"
say "  >>> open Settings (tap the greeting), scroll to the Money-meaning rules section."
if wait_label 'Money meaning|meaning rule|Automatic'; then
  pass
else
  skip "no saved meaning rule to show (none created yet)"
fi

begin R6 "no crash during the run"
n=$(fatal_count "$T0")
if [ "$n" = 0 ]; then pass "0 FATAL/ANR"; else fail "$n FATAL/ANR for com.tracker"; fi

summary
[ $FAIL -eq 0 ]
