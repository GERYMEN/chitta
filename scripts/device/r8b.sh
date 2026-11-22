#!/usr/bin/env bash
# R8b device pass: opt-in notifications (bill reminders, recurring "Remind me?",
# weekly summary). Counts of fixed labels only.
#   scripts/device/r8b.sh                 # build + install update, then test
#   scripts/device/r8b.sh --skip-install  # test the app already installed
# Safety: see lib.sh. Touches only Tracker. The script flips NOTHING: it never
# turns a notification type on or off, never taps the system permission dialog
# (a system window adb must not drive), and never asserts system UI. The
# POST_NOTIFICATIONS dialog, the real notification and the reboot re-arm are
# MANUAL steps for the owner (R4-R7). Alarms are INEXACT: a reminder may arrive
# a few minutes late. No amounts/names printed, no screenshots, no db access.
set -uo pipefail
source "$(dirname "$0")/lib.sh"

INSTALL=1
for a in "$@"; do case "$a" in --skip-install) INSTALL=0 ;; *) echo "unknown: $a"; exit 64 ;; esac; done

BILLS='Bill reminders\..*'
RECUR='Recurring payment reminders\..*'
WEEKLY='Weekly summary\..*'

wait_label() {  # $1 = ERE, up to ~3 min, owner acting
  local t=0
  while [ $t -lt 180 ]; do
    [ "$(front)" = tracker ] && has "$1" && return 0
    sleep 3; t=$((t+3))
  done
  return 1
}

pick_device
say "Tracker R8b device pass · device ${SERIAL} · idle wait ${IDLE_NEED}s"

begin R0 "install the update (data kept)"
if [ $INSTALL -eq 1 ]; then
  if "$ROOT/scripts/install-release-usb.sh" -s "$SERIAL" >>"$LOG" 2>&1; then pass "installed"; else fail "install failed (see log)"; summary; exit 1; fi
else skip "--skip-install"; fi

begin R1 "open Tracker · owner: follow the prompts, otherwise leave it alone"
wait_idle
T0=$(phone_time)
launch && pass

begin R2 "Home opens with the existing data intact (no notification prompt at launch)"
tap 'Home(, tab.*)?' 1.5 >/dev/null 2>&1 || true
if has 'Recent Transactions' || has 'Pending Approval'; then pass "Home reachable"; else fail "Home not shown"; fi

begin R3 "Settings lists the three notification toggles, all Off by default"
say "  >>> open Settings (tap the greeting at the top of Home)."
if wait_label "$BILLS"; then
  OK=1
  has "$RECUR" || { OK=0; say "  missing: Recurring payment reminders"; }
  has "$WEEKLY" || { OK=0; say "  missing: Weekly summary"; }
  say "  toggles reading Off: $(count '(Bill reminders|Recurring payment reminders|Weekly summary)\. Off.*')"
  [ $OK -eq 1 ] && pass "three notification rows present" || fail "a row is missing"
else fail "Settings not open / no Bill reminders switch"; fi

begin R4 "First toggle asks for notification permission (MANUAL — script does not tap it)"
skip "owner (Android 13+): turn Bill reminders ON: the system 'Allow Tracker to send you notifications?' dialog appears (not before); Allow = switch stays On; Don't allow = switch stays Off (a toast); after two denials the next try shows 'Notifications are blocked' with Open Settings"

begin R5 "A bill due today schedules a reminder (MANUAL)"
skip "owner: with Bill reminders ON add a QA bill (Bills > Add, payee 'QA bill', any amount, due date = today). It fires at the next 9:00 (today if before 9, else tomorrow); to see it sooner, temporarily set the phone clock past 9:00 and reopen Tracker (reconcile runs on foreground). Text: 'QA bill bill is due (~amount)'. Mark it paid and reopen Tracker: the pending reminder is dropped. Delete the QA bill afterwards"

begin R6 "Private mode leaves amounts and names out (MANUAL)"
skip "owner: turn Private mode ON, reopen Tracker: a scheduled bill reminder now reads 'A bill is due' (no amount, no payee); weekly reads 'Your weekly summary is ready'"

begin R7 "Recurring Remind me? + weekly summary + reboot (MANUAL)"
skip "owner: Upcoming > a series > 'Remind me?' turns on Recurring payment reminders (permission asked if not yet granted) and the button reads 'Reminder on'; Weekly summary ON shows Day/Time chips; reboot the phone: reminders are re-armed (boot receiver). Tapping a notification opens Tracker (the App lock may show first). Turn the three toggles Off when done"

begin R8 "crashes since start"
N=$(fatal_count "$T0"); [ "$N" -eq 0 ] && pass "0 FATAL/ANR" || fail "$N FATAL/ANR lines"

summary
[ $FAIL -eq 0 ]
